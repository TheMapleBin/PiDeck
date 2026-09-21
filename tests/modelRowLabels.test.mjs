import assert from "node:assert/strict";
import test from "node:test";

import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { modelRowLabels } = loadTsCommonJs("src/renderer/src/components/session/sessionPickerOptions.ts");

/**
 * 模型选择器行文案的回归测试。
 *
 * 背景：选择器原先主行只渲染 `provider/id`，用户在「模型」页配置的 name（渠道别名、
 * 中文名）只在 tooltip 里可见，同名不同渠道的模型难以分辨。改为「主行 name / 副行
 * provider/id」后，两个字段的取值与回落规则必须稳定：primary 缺失时回退 id，
 * secondary 永远是 `provider/id`（跨供应商的收藏栏/已隐藏栏没有分组标题提供上下文）。
 *
 * 注：loadTsCommonJs 在 vm 沙箱里求值，返回对象与测试进程不同 realm，
 * 因此逐字段断言，不用 deepStrictEqual（会因原型不同判不等）。
 */
function labelsOf(model) {
	const labels = modelRowLabels(model);
	return { primary: labels.primary, secondary: labels.secondary };
}

test("name 存在：主行 name，副行 provider/id", () => {
	assert.deepEqual(labelsOf({ provider: "tokendance", id: "gpt-4o", name: "通义千问 Max" }), {
		primary: "通义千问 Max",
		secondary: "tokendance/gpt-4o",
	});
});

test("name 缺失：主行回退 id，副行仍带 provider 前缀", () => {
	assert.deepEqual(labelsOf({ provider: "openai", id: "gpt-4o" }), {
		primary: "gpt-4o",
		secondary: "openai/gpt-4o",
	});
});

test("name 为空白：视为缺失回退 id（避免渲染空主行）", () => {
	assert.deepEqual(labelsOf({ provider: "openai", id: "gpt-4o", name: "   " }), {
		primary: "gpt-4o",
		secondary: "openai/gpt-4o",
	});
});

test("name 带首尾空白：trim 后作为主行", () => {
	assert.deepEqual(labelsOf({ provider: "openai", id: "gpt-4o", name: " GPT-4o " }), {
		primary: "GPT-4o",
		secondary: "openai/gpt-4o",
	});
});

test("name 与 id 相同：主行仍是 name（调用方据此省略 tooltip 前缀）", () => {
	const labels = labelsOf({ provider: "openai", id: "gpt-4o", name: "gpt-4o" });
	assert.equal(labels.primary, "gpt-4o");
	assert.equal(labels.primary, "gpt-4o");
	assert.equal(labels.secondary, "openai/gpt-4o");
});
