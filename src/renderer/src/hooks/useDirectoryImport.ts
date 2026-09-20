import { useCallback, useMemo, useState } from "react";
import type { DirectoryImportReport, DirectorySessionSummary, Project } from "../../../shared/types";
import { t } from "../i18n";
import { desktopApi } from "../desktopApi";

export type DirectoryImportController = {
	sessions: DirectorySessionSummary[];
	selectedPaths: string[];
	loading: boolean;
	importing: boolean;
	report: DirectoryImportReport | null;
	/** 当前选定的来源目录（null = 还没选） */
	directory: string | null;
	/** 只看「原目录已失效」的会话：目录被移动/改名后要找回的正是这批 */
	onlyMissingCwd: boolean;
	/** 被该过滤器隐藏的会话数（各导入弹窗据此给出「显示全部」出口） */
	hiddenByFilter: number;
	setOnlyMissingCwd: (value: boolean) => void;
	chooseDirectory: () => Promise<void>;
	refresh: () => Promise<void>;
	toggle: (sourcePath: string) => void;
	toggleAll: () => void;
	importSelected: () => Promise<DirectoryImportReport | null>;
};

export type UseDirectoryImportInput = {
	setProjectMenu: (menu: null) => void;
	refreshProjectSessions: (projectId: string) => Promise<unknown>;
	showToast: (message: string, duration?: number) => void;
};

export type UseDirectoryImportOutput = {
	project: Project | null;
	setProject: React.Dispatch<React.SetStateAction<Project | null>>;
	controller: DirectoryImportController;
	open: (project: Project) => void;
};

/**
 * 外置目录会话导入的状态机（侧栏「导入其他目录的会话」）。
 *
 * 与其它导入源（Codex/Claude/...）的差别：源目录不是固定位置，而是用户现选，
 * 所以流程是「选目录 → 扫描 → 勾选 → 挂到当前项目」。没有目录时不扫描，弹窗里
 * 先给一个「选择目录」入口。默认只看原目录已失效的会话——这类才是「目录移动/改名后
 * 找不到的历史」；取消过滤后可以顺手把旧目录里还没入册的会话一起带进来。
 */
export function useDirectoryImport(input: UseDirectoryImportInput): UseDirectoryImportOutput {
	const { setProjectMenu, refreshProjectSessions, showToast } = input;
	const [project, setProject] = useState<Project | null>(null);
	const [directory, setDirectory] = useState<string | null>(null);
	const [sessions, setSessions] = useState<DirectorySessionSummary[]>([]);
	const [selected, setSelected] = useState<string[]>([]);
	const [onlyMissingCwd, setOnlyMissingCwd] = useState(true);
	const [loading, setLoading] = useState(false);
	const [importing, setImporting] = useState(false);
	const [report, setReport] = useState<DirectoryImportReport | null>(null);

	const scan = useCallback(
		async (target: Project, dir: string, clearReport = true) => {
			setLoading(true);
			if (clearReport) setReport(null);
			try {
				const next = await desktopApi.directorySessions.scan(target.id, dir);
				setSessions(next);
				setSelected([]);
			} catch (error) {
				setSessions([]);
				setSelected([]);
				showToast(
					t("directoryImport.scanFailed", {
						error: error instanceof Error ? error.message : String(error),
					}),
					4000,
				);
			} finally {
				setLoading(false);
			}
		},
		[showToast],
	);

	const chooseDirectory = useCallback(async () => {
		const target = project;
		if (!target) return;
		const picked = await desktopApi.dialog.pickFiles({
			title: t("directoryImport.chooseTitle"),
			includeDirectories: true,
		});
		const dir = picked.find((path) => Boolean(path?.trim()));
		if (!dir) return;
		setDirectory(dir);
		await scan(target, dir);
	}, [project, scan]);

	const refresh = useCallback(async () => {
		if (!project || !directory) return;
		await scan(project, directory, false);
	}, [project, directory, scan]);

	// 过滤只影响展示与「全选」范围：隐藏的行不参与导入。
	const visible = useMemo(() => (onlyMissingCwd ? sessions.filter((session) => !session.projectPathExists) : sessions), [sessions, onlyMissingCwd]);

	const toggle = useCallback((sourcePath: string) => {
		setSelected((current) => (current.includes(sourcePath) ? current.filter((item) => item !== sourcePath) : [...current, sourcePath]));
	}, []);

	const toggleAll = useCallback(() => {
		const all = visible.map((session) => session.sourcePath);
		setSelected((current) => (all.length > 0 && all.every((path) => current.includes(path)) ? [] : all));
	}, [visible]);

	const importSelected = useCallback(async () => {
		if (!project || !directory || selected.length === 0) return null;
		setImporting(true);
		setReport(null);
		try {
			const next = await desktopApi.directorySessions.import(project.id, directory, selected);
			setReport(next);
			// 导入改变的是 catalog 归属：重扫 + 重拉项目会话，行状态（已入册）立即同步。
			await scan(project, directory, false);
			await refreshProjectSessions(project.id);
			showToast(
				t("directoryImport.importDone", {
					imported: next.imported,
					failed: next.failed,
				}),
			);
			return next;
		} catch (error) {
			showToast(
				t("directoryImport.importFailed", {
					error: error instanceof Error ? error.message : String(error),
				}),
				4000,
			);
			return null;
		} finally {
			setImporting(false);
		}
	}, [project, directory, selected, scan, refreshProjectSessions, showToast]);

	const open = useCallback(
		(next: Project) => {
			setProjectMenu(null);
			setProject(next);
			setDirectory(null);
			setSessions([]);
			setSelected([]);
			setReport(null);
			setOnlyMissingCwd(true);
		},
		[setProjectMenu],
	);

	const controller = useMemo<DirectoryImportController>(
		() => ({
			sessions: visible,
			selectedPaths: selected,
			loading,
			importing,
			report,
			directory,
			onlyMissingCwd,
			hiddenByFilter: sessions.length - visible.length,
			setOnlyMissingCwd,
			chooseDirectory,
			refresh,
			toggle,
			toggleAll,
			importSelected,
		}),
		[visible, sessions.length, selected, loading, importing, report, directory, onlyMissingCwd, chooseDirectory, refresh, toggle, toggleAll, importSelected],
	);

	return { project, setProject, controller, open };
}
