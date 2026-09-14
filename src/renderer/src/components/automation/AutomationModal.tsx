import { useCallback, useState } from "react";
import { useAtom } from "jotai";
import {
	automationModalOpenAtom,
	automationModalProjectIdAtom,
} from "../../atoms/automation-atoms";
import { t } from "../../i18n";
import {
	DEFAULT_AUTOMATION_WORKSPACE_ROUTE,
	type AutomationWorkspaceRoute,
} from "../../utils/workspaceSurface";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "../ui-shadcn/dialog";
import { AutomationWorkspace } from "./AutomationWorkspace";

interface AutomationModalProps {
	/** 点击查看执行会话时的跳转回调（切到目标项目、打开并常驻会话 Tab） */
	onViewSession?: (projectId: string, sessionId: string) => void;
}

/**
 * 定时任务管理弹框宿主。
 *
 * 管理界面（AutomationWorkspace）以模态弹框呈现：任务表、编辑器、历史都在这
 * 个 Dialog 内，不覆盖会话工作区。projectId 由 openAutomationModalAtom 在打开时
 * 写入，支持项目菜单入口锁定到单项目任务表。
 */
export function AutomationModal({ onViewSession }: AutomationModalProps) {
	const [open, setOpen] = useAtom(automationModalOpenAtom);
	const [projectId, setProjectId] = useAtom(automationModalProjectIdAtom);
	const [route, setRoute] = useState<AutomationWorkspaceRoute>(
		DEFAULT_AUTOMATION_WORKSPACE_ROUTE,
	);

	const close = useCallback(() => {
		setOpen(false);
	}, [setOpen]);

	const handleOpenChange = useCallback((nextOpen: boolean) => {
		setOpen(nextOpen);
		if (nextOpen) setRoute(DEFAULT_AUTOMATION_WORKSPACE_ROUTE);
	}, [setOpen]);

	const handleViewSession = useCallback((projectId: string, sessionId: string) => {
		setOpen(false);
		onViewSession?.(projectId, sessionId);
	}, [onViewSession, setOpen]);

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				size="xl"
				stagger
				showCloseButton={false}
				className="flex h-[min(720px,calc(100vh-64px))] max-w-[min(960px,calc(100vw-48px))] flex-col overflow-hidden bg-background p-0"
			>
				<DialogHeader className="sr-only">
					<DialogTitle>{t("automation.title")}</DialogTitle>
				</DialogHeader>
				<AutomationWorkspace
					route={route}
					projectId={projectId ?? undefined}
					onRouteChange={setRoute}
					onClose={close}
					onViewSession={handleViewSession}
				/>
			</DialogContent>
		</Dialog>
	);
}
