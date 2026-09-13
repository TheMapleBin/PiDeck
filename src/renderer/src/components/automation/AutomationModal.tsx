import { useCallback, useState } from "react";
import { useAtom } from "jotai";
import { automationModalOpenAtom } from "../../atoms/automation-atoms";
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
 * Legacy compatibility host for the former modal atom.
 *
 * App no longer mounts this component: scheduled-task management lives in the
 * singleton AutomationWorkspace. This thin host preserves the legacy atom contract
 * without retaining a second implementation of the task-management UI.
 */
export function AutomationModal({ onViewSession }: AutomationModalProps) {
	const [open, setOpen] = useAtom(automationModalOpenAtom);
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
				className="flex h-[min(720px,calc(100vh-64px))] max-w-[min(960px,calc(100vw-48px))] flex-col overflow-hidden bg-background p-0"
			>
				<DialogHeader className="sr-only">
					<DialogTitle>{t("automation.title")}</DialogTitle>
				</DialogHeader>
				<AutomationWorkspace
					route={route}
					onRouteChange={setRoute}
					onClose={close}
					onViewSession={handleViewSession}
				/>
			</DialogContent>
		</Dialog>
	);
}
