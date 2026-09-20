import { useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui-shadcn/button";
import { X } from "lucide-react";
import { Check, FolderOpen, RefreshCw, UploadCloud } from "lucide-react";
import { t } from "../../i18n";
import type { TranslationKey } from "../../i18n";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "../ui-shadcn/dialog";
import type {
	CodexSessionSummary,
	CodexImportReport,
	ClaudeSessionSummary,
	ClaudeImportReport,
	OpenCodeSessionSummary,
	OpenCodeImportReport,
	ZCodeSessionSummary,
	ZCodeImportReport,
	WorkBuddySessionSummary,
	WorkBuddyImportReport,
	CursorSessionSummary,
	CursorImportReport,
	DirectorySessionSummary,
	DirectorySessionSourceDir,
	DirectorySourceKind,
	DirectoryImportReport,
	Project,
} from "../../../../shared/types";
import { Checkbox } from "../ui-shadcn/checkbox";
import { Label } from "../../components/ui-shadcn/label";
import { DirectoryImportSourceList } from "./DirectoryImportSourceList";

function displayPath(path?: string) {
	if (!path) return "";
	const normalized = path.replace(/\\/g, "/");
	const parts = normalized.split("/");
	if (parts.length <= 2) return normalized;
	return `.../${parts.slice(-2).join("/")}`;
}

function formatBytes(value: number) {
	if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
	if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
	return `${value} B`;
}

function formatCodexStatus(status: CodexSessionSummary["status"]) {
	if (status === "current") return t("codex.status.current");
	if (status === "outdated") return t("codex.status.outdated");
	return t("codex.status.new");
}

function groupCodexSessions(sessions: CodexSessionSummary[]) {
	const parentById = new Map(sessions.map((session) => [session.id, session]));
	const childrenByParent = new Map<string, CodexSessionSummary[]>();
	const orphanSubagents: CodexSessionSummary[] = [];
	const parents = sessions.filter((session) => session.threadSource !== "subagent");

	for (const session of sessions) {
		if (session.threadSource !== "subagent") continue;
		const parentId = session.parentThreadId;
		if (parentId && parentById.has(parentId)) {
			const children = childrenByParent.get(parentId) ?? [];
			children.push(session);
			childrenByParent.set(parentId, children);
		} else {
			orphanSubagents.push(session);
		}
	}

	return { parents, childrenByParent, orphanSubagents };
}

function codexSubagentLabel(session: CodexSessionSummary) {
	const parts = [session.agentNickname, session.agentRole].filter(Boolean);
	return parts.length ? parts.join(" · ") : t("codex.subagent");
}

function formatClaudeStatus(status: ClaudeSessionSummary["status"]) {
	if (status === "current") return t("claude.status.current");
	if (status === "outdated") return t("claude.status.outdated");
	return t("claude.status.new");
}

function formatOpenCodeStatus(status: OpenCodeSessionSummary["status"]) {
	if (status === "current") return t("opencode.status.current");
	if (status === "outdated") return t("opencode.status.outdated");
	return t("opencode.status.new");
}

function formatZCodeStatus(status: ZCodeSessionSummary["status"]) {
	if (status === "current") return t("zcode.status.current");
	if (status === "outdated") return t("zcode.status.outdated");
	return t("zcode.status.new");
}

export function CodexImportModal(props: {
	project: Project;
	sessions: CodexSessionSummary[];
	selectedPaths: string[];
	loading: boolean;
	importing: boolean;
	report: CodexImportReport | null;
	onClose: () => void;
	onRefresh: () => void;
	onToggle: (sourcePath: string) => void;
	onToggleAll: () => void;
	onImport: () => void;
}) {
	const [expandedSubagents, setExpandedSubagents] = useState<Set<string>>(() => new Set());
	const [showOrphanSubagents, setShowOrphanSubagents] = useState(false);
	const selected = new Set(props.selectedPaths);
	const grouped = groupCodexSessions(props.sessions);
	const selectableParents = grouped.parents;
	const allSelected = selectableParents.length > 0 && selectableParents.every((session) => selected.has(session.sourcePath));
	const toggleSubagents = (parentId: string) => {
		setExpandedSubagents((current) => {
			const next = new Set(current);
			if (next.has(parentId)) next.delete(parentId);
			else next.add(parentId);
			return next;
		});
	};
	const renderRow = (session: CodexSessionSummary, className = "codex-session-row") => (
		<Label key={session.sourcePath} className={className}>
			<Checkbox checked={selected.has(session.sourcePath)} onCheckedChange={() => props.onToggle(session.sourcePath)} />
			<div className="codex-session-main">
				<div className="codex-session-title">
					<strong>{session.title}</strong>
					{session.threadSource === "subagent" && <span className="codex-status subagent">{codexSubagentLabel(session)}</span>}
					<span className={`codex-status ${session.status}`}>{formatCodexStatus(session.status)}</span>
				</div>
				<p>{session.preview}</p>
				<small>
					{new Date(session.updatedAt).toLocaleString()} ·{" "}
					{t("drawer.sessionMessages", {
						count: session.messageCount,
					})}{" "}
					· {formatBytes(session.sourceSize)}
				</small>
			</div>
		</Label>
	);
	return (
		<Dialog open onOpenChange={(next) => !next && props.onClose()}>
			<DialogContent showCloseButton={false} className={cn("flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(800px,calc(100vw-48px))]", "codex-import-modal")}>
				<DialogHeader className="flex-row items-center justify-between px-4 py-3">
					<DialogTitle>{t("codex.title")}</DialogTitle>
					<DialogClose asChild>
						<Button variant="ghost" size="icon" aria-label={t("common.close")} title={t("common.close")}>
							<X size={18} strokeWidth={2.2} aria-hidden="true" />
						</Button>
					</DialogClose>
				</DialogHeader>
				<div className="modal-header-sub">
					<small>{props.project.name}</small>
				</div>
				<div className="codex-import-toolbar">
					<div>
						<strong>{t("codex.importCount", { count: props.sessions.length })}</strong>
						<span>{displayPath(props.project.path)}</span>
					</div>
					<div className="codex-import-actions">
						<Button variant="outline" size="sm" className="h-7 px-2.5 text-xs shadow-none rounded-lg gap-1.5" onClick={props.onRefresh} disabled={props.loading || props.importing}>
							<RefreshCw size={14} />
							{t("common.refresh")}
						</Button>
						<Button variant="outline" size="sm" className="h-7 px-2.5 text-xs shadow-none rounded-lg gap-1.5" onClick={props.onToggleAll} disabled={props.sessions.length === 0}>
							<Check size={14} />
							{allSelected ? t("codex.selectNone") : t("common.selectAll")}
						</Button>
						<Button variant="default" size="sm" className="primary-action h-7 px-2.5 text-xs shadow-none rounded-lg gap-1.5" onClick={props.onImport} disabled={props.importing || props.selectedPaths.length === 0}>
							<UploadCloud size={14} />
							{props.importing
								? t("codex.importing")
								: t("codex.importSelected", {
										count: props.selectedPaths.length,
									})}
						</Button>
					</div>
				</div>
				<div className="codex-import-body">
					{props.loading ? (
						<div className="history-loading">
							<div className="loader animate-pideck-spin" />
							<span>{t("codex.scanning")}</span>
						</div>
					) : props.sessions.length === 0 ? (
						<div className="codex-import-empty">
							<strong>{t("codex.emptyTitle")}</strong>
							<span>{t("codex.emptyDesc")}</span>
						</div>
					) : (
						<div className="codex-session-list">
							{grouped.parents.map((session) => {
								const children = grouped.childrenByParent.get(session.id) ?? [];
								const expanded = expandedSubagents.has(session.id);
								return (
									<div key={session.sourcePath} className="codex-session-group">
										{renderRow(session)}
										{children.length > 0 && (
											<Button type="button" variant="ghost" size="sm" className="codex-subagent-toggle h-auto px-1.5 text-xs" onClick={() => toggleSubagents(session.id)}>
												{expanded ? t("codex.hideSubagents", { count: children.length }) : t("codex.showSubagents", { count: children.length })}
											</Button>
										)}
										{expanded && children.length > 0 && <div className="codex-subagent-list">{children.map((child) => renderRow(child, "codex-session-row codex-subagent-row"))}</div>}
									</div>
								);
							})}
							{grouped.orphanSubagents.length > 0 && (
								<div className="codex-session-group">
									<Button type="button" variant="ghost" size="sm" className="codex-subagent-toggle h-auto px-1.5 text-xs codex-orphan-subagents-title" onClick={() => setShowOrphanSubagents((current) => !current)}>
										{t("codex.orphanSubagents", { count: grouped.orphanSubagents.length })}
									</Button>
									{showOrphanSubagents && <div className="codex-subagent-list">{grouped.orphanSubagents.map((session) => renderRow(session, "codex-session-row codex-subagent-row"))}</div>}
								</div>
							)}
						</div>
					)}
				</div>
				{props.report && (
					<div className="codex-import-report">
						<strong>
							{t("codex.importDone", {
								imported: props.report.imported,
								failed: props.report.failed,
							})}
						</strong>
						<div>
							{props.report.results.map((result) => (
								<span key={result.sourcePath} className={result.success ? "success" : "error"} title={result.error || result.targetPath}>
									{result.success ? "✓" : "✗"} {result.title || result.sourcePath}
								</span>
							))}
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

export function ClaudeImportModal(props: {
	project: Project;
	sessions: ClaudeSessionSummary[];
	selectedPaths: string[];
	loading: boolean;
	importing: boolean;
	report: ClaudeImportReport | null;
	onClose: () => void;
	onRefresh: () => void;
	onToggle: (sourcePath: string) => void;
	onToggleAll: () => void;
	onImport: () => void;
}) {
	return <SessionImportModal copyPrefix="claude" formatStatus={formatClaudeStatus} {...props} />;
}

export function OpenCodeImportModal(props: {
	project: Project;
	sessions: OpenCodeSessionSummary[];
	selectedPaths: string[];
	loading: boolean;
	importing: boolean;
	report: OpenCodeImportReport | null;
	onClose: () => void;
	onRefresh: () => void;
	onToggle: (sourcePath: string) => void;
	onToggleAll: () => void;
	onImport: () => void;
}) {
	return <SessionImportModal copyPrefix="opencode" formatStatus={formatOpenCodeStatus} {...props} />;
}

export function ZCodeImportModal(props: {
	project: Project;
	sessions: ZCodeSessionSummary[];
	selectedPaths: string[];
	loading: boolean;
	importing: boolean;
	report: ZCodeImportReport | null;
	onClose: () => void;
	onRefresh: () => void;
	onToggle: (sourcePath: string) => void;
	onToggleAll: () => void;
	onImport: () => void;
}) {
	return <SessionImportModal copyPrefix="zcode" formatStatus={formatZCodeStatus} {...props} />;
}
type ImportStatusValue = "new" | "current" | "outdated";

/** 会话列表项的最小公共形状：Claude / OpenCode / ZCode / WorkBuddy / Cursor 汇总结构一致。 */
type ImportSessionLike = {
	sourcePath: string;
	title: string;
	preview: string;
	updatedAt: number;
	messageCount: number;
	/** 源文件字节数；目录导入的行没有该字段（缺省按 0 展示，由 renderMeta 覆盖）。 */
	sourceSize?: number;
	status: ImportStatusValue;
};

type ImportResultLike = {
	sourcePath: string;
	success: boolean;
	title?: string;
	error?: string;
	targetPath?: string;
};

/**
 * 通用会话导入弹窗：除 Codex（需子代理分组）外的导入源 UI 完全一致，
 * 只有文案前缀与状态文案不同，收敛成一个泛型组件避免逐源复制。
 */
function SessionImportModal<T extends ImportSessionLike>(props: {
	copyPrefix: string;
	formatStatus: (status: ImportStatusValue) => string;
	project: Project;
	sessions: T[];
	selectedPaths: string[];
	loading: boolean;
	importing: boolean;
	report: { results: ImportResultLike[]; imported: number; failed: number } | null;
	onClose: () => void;
	onRefresh: () => void;
	onToggle: (sourcePath: string) => void;
	onToggleAll: () => void;
	onImport: () => void;
	/** 头部附加控件（目录导入的「来源目录 + 只看失效目录」）；缺省不渲染。 */
	headerExtra?: ReactNode;
	/** 头部副标题（缺省展示项目名）；目录导入用它标出「目标项目」。 */
	headerSubtitle?: ReactNode;
	/** 工具栏左侧文案（目录导入首屏换成「现有会话目录」）；缺省为「N 个会话 + 项目路径」。 */
	toolbarCopy?: { title: ReactNode; hint?: ReactNode };
	/** 工具栏右侧按钮组（目录导入首屏换成「选目录 + 刷新」）；缺省为刷新/全选/导入。 */
	toolbarActions?: ReactNode;
	/** 弹窗主体内容（目录导入首屏用会话目录列表替代会话行）；缺省按 loading/空态/列表渲染。 */
	bodyOverride?: ReactNode;
	/** 空列表时的替代内容（目录导入被过滤器清空时的提示 +「显示全部」）；缺省用通用空态。 */
	emptyOverride?: ReactNode;
	/** 行内附加元信息（目录导入展示原工作目录）；缺省展示源文件体积。 */
	renderMeta?: (session: T) => ReactNode;
}) {
	const selected = new Set(props.selectedPaths);
	const allSelected = props.sessions.length > 0 && props.sessions.every((session) => selected.has(session.sourcePath));
	const copy = (key: string, params?: Record<string, string | number>) => t(`${props.copyPrefix}.${key}` as TranslationKey, params);
	return (
		<Dialog open onOpenChange={(next) => !next && props.onClose()}>
			<DialogContent showCloseButton={false} className={cn("flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(800px,calc(100vw-48px))]", "codex-import-modal")}>
				<DialogHeader className="flex-row items-center justify-between px-4 py-3">
					<DialogTitle>{copy("title")}</DialogTitle>
					<DialogClose asChild>
						<Button variant="ghost" size="icon" aria-label={t("common.close")} title={t("common.close")}>
							<X size={18} strokeWidth={2.2} aria-hidden="true" />
						</Button>
					</DialogClose>
				</DialogHeader>
				<div className="modal-header-sub">
					<small>{props.headerSubtitle ?? props.project.name}</small>
				</div>
				{props.headerExtra}
				<div className="codex-import-toolbar">
					<div>
						<strong>{props.toolbarCopy?.title ?? copy("importCount", { count: props.sessions.length })}</strong>
						<span>{props.toolbarCopy?.hint ?? displayPath(props.project.path)}</span>
					</div>
					<div className="codex-import-actions">
						{props.toolbarActions ?? (
							<>
								<Button variant="outline" size="sm" className="h-7 px-2.5 text-xs shadow-none rounded-lg gap-1.5" onClick={props.onRefresh} disabled={props.loading || props.importing}>
									<RefreshCw size={14} />
									{t("common.refresh")}
								</Button>
								<Button variant="outline" size="sm" className="h-7 px-2.5 text-xs shadow-none rounded-lg gap-1.5" onClick={props.onToggleAll} disabled={props.sessions.length === 0}>
									<Check size={14} />
									{allSelected ? copy("selectNone") : t("common.selectAll")}
								</Button>
								<Button variant="default" size="sm" className="primary-action h-7 px-2.5 text-xs shadow-none rounded-lg gap-1.5" onClick={props.onImport} disabled={props.importing || props.selectedPaths.length === 0}>
									<UploadCloud size={14} />
									{props.importing ? copy("importing") : copy("importSelected", { count: props.selectedPaths.length })}
								</Button>
							</>
						)}
					</div>
				</div>
				<div className="codex-import-body">
					{props.bodyOverride ? (
						props.bodyOverride
					) : props.loading ? (
						<div className="history-loading">
							<div className="loader animate-pideck-spin" />
							<span>{copy("scanning")}</span>
						</div>
					) : props.sessions.length === 0 ? (
						(props.emptyOverride ?? (
							<div className="codex-import-empty">
								<strong>{copy("emptyTitle")}</strong>
								<span>{copy("emptyDesc")}</span>
							</div>
						))
					) : (
						<div className="codex-session-list">
							{props.sessions.map((session) => (
								<Label key={session.sourcePath} className="codex-session-row">
									<Checkbox checked={selected.has(session.sourcePath)} onCheckedChange={() => props.onToggle(session.sourcePath)} />
									<div className="codex-session-main">
										<div className="codex-session-title">
											<strong>{session.title}</strong>
											<span className={`codex-status ${session.status}`}>{props.formatStatus(session.status)}</span>
										</div>
										<p>{session.preview}</p>
										<small>
											{new Date(session.updatedAt).toLocaleString()} · {t("drawer.sessionMessages", { count: session.messageCount })} · {props.renderMeta ? props.renderMeta(session) : formatBytes(session.sourceSize ?? 0)}
										</small>
									</div>
								</Label>
							))}
						</div>
					)}
				</div>
				{props.report && (
					<div className="codex-import-report">
						<strong>
							{copy("importDone", {
								imported: props.report.imported,
								failed: props.report.failed,
							})}
						</strong>
						<div>
							{props.report.results.map((result) => (
								<span key={result.sourcePath} className={result.success ? "success" : "error"} title={result.error || result.targetPath}>
									{result.success ? "✓" : "✗"} {result.title || result.sourcePath}
								</span>
							))}
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

function formatWorkBuddyStatus(status: WorkBuddySessionSummary["status"]) {
	if (status === "current") return t("workbuddy.status.current");
	if (status === "outdated") return t("workbuddy.status.outdated");
	return t("workbuddy.status.new");
}

export function WorkBuddyImportModal(props: {
	project: Project;
	sessions: WorkBuddySessionSummary[];
	selectedPaths: string[];
	loading: boolean;
	importing: boolean;
	report: WorkBuddyImportReport | null;
	onClose: () => void;
	onRefresh: () => void;
	onToggle: (sourcePath: string) => void;
	onToggleAll: () => void;
	onImport: () => void;
}) {
	return <SessionImportModal copyPrefix="workbuddy" formatStatus={formatWorkBuddyStatus} {...props} />;
}

function formatCursorStatus(status: CursorSessionSummary["status"]) {
	if (status === "current") return t("cursor.status.current");
	if (status === "outdated") return t("cursor.status.outdated");
	return t("cursor.status.new");
}

function formatDirectoryStatus(status: ImportStatusValue) {
	return status === "current" ? t("directoryImport.status.current") : t("directoryImport.status.new");
}

/**
 * 目录会话导入弹窗（项目目录移动/改名后找回历史）。
 *
 * 与其它导入源不同：源目录不是固定位置 —— 首屏先列出 pi 现有会话目录（点选即扫，必有结果），
 * 手选任意目录作为兜底；已选目录时可一键清除回到列表，避免困在选错的目录（如 ~/.pi）里。
 * 行内元信息展示会话记录里的原工作目录（失效时标注），而不是源文件体积。
 */
export function DirectoryImportModal(props: {
	project: Project;
	sessions: DirectorySessionSummary[];
	selectedPaths: string[];
	loading: boolean;
	importing: boolean;
	report: DirectoryImportReport | null;
	directory: string | null;
	/** 本次扫描的目录形态（ancestor = 用户选到了 ~/.pi 这类会话树祖先目录） */
	scanKind: DirectorySourceKind | null;
	/** pi 现有会话目录列表（首屏点选入口） */
	sources: DirectorySessionSourceDir[];
	sourcesLoading: boolean;
	onlyMissingCwd: boolean;
	/** 被「只看原目录已失效」过滤掉的会话数（>0 时给出一键显示全部的出口）。 */
	hiddenByFilter: number;
	onSetOnlyMissingCwd: (value: boolean) => void;
	onChooseDirectory: () => void;
	/** 点选首屏列表里的会话目录 */
	onChooseSourceDir: (dir: string) => void;
	/** 清除已选目录，回到首屏列表 */
	onClearDirectory: () => void;
	onRefreshSources: () => void;
	onClose: () => void;
	onRefresh: () => void;
	onToggle: (sourcePath: string) => void;
	onToggleAll: () => void;
	onImport: () => void;
}) {
	// 未选目录 = 首屏：工具栏与主体换成「现有会话目录」列表（没有源目录可扫时不摆无关的会话工具）。
	const pickingSource = props.directory === null;
	return (
		<SessionImportModal
			copyPrefix="directoryImport"
			formatStatus={formatDirectoryStatus}
			project={props.project}
			sessions={props.sessions}
			selectedPaths={props.selectedPaths}
			loading={props.loading}
			importing={props.importing}
			report={props.report}
			onClose={props.onClose}
			onRefresh={props.onRefresh}
			onToggle={props.onToggle}
			onToggleAll={props.onToggleAll}
			onImport={props.onImport}
			headerSubtitle={
				<>
					{t("directoryImport.targetProject")}
					<strong className="ml-1 text-text-primary">{props.project.name}</strong>
				</>
			}
			headerExtra={
				<div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-xs text-muted-foreground">
					<span className="whitespace-nowrap">{t("directoryImport.sourceLabel")}</span>
					<span className="flex min-w-0 flex-1 items-center gap-1.5">
						<code className="min-w-0 truncate" title={props.directory ?? undefined}>
							{props.directory ?? t("directoryImport.noDirectory")}
						</code>
						{props.directory && (
							<Button variant="ghost" size="sm" className="h-6 shrink-0 px-1.5 text-xs" onClick={props.onClearDirectory} disabled={props.importing}>
								{t("directoryImport.clearDirectory")}
							</Button>
						)}
					</span>
					{/* 过滤器只在已有会话行时有意义：首屏列表是「选目录」，摆过滤开关只会让人以为没扫到东西。 */}
					{!pickingSource && (
						<Label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap">
							<Checkbox checked={props.onlyMissingCwd} onCheckedChange={(value) => props.onSetOnlyMissingCwd(Boolean(value))} />
							{t("directoryImport.onlyMissingCwd")}
						</Label>
					)}
				</div>
			}
			toolbarCopy={
				pickingSource
					? {
							title: t("directoryImport.sourceListTitle", { count: props.sources.length }),
							hint: t("directoryImport.sourceListDesc"),
						}
					: undefined
			}
			toolbarActions={
				pickingSource ? (
					<>
						<Button variant="outline" size="sm" className="h-7 px-2.5 text-xs shadow-none rounded-lg gap-1.5" onClick={props.onChooseDirectory}>
							<FolderOpen size={14} />
							{t("directoryImport.chooseOther")}
						</Button>
						<Button variant="outline" size="sm" className="h-7 px-2.5 text-xs shadow-none rounded-lg gap-1.5" onClick={props.onRefreshSources} disabled={props.sourcesLoading}>
							<RefreshCw size={14} />
							{t("common.refresh")}
						</Button>
					</>
				) : undefined
			}
			bodyOverride={pickingSource ? <DirectoryImportSourceList sources={props.sources} loading={props.sourcesLoading} onPick={props.onChooseSourceDir} onChooseManually={props.onChooseDirectory} /> : undefined}
			renderMeta={(session) =>
				session.projectPath ? (
					<span title={session.projectPath}>
						{t("directoryImport.originDir", { path: displayPath(session.projectPath) })}
						{!session.projectPathExists && ` · ${t("directoryImport.originMissing")}`}
					</span>
				) : (
					<span>{t("directoryImport.originUnknown")}</span>
				)
			}
			emptyOverride={
				props.scanKind === "ancestor" ? (
					// 选到会话树的祖先目录（~/.pi 等）：扫描器会返回 kind=ancestor 与 0 条结果，
					// 必须解释「为什么是空的」并给回到目录列表的出口，否则用户会以为功能坏了。
					<div className="codex-import-empty">
						<strong>{t("directoryImport.ancestorTitle")}</strong>
						<span>{t("directoryImport.ancestorDesc", { path: displayPath(props.directory ?? "") })}</span>
						<Button variant="outline" size="sm" className="mt-2 h-7 gap-1.5 rounded-lg px-2.5 text-xs shadow-none" onClick={props.onClearDirectory}>
							{t("directoryImport.backToSourceList")}
						</Button>
					</div>
				) : props.hiddenByFilter > 0 ? (
					<div className="codex-import-empty">
						<strong>{t("directoryImport.filteredTitle", { count: props.hiddenByFilter })}</strong>
						<span>{t("directoryImport.filteredDesc")}</span>
						<Button variant="outline" size="sm" className="mt-2 h-7 gap-1.5 rounded-lg px-2.5 text-xs shadow-none" onClick={() => props.onSetOnlyMissingCwd(false)}>
							{t("directoryImport.showAll")}
						</Button>
					</div>
				) : undefined
			}
		/>
	);
}

export function CursorImportModal(props: {
	project: Project;
	sessions: CursorSessionSummary[];
	selectedPaths: string[];
	loading: boolean;
	importing: boolean;
	report: CursorImportReport | null;
	onClose: () => void;
	onRefresh: () => void;
	onToggle: (sourcePath: string) => void;
	onToggleAll: () => void;
	onImport: () => void;
}) {
	return <SessionImportModal copyPrefix="cursor" formatStatus={formatCursorStatus} {...props} />;
}
