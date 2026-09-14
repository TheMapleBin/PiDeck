import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 用户反馈：定时任务入口藏在左下角 Dock 不明显，应放在「新建会话 / 搜索会话」下方。
const sidebar = readFileSync("src/renderer/src/components/sidebar/SidebarContent.tsx", "utf8");

test("automation entry renders under new/search session actions, not the dock", () => {
	assert.match(
		sidebar,
		/import \{ AutomationDockButton \} from "\.\.\/automation\/AutomationDockButton";/,
	);
	const newSessionIndex = sidebar.indexOf('aria-label={t("app.newSession")}');
	const searchIndex = sidebar.indexOf('aria-label={t("app.searchSessions")}');
	const automationIndex = sidebar.indexOf("<AutomationDockButton />");
	const tabsIndex = sidebar.indexOf("<Tabs");
	assert.ok(newSessionIndex > -1, "new session action missing");
	assert.ok(searchIndex > newSessionIndex, "search should follow new session");
	assert.ok(automationIndex > searchIndex, "automation entry should sit below new/search session");
	assert.ok(automationIndex < tabsIndex, "automation entry should stay in the top action block");
});

test("dock no longer hosts the automation entry", () => {
	const dockIndex = sidebar.indexOf("<Dock size={32}");
	assert.ok(dockIndex > -1, "dock section missing");
	assert.doesNotMatch(sidebar.slice(dockIndex), /AutomationDockButton/);
});

test("selecting a project or session restores the session workbench", () => {
	const app = readFileSync("src/renderer/src/App.tsx", "utf8");
	const sessionActions = readFileSync(
		"src/renderer/src/hooks/useSessionActions.ts",
		"utf8",
	);
	const surface = readFileSync(
		"src/renderer/src/utils/workspaceSurface.ts",
		"utf8",
	);

	assert.match(app, /onWorkspaceSelection: workspaceSurface\.showSession/);
	assert.match(
		sessionActions,
		/onWorkspaceSelection\?\.\(\);\s*setActiveProjectId\(projectId\);/,
	);
	assert.doesNotMatch(surface, /sessionTabIdsAtom/);
});

test("automation dock button keeps active-run indicator and opens the utility workspace", () => {
	const source = readFileSync(
		"src/renderer/src/components/automation/AutomationDockButton.tsx",
		"utf8",
	);
	const app = readFileSync("src/renderer/src/App.tsx", "utf8");
	assert.match(source, /openAutomationWorkspaceAtom/);
	assert.doesNotMatch(source, /automationModalOpenAtom/);
	assert.match(source, /automationActiveRunsAtom/);
	assert.match(source, /t\("automation\.title"\)/);
	assert.match(app, /<AutomationWorkspace/);
	assert.match(app, /workspaceSurface\.isAutomationWorkspace/);
	assert.doesNotMatch(app, /<AutomationModal/);
});
