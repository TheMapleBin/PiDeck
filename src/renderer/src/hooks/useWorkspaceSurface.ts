import { useAtom } from "jotai";
import { useCallback } from "react";
import { workspaceSurfaceAtom } from "../atoms/workspace-surface-atoms";
import {
	isAutomationWorkspaceSurface,
	openAutomationWorkspace,
	showSessionWorkspace,
	type AutomationWorkspaceRoute,
} from "../utils/workspaceSurface";

/**
 * Owns the middle-workbench presentation surface without coupling utility pages to
 * session selection, Tab registration, pinning, or split-pane state.
 */
export function useWorkspaceSurface() {
	const [surface, setSurface] = useAtom(workspaceSurfaceAtom);

	const showSession = useCallback(() => {
		setSurface(showSessionWorkspace());
	}, [setSurface]);

	const showAutomation = useCallback((projectId?: string) => {
		setSurface(openAutomationWorkspace({ projectId }));
	}, [setSurface]);

	const setAutomationRoute = useCallback((route: AutomationWorkspaceRoute) => {
		setSurface((current) => openAutomationWorkspace({
			route,
			...(isAutomationWorkspaceSurface(current) && current.projectId
				? { projectId: current.projectId }
				: {}),
		}));
	}, [setSurface]);

	return {
		surface,
		isAutomationWorkspace: isAutomationWorkspaceSurface(surface),
		showSession,
		showAutomation,
		setAutomationRoute,
	};
}
