// ── Codex Session Import Types ─────────────────────────────────────────

export type CodexImportStatus = "new" | "current" | "outdated";

export type CodexSessionSummary = {
	id: string;
	sourcePath: string;
	targetPath: string;
	cwd: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	status: CodexImportStatus;
	sourceSize: number;
	importedSourceMtime?: number;
	threadSource?: "user" | "subagent";
	parentThreadId?: string;
	agentRole?: string;
	agentNickname?: string;
};

export type CodexImportResult = {
	id: string;
	sourcePath: string;
	targetPath?: string;
	title?: string;
	success: boolean;
	overwritten?: boolean;
	messageCount?: number;
	error?: string;
};

export type CodexImportReport = {
	results: CodexImportResult[];
	imported: number;
	failed: number;
};

// ── Claude Session Import Types ────────────────────────────────────────

export type ClaudeImportStatus = "new" | "current" | "outdated";

export type ClaudeSessionSummary = {
	id: string;
	sourcePath: string;
	targetPath: string;
	cwd: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	status: ClaudeImportStatus;
	sourceSize: number;
	importedSourceMtime?: number;
};

export type ClaudeImportResult = {
	id: string;
	sourcePath: string;
	targetPath?: string;
	title?: string;
	success: boolean;
	overwritten?: boolean;
	messageCount?: number;
	error?: string;
};

export type ClaudeImportReport = {
	results: ClaudeImportResult[];
	imported: number;
	failed: number;
};

// ── OpenCode Session Import Types ──────────────────────────────────────

export type OpenCodeImportStatus = "new" | "current" | "outdated";

export type OpenCodeSessionSummary = {
	id: string;
	sourcePath: string;
	targetPath: string;
	cwd: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	status: OpenCodeImportStatus;
	sourceSize: number;
	importedSourceMtime?: number;
};

export type OpenCodeImportResult = {
	id: string;
	sourcePath: string;
	targetPath?: string;
	title?: string;
	success: boolean;
	overwritten?: boolean;
	messageCount?: number;
	error?: string;
};

export type OpenCodeImportReport = {
	results: OpenCodeImportResult[];
	imported: number;
	failed: number;
};

// ── ZCode Session Import Types ────────────────────────────────────────

/** zcode 会话导入状态：未导入 / 已是最新 / 源更新后可覆盖。 */
export type ZCodeImportStatus = "new" | "current" | "outdated";

export type ZCodeSessionSummary = {
	id: string;
	sourcePath: string;
	targetPath: string;
	cwd: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	status: ZCodeImportStatus;
	sourceSize: number;
	importedSourceMtime?: number;
};

export type ZCodeImportResult = {
	id: string;
	sourcePath: string;
	targetPath?: string;
	title?: string;
	success: boolean;
	overwritten?: boolean;
	messageCount?: number;
	error?: string;
};

export type ZCodeImportReport = {
	results: ZCodeImportResult[];
	imported: number;
	failed: number;
};

// ── WorkBuddy Session Import Types ─────────────────────────────────────

/** WorkBuddy 会话导入状态：未导入 / 已是最新 / 源更新后可覆盖。 */
export type WorkBuddyImportStatus = "new" | "current" | "outdated";

export type WorkBuddySessionSummary = {
	id: string;
	sourcePath: string;
	targetPath: string;
	cwd: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	status: WorkBuddyImportStatus;
	sourceSize: number;
	importedSourceMtime?: number;
};

export type WorkBuddyImportResult = {
	id: string;
	sourcePath: string;
	targetPath?: string;
	title?: string;
	success: boolean;
	overwritten?: boolean;
	messageCount?: number;
	error?: string;
};

export type WorkBuddyImportReport = {
	results: WorkBuddyImportResult[];
	imported: number;
	failed: number;
};

// ── Cursor Session Import Types ────────────────────────────────────────

/** Cursor 会话导入状态：未导入 / 已是最新 / 源更新后可覆盖。 */
export type CursorImportStatus = "new" | "current" | "outdated";

export type CursorSessionSummary = {
	id: string;
	sourcePath: string;
	targetPath: string;
	cwd: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	status: CursorImportStatus;
	sourceSize: number;
	importedSourceMtime?: number;
};

export type CursorImportResult = {
	id: string;
	sourcePath: string;
	targetPath?: string;
	title?: string;
	success: boolean;
	overwritten?: boolean;
	messageCount?: number;
	error?: string;
};

export type CursorImportReport = {
	results: CursorImportResult[];
	imported: number;
	failed: number;
};

// ── Directory (外置目录) Session Import Types ──────────────────────────
//
// 场景：项目目录被移动/改名后，pi 会话仍按「旧 cwd 的 encoded 分组目录」留在
// ~/.pi/agent/sessions 下，与新项目的路径不再匹配 → 侧栏看不到历史。
// 该导入源让用户手动指一个目录（旧项目目录 / pi sessions 根 / 某个 encoded 分组目录），
// 把其中的会话挂到当前项目下（只建 catalog 引用，不复制、不改写原文件）。

/** 目录会话导入状态：未入册 / 已在 catalog（导入 = 把归属改到当前项目）。 */
export type DirectoryImportStatus = "new" | "current";

export type DirectorySessionSummary = {
	id: string;
	/** 会话 JSONL 绝对路径（导入后即 catalog 的 filePath，原文件保持原地） */
	sourcePath: string;
	title: string;
	preview: string;
	/** 会话记录里的原工作目录（由 encoded 目录名还原；可能已被移动/改名/删除） */
	projectPath?: string;
	/** 原工作目录当前是否仍在磁盘上（false = 目录失效，正是要找回的历史） */
	projectPathExists: boolean;
	updatedAt: number;
	messageCount: number;
	/** 文件字节数（弹窗展示用；扫描失败时为 0） */
	sourceSize?: number;
	status: DirectoryImportStatus;
};

export type DirectoryImportResult = {
	id: string;
	sourcePath: string;
	success: boolean;
	title?: string;
	error?: string;
};

export type DirectoryImportReport = {
	results: DirectoryImportResult[];
	imported: number;
	failed: number;
};
