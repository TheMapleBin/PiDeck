import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

// boundMountedSteps：单轮步骤的挂载预算（2026-08 #213）。
// 回归背景：turnRenderWindow 只按轮数裁剪，极端会话里「一轮」可以含上百个
// 工具/思考条目，一次全挂进 DOM 就是上千个 ToolStep 子树 → 渲染进程 OOM。
// 契约：默认只挂尾部预算条，更早的靠「显示更早 N 条步骤」显式展开（内容不丢）。

function compile(filePath) {
	const output = ts.transpileModule(readFileSync(filePath, "utf8"), {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			esModuleInterop: true,
		},
		fileName: filePath,
	}).outputText;
	const module = { exports: {} };
	vm.runInNewContext(
		output,
		{
			module,
			exports: module.exports,
			require: () => ({}),
		},
		{ filename: filePath },
	);
	return module.exports;
}

const { boundMountedSteps, TIMELINE_MOUNTED_STEP_LIMIT } = compile("src/renderer/src/components/session/timeline/turnMountBudget.ts");

const items = (count) => Array.from({ length: count }, (_, index) => `step-${index}`);

test("默认预算是一个有限的正数", () => {
	assert.ok(Number.isFinite(TIMELINE_MOUNTED_STEP_LIMIT));
	assert.ok(TIMELINE_MOUNTED_STEP_LIMIT > 0);
});

test("未超预算时原样返回（保留数组引用，避免无谓重渲染）", () => {
	const source = items(5);
	const windowed = boundMountedSteps(source, 120);
	assert.equal(windowed.items, source);
	assert.equal(windowed.hiddenCount, 0);
});

test("超预算时保留尾部、并报告被折叠的条目数", () => {
	const windowed = boundMountedSteps(items(500), 120);
	assert.equal(windowed.items.length, 120);
	assert.equal(windowed.hiddenCount, 380);
	// 步骤是时序的：保留的必须是最后 120 条
	assert.equal(windowed.items[0], "step-380");
	assert.equal(windowed.items[119], "step-499");
});

test("showAll=true（用户点开「显示更早步骤」）时不裁剪，内容不丢失", () => {
	const source = items(500);
	const windowed = boundMountedSteps(source, 120, true);
	assert.equal(windowed.items, source);
	assert.equal(windowed.hiddenCount, 0);
});

test("limit<=0 视为未启用预算", () => {
	const source = items(500);
	assert.equal(boundMountedSteps(source, 0).items, source);
	assert.equal(boundMountedSteps(source, -1).items, source);
});

test("边界：条目数恰好等于 limit 时不折叠", () => {
	const windowed = boundMountedSteps(items(120), 120);
	assert.equal(windowed.hiddenCount, 0);
	assert.equal(windowed.items.length, 120);
});
