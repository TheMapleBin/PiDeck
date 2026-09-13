/**
 * 中间工作台当前呈现的 surface。
 *
 * 会话选择与 Tab / 分屏 chrome 仍由 session-first 链路管理；utility surface
 * 只决定中间栏当前展示什么，不能伪装成普通 Session Tab。
 */
export type AutomationWorkspaceRoute =
	| { kind: "tasks" }
	| { kind: "editor"; taskId?: string }
	| { kind: "history" }
	| { kind: "settings" };

export type AutomationWorkspaceOpenOptions = {
	/** Omit for the cross-project automation overview. */
	projectId?: string;
	route?: AutomationWorkspaceRoute;
};

export type WorkspaceSurface =
	| { kind: "session" }
	| {
			kind: "automation";
			route: AutomationWorkspaceRoute;
			/** A task table may be scoped to exactly one project. */
			projectId?: string;
		};

export const DEFAULT_AUTOMATION_WORKSPACE_ROUTE: AutomationWorkspaceRoute = {
	kind: "tasks",
};

/** Creates an automation utility surface without registering a session tab. */
export function openAutomationWorkspace(
	options: AutomationWorkspaceOpenOptions = {},
): WorkspaceSurface {
	const route = options.route ?? DEFAULT_AUTOMATION_WORKSPACE_ROUTE;
	return {
		kind: "automation",
		route: { ...route },
		...(options.projectId ? { projectId: options.projectId } : {}),
	};
}

/** Restores the regular session workbench while preserving its background state. */
export function showSessionWorkspace(): WorkspaceSurface {
	return { kind: "session" };
}

export function isAutomationWorkspaceSurface(
	surface: WorkspaceSurface,
): surface is Extract<WorkspaceSurface, { kind: "automation" }> {
	return surface.kind === "automation";
}
