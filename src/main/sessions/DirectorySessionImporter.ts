import type {
	DirectoryImportReport,
	DirectoryImportResult,
	DirectorySessionSummary,
	SessionSummary,
} from "../../shared/types";
import {
	DIRECTORY_IMPORT_MAX_SUMMARIES,
	isDirectoryImportCandidate,
	isSessionContainerProbe,
	normalizeSessionPathKey,
	toDirectorySessionSummary,
	type DirectoryShapeProbe,
} from "./directorySessionImport";

/**
 * 外置目录会话导入编排：扫描用户选定的目录 → 挂到当前项目（catalog）。
 *
 * 数据来源是 SessionScanner 的全量清单（`list()` 不带项目参数），而不是另起一套目录遍历：
 * pi 会话文件只在 sessions 树里（`~/.pi/agent/sessions/<encoded-cwd>/<file>.jsonl`），
 * 复用扫描器才能拿到标题/预览缓存与 WSL 分支，也不会与主进程扫描口径漂移。
 * 本模块只做筛选与归属改写，因此磁盘访问全部经注入的 deps 完成，可直接单测。
 *
 * 为什么是「只建 catalog 引用」而不是复制文件：pi 会话的身份就是文件路径，
 * 复制到新项目的 encoded 目录会让同一段历史出现两份（旧目录那份仍在），而 resume 一样能用。
 * 这里只把 catalog 记录的项目归属改成当前项目，原文件原地不动；
 * 打开会话时 pi 以项目目录为 cwd 继续（进程 cwd 由 PiProcess 决定）。
 *
 * 安全边界：渲染层传来的 sourcePath 只当比对键，入册路径一律取自本次扫描结果
 * （`byPath` 命中 + 目录候选判定），伪造/越界路径记失败，绝不落 catalog。
 */

export type DirectorySessionImporterDeps = {
	/** 全量会话清单（生产装配：SessionScanner.list() 不带项目参数） */
	listSessions: () => Promise<SessionSummary[]>;
	/** 会话文件的标题（生产装配：SessionScanner.inferSessionNameFromFile；缺失返回 undefined） */
	readSessionName: (filePath: string) => Promise<string | undefined>;
	/** 读取目录形态（生产装配：readdir 探 .jsonl / --xxx-- 子目录） */
	readDirectoryShape: (dir: string) => Promise<DirectoryShapeProbe>;
	/** catalog 已有会话文件路径（normalizeSessionPathKey 归一后的集合） */
	listKnownFilePaths: () => ReadonlySet<string>;
	/**
	 * 把摘要并入目标项目（生产装配：SessionCatalog.mergeScanned，幂等）。
	 * manualAssignment 置位后该条目的项目归属被钉住，别的项目扫描不会把它改回去。
	 */
	mergeScanned: (
		projectId: string,
		summaries: SessionSummary[],
		options?: { manualAssignment?: boolean },
	) => Promise<unknown>;
	/** 路径存在性（原工作目录是否还在磁盘上） */
	pathExists: (path: string) => Promise<boolean>;
	/** 失败回调（不阻断其余会话） */
	onError?: (sourcePath: string, error: unknown) => void;
};

export class DirectorySessionImporter {
	constructor(private readonly deps: DirectorySessionImporterDeps) {}

	/**
	 * 扫描选定目录 → 弹窗行（按会话时间倒序，最多 DIRECTORY_IMPORT_MAX_SUMMARIES 条）。
	 * 标题按需回读（列表摘要不带 name），只对入选的一批读，避免把整棵 sessions 树都解析一遍。
	 */
	async scan(dir: string): Promise<DirectorySessionSummary[]> {
		const { candidates } = await this.collectCandidates(dir);
		const known = this.deps.listKnownFilePaths();
		// 原目录只探测一次：一次扫描里几十个会话往往来自同一个旧目录。
		const existsCache = new Map<string, boolean>();
		const rows: DirectorySessionSummary[] = [];
		for (const summary of candidates) {
			const projectPath = summary.projectPath;
			let projectPathExists = false;
			if (projectPath) {
				const key = normalizeSessionPathKey(projectPath);
				const cached = existsCache.get(key);
				if (cached === undefined) {
					projectPathExists = await this.deps.pathExists(projectPath).catch(() => false);
					existsCache.set(key, projectPathExists);
				} else {
					projectPathExists = cached;
				}
			}
			const name = await this.deps.readSessionName(summary.filePath).catch(() => undefined);
			rows.push(
				toDirectorySessionSummary({
					summary: name ? { ...summary, name } : summary,
					projectPath,
					projectPathExists,
					alreadyImported: known.has(normalizeSessionPathKey(summary.filePath)),
				}),
			);
		}
		return rows;
	}

	/**
	 * 把选中的会话挂到目标项目（一次 mergeScanned，幂等：已入册的只改项目归属）。
	 * 只接受本次扫描真实出现的候选路径；其余记失败，绝不入 catalog。
	 */
	async import(
		projectId: string,
		dir: string,
		sourcePaths: readonly string[],
	): Promise<DirectoryImportReport> {
		const results: DirectoryImportResult[] = [];
		if (sourcePaths.length === 0) return { results, imported: 0, failed: 0 };
		const { candidates, pickedIsContainer } = await this.collectCandidates(dir);
		const byPath = new Map<string, SessionSummary>();
		for (const summary of candidates) {
			byPath.set(normalizeSessionPathKey(summary.filePath), summary);
		}
		const accepted: SessionSummary[] = [];
		for (const sourcePath of sourcePaths) {
			const summary = byPath.get(normalizeSessionPathKey(sourcePath));
			// 二次判定：即便扫描清单被污染，路径也必须仍是该目录的候选。
			if (!summary || !isDirectoryImportCandidate({ summary, dir, pickedIsContainer })) {
				results.push({
					id: sourcePath,
					sourcePath,
					success: false,
					error: "SESSION_NOT_IN_DIRECTORY",
				});
				continue;
			}
			accepted.push(summary);
		}
		if (accepted.length > 0) {
			try {
				// manualAssignment：把归属钉在当前项目，否则旧目录对应的项目一旦被刷新就会抢回去。
				await this.deps.mergeScanned(projectId, accepted, { manualAssignment: true });
				for (const summary of accepted) {
					results.push({
						id: summary.id,
						sourcePath: summary.filePath,
						...(summary.name ? { title: summary.name } : {}),
						success: true,
					});
				}
			} catch (error) {
				this.deps.onError?.(accepted[0]?.filePath ?? dir, error);
				const message = error instanceof Error ? error.message : String(error);
				for (const summary of accepted) {
					results.push({
						id: summary.id,
						sourcePath: summary.filePath,
						...(summary.name ? { title: summary.name } : {}),
						success: false,
						error: message,
					});
				}
			}
		}
		return {
			results,
			imported: results.filter((result) => result.success).length,
			failed: results.filter((result) => result.success === false).length,
		};
	}

	/** 选定目录的候选清单（按 mtime 倒序截断；标题留给 scan 按需回读）。 */
	private async collectCandidates(
		dir: string,
	): Promise<{ candidates: SessionSummary[]; pickedIsContainer: boolean }> {
		const probe = await this.deps.readDirectoryShape(dir).catch(() => ({
			hasJsonl: false,
			hasEncodedGroups: false,
		}));
		const pickedIsContainer = isSessionContainerProbe(probe);
		const sessions = await this.deps.listSessions();
		const candidates = sessions
			.filter((summary) => isDirectoryImportCandidate({ summary, dir, pickedIsContainer }))
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.slice(0, DIRECTORY_IMPORT_MAX_SUMMARIES);
		return { candidates, pickedIsContainer };
	}
}
