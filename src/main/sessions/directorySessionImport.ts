import type { DirectorySessionSummary, SessionSummary } from "../../shared/types";

/**
 * 外置目录会话导入的纯逻辑（不碰 Electron、不碰磁盘、不 import SessionScanner）。
 *
 * 背景：pi 会话按「cwd 的 encoded 分组目录」存在 ~/.pi/agent/sessions 下
 * （布局 `~/.pi/agent/sessions/<encoded-cwd>/<file>.jsonl`）。项目目录一旦移动/改名，
 * 会话记录里的项目路径与新项目不再匹配，常规项目扫描（isSameProject 过滤）就看不到它们。
 *
 * 这里负责可单测的三件事：
 * 1. 判断用户选定的目录属于哪种形态（会话容器 / 项目目录）；
 * 2. 从「全量会话清单」里挑出属于该目录的候选（容器内文件，或原工作目录命中）；
 * 3. 候选摘要 → 弹窗行。
 * 磁盘 IO 与 catalog 写入在 DirectorySessionImporter，本模块保持纯函数。
 *
 * 注意：本模块不引入 pi 的 encoded 目录名编码逻辑——候选筛选一律基于 SessionScanner
 * 给出的摘要（filePath / projectPath 已解码），避免与 SessionScanner 的私有实现重复。
 */

/** 单次扫描最多读取多少个会话（按 mtime 倒序取前 N，控制主进程 IO 与弹窗体量）。 */
export const DIRECTORY_IMPORT_MAX_SUMMARIES = 300;

/** 目录下直接含 .jsonl 文件 / 含 encoded 分组子目录，即视为「会话容器」。 */
export type DirectoryShapeProbe = {
	/** 目录直接含 .jsonl 文件（某个 encoded 分组目录，或自放会话文件的目录） */
	hasJsonl: boolean;
	/** 目录含 `--xxx--` 形态的子目录（pi sessions 根的形态） */
	hasEncodedGroups: boolean;
};

/** 选定目录的形态判定：是会话容器则按「目录内的会话文件」匹配。 */
export function isSessionContainerProbe(probe: DirectoryShapeProbe): boolean {
	return probe.hasJsonl || probe.hasEncodedGroups;
}

/** 路径归一：Windows 大小写不敏感，分隔符统一。会话文件/目录身份的比对键。 */
export function normalizeSessionPathKey(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * 文件是否位于目录内（含禁止前缀误判：`D:/work/proj` 不包含 `D:/work/proj2/a.jsonl`）。
 * 用于「候选必须落在用户选定目录里」的边界判定。
 */
export function isPathInsideRoots(filePath: string, roots: readonly string[]): boolean {
	const normalizedFile = normalizeSessionPathKey(filePath);
	return roots.some((root) => {
		const normalizedRoot = normalizeSessionPathKey(root);
		return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
	});
}

/** 会话归属目录与用户选定目录是否是同一个（大小写/分隔符归一）。 */
export function isSameDirectory(left: string | undefined, right: string | undefined): boolean {
	if (!left || !right) return false;
	return normalizeSessionPathKey(left) === normalizeSessionPathKey(right);
}

/**
 * 候选判定（纯函数）：
 * - 选定目录是会话容器（sessions 根 / 某个 encoded 分组目录）→ 只收目录内的会话文件；
 * - 选定目录是项目目录（用户按直觉选了项目路径）→ 收「会话记录里的原工作目录 == 该目录」的会话，
 *   因为 pi 的会话文件在 sessions 树里按 cwd 分组，不在项目目录里。
 * 两种情况都只认 pi sessions 树里、由扫描器给出的会话摘要。
 */
export function isDirectoryImportCandidate(input: {
	summary: SessionSummary;
	dir: string;
	pickedIsContainer: boolean;
}): boolean {
	if (isPathInsideRoots(input.summary.filePath, [input.dir])) return true;
	if (input.pickedIsContainer) return false;
	return isSameDirectory(input.summary.projectPath, input.dir);
}

/** 会话文件路径 → 弹窗标题兜底名（拿不到会话名时的文件名 stem）。 */
export function fileStemTitle(filePath: string): string {
	const base = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
	return base.replace(/\.jsonl$/i, "");
}

/** 扫描摘要 → 弹窗行（纯映射；projectPath 由扫描器从 encoded 目录名还原）。 */
export function toDirectorySessionSummary(input: {
	summary: SessionSummary;
	projectPath?: string;
	projectPathExists: boolean;
	/** catalog 里已有该文件（可能挂在别的项目下；导入 = 把归属改到当前项目） */
	alreadyImported: boolean;
}): DirectorySessionSummary {
	const title = input.summary.name?.replace(/\s+/g, " ").trim();
	return {
		id: input.summary.id,
		sourcePath: input.summary.filePath,
		title: title || fileStemTitle(input.summary.filePath),
		preview: input.summary.preview ?? "",
		...(input.projectPath ? { projectPath: input.projectPath } : {}),
		projectPathExists: input.projectPathExists,
		updatedAt: input.summary.updatedAt,
		messageCount: input.summary.messageCount,
		status: input.alreadyImported ? "current" : "new",
	};
}
