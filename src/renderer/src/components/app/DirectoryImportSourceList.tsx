import { ChevronRight, FolderOpen } from "lucide-react";
import type { DirectorySessionSourceDir } from "../../../../shared/types";
import { t } from "../../i18n";
import { formatRelativeTime } from "../../utils/relativeTime";
import { Button } from "../ui-shadcn/button";

/** 末两段路径（与 ImportModals.displayPath 同策略），避免弹窗里铺满长路径。 */
function compactPath(path: string) {
	const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
	return parts.length <= 2 ? path : `.../${parts.slice(-2).join("/")}`;
}

/** pi 分组目录名（形如 `--D--work-old--`）：次要信息，标出磁盘上到底是哪个目录。 */
function groupFolderName(dir: string) {
	const parts = dir.replace(/\\/g, "/").split("/").filter(Boolean);
	return parts[parts.length - 1] ?? dir;
}

export type DirectoryImportSourceListProps = {
	/** 现有会话目录（主进程扫描器给出，只含真的有会话的分组目录） */
	sources: DirectorySessionSourceDir[];
	loading: boolean;
	/** 点选某个分组目录：立即扫描该目录下的会话 */
	onPick: (dir: string) => void;
	/** 列表覆盖不到时的手选目录出口（旧项目目录、sessions 根等） */
	onChooseManually: () => void;
};

/**
 * 「导入其他目录的会话」首屏：列出 pi 现有会话目录供点选。
 *
 * 为什么要有这一屏：pi 的会话目录名是编码形式（`--D--work-old--`），用户既认不出，
 * 也很容易手选到 `~/.pi` 这类祖先目录 —— 那样扫出来必然是 0 条，看起来像「功能坏了」。
 * 这里把编码名解码回原工作目录、只保留真有会话的目录，点选即必有结果；
 * 需要旧项目目录本身这类场景再走「选择其他目录…」手选。
 */
export function DirectoryImportSourceList(props: DirectoryImportSourceListProps) {
	if (props.loading && props.sources.length === 0) {
		return (
			<div className="history-loading">
				<div className="loader animate-pideck-spin" />
				<span>{t("common.loading")}</span>
			</div>
		);
	}

	if (props.sources.length === 0) {
		return (
			<div className="codex-import-empty">
				<strong>{t("directoryImport.sourceListEmpty")}</strong>
				<span>{t("directoryImport.sourceListEmptyDesc")}</span>
				<Button variant="outline" size="sm" className="mt-2 h-7 gap-1.5 rounded-lg px-2.5 text-xs shadow-none" onClick={props.onChooseManually}>
					<FolderOpen size={14} />
					{t("directoryImport.chooseDirectory")}
				</Button>
			</div>
		);
	}

	return (
		<div className="codex-session-list">
			{props.sources.map((source) => (
				<button
					key={source.dir}
					type="button"
					// 目录形态是「扫这个目录」，不是勾选会话行 —— 用按钮语义，Enter/空格同样可触发。
					className="group flex w-full items-start gap-3 rounded-lg border border-border-subtle bg-bg-panel px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent"
					onClick={() => props.onPick(source.dir)}
					title={source.dir}
				>
					<FolderOpen size={15} className="mt-0.5 shrink-0 text-text-tertiary transition-colors group-hover:text-primary" aria-hidden="true" />
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="flex min-w-0 items-center gap-2">
							<strong className="truncate text-control font-semibold text-text-primary">{source.projectPath ? compactPath(source.projectPath) : t("directoryImport.originUnknown")}</strong>
							{!source.projectPathExists && <span className="codex-status outdated shrink-0">{t("directoryImport.originMissing")}</span>}
						</span>
						<span className="truncate text-caption tabular-nums text-text-secondary">
							{t("directoryImport.sourceMeta", {
								count: source.sessionCount,
								time: formatRelativeTime(source.lastUsedAt),
							})}
						</span>
						<span className="truncate font-mono text-micro text-text-faint">{groupFolderName(source.dir)}</span>
					</span>
					<ChevronRight size={14} className="mt-0.5 shrink-0 text-text-faint transition-colors group-hover:text-primary" aria-hidden="true" />
				</button>
			))}
		</div>
	);
}
