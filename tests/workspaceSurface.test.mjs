import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadWorkspaceSurface() {
	const source = readFileSync("src/renderer/src/utils/workspaceSurface.ts", "utf8");
	const output = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
		fileName: "workspaceSurface.ts",
	}).outputText;
	const sandbox = { exports: {}, require: () => ({}) };
	vm.runInNewContext(output, sandbox, { filename: "workspaceSurface.ts" });
	return sandbox.exports;
}

const json = (value) => JSON.stringify(value);

test("automation workspace is a utility surface, never a session tab", () => {
	const {
		DEFAULT_AUTOMATION_WORKSPACE_ROUTE,
		isAutomationWorkspaceSurface,
		openAutomationWorkspace,
		showSessionWorkspace,
	} = loadWorkspaceSurface();

	const automation = openAutomationWorkspace();
	assert.equal(automation.kind, "automation");
	assert.equal(json(automation.route), json(DEFAULT_AUTOMATION_WORKSPACE_ROUTE));
	assert.equal(isAutomationWorkspaceSurface(automation), true);
	assert.equal(isAutomationWorkspaceSurface(showSessionWorkspace()), false);
});

test("automation workspace preserves a project scope and explicit internal route", () => {
	const { openAutomationWorkspace } = loadWorkspaceSurface();
	const surface = openAutomationWorkspace({
		projectId: "project-42",
		route: { kind: "editor", taskId: "task-42" },
	});
	assert.equal(surface.kind, "automation");
	assert.equal(surface.projectId, "project-42");
	assert.equal(
		json(surface.route),
		json({ kind: "editor", taskId: "task-42" }),
	);
});
