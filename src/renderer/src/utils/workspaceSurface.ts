/**
 * 定时任务管理弹框的内部路由。
 *
 * 管理界面以模态弹框呈现（见 AutomationModal），route 只决定弹框内部当前展示
 * 哪个视图，与会话选择、Tab / 分屏 chrome 完全解耦。
 */
export type AutomationWorkspaceRoute =
	| { kind: "tasks" }
	| { kind: "editor"; taskId?: string }
	| { kind: "history" }
	| { kind: "settings" };

export const DEFAULT_AUTOMATION_WORKSPACE_ROUTE: AutomationWorkspaceRoute = {
	kind: "tasks",
};
