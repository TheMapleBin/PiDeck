import { app } from "electron";
import { utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	CursorImportReport,
	CursorImportResult,
	CursorImportStatus,
	CursorSessionSummary,
} from "../../shared/types";
import { convertCursorSession } from "./cursorSessionConvert";
import { defaultSessionImportCopy, type SessionImportCopy } from "./SessionImportCopy";
import {
	collectCursorTranscripts,
	ensureProjectSessionDir,
	getCursorProjectDir,
	getCursorTargetPath,
	readCursorImportMeta,
	readCursorSession,
	type ParsedCursorSession,
} from "./cursorSessionSource";

/**
 * 导入 Cursor Agent（~/.cursor/projects/<slug>/agent-transcripts）会话为 pi 原生会话文件。
 * 与 Claude/Codex/OpenCode/ZCode/WorkBuddy 导入器同构：扫描源目录 → 转换为 pi JSONL → 写入 ~/.pi。
 * 解析与转换分别落在 cursorSessionSource / cursorSessionConvert，本类只做编排。
 */
export class CursorSessionImporter {
	private readonly cursorRoot = join(app.getPath("home"), ".cursor", "projects");
	private readonly piRoot = join(app.getPath("home"), ".pi", "agent", "sessions");

	constructor(private readonly translate: SessionImportCopy = defaultSessionImportCopy) {}

	async scan(projectPath: string): Promise<CursorSessionSummary[]> {
		const projectDir = getCursorProjectDir(this.cursorRoot, projectPath);
		const files = await collectCursorTranscripts(projectDir).catch(() => []);
		const sessions = await Promise.all(
			files.map((file) => readCursorSession(this.cursorRoot, file).catch(() => null)),
		);

		const summaries = await Promise.all(
			sessions
				.filter((session): session is ParsedCursorSession => Boolean(session))
				.map((session) => this.toSummary(session, projectPath)),
		);

		return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
	}

	async import(projectPath: string, sourcePaths: string[]): Promise<CursorImportReport> {
		const results: CursorImportResult[] = [];
		for (const sourcePath of sourcePaths) {
			results.push(await this.importOne(projectPath, sourcePath));
		}
		return {
			results,
			imported: results.filter((result) => result.success).length,
			failed: results.filter((result) => result.success === false).length,
		};
	}

	private async importOne(
		projectPath: string,
		sourcePath: string,
	): Promise<CursorImportResult> {
		try {
			const parsed = await readCursorSession(this.cursorRoot, sourcePath);
			const targetPath = getCursorTargetPath(this.piRoot, projectPath, parsed);
			const existing = await readCursorImportMeta(targetPath);
			const converted = convertCursorSession({
				projectPath,
				session: parsed,
				translate: this.translate,
			});
			await ensureProjectSessionDir(this.piRoot, projectPath);
			await writeFile(targetPath, converted.raw, "utf8");
			// 侧栏列表时间取文件 mtime：写入后回调为会话真实最后时间，避免导入会话
			// 全部显示为「刚刚导入」并排序置顶（与其他导入器同口径）。
			if (parsed.meta.lastTimestamp > 0) {
				const stamp = new Date(parsed.meta.lastTimestamp);
				await utimes(targetPath, stamp, stamp);
			}

			return {
				id: parsed.meta.sessionId,
				sourcePath,
				targetPath,
				title: converted.title,
				success: true,
				overwritten: Boolean(existing),
				messageCount: converted.messageCount,
			};
		} catch (error) {
			return {
				id: sourcePath,
				sourcePath,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private async toSummary(
		session: ParsedCursorSession,
		projectPath: string,
	): Promise<CursorSessionSummary> {
		const targetPath = getCursorTargetPath(this.piRoot, projectPath, session);
		const importMeta = await readCursorImportMeta(targetPath);
		const converted = convertCursorSession({
			projectPath,
			session,
			translate: this.translate,
		});
		const status: CursorImportStatus = !importMeta
			? "new"
			: importMeta.sourceMtime === session.sourceMtime &&
			  importMeta.sourceSize === session.sourceSize
			? "current"
			: "outdated";

		return {
			id: session.meta.sessionId,
			sourcePath: session.sourcePath,
			targetPath,
			cwd: projectPath,
			title: converted.title,
			preview: converted.preview,
			createdAt: session.meta.firstTimestamp,
			updatedAt: session.meta.lastTimestamp,
			messageCount: converted.messageCount,
			status,
			sourceSize: session.sourceSize,
			importedSourceMtime: importMeta?.sourceMtime,
		};
	}
}
