import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

/**
 * 白名单跳过文案映射表（纯模块，只 import type）。
 * transpile 后 import type 被擦除，沙箱里不放 require：一旦它变成运行时依赖，测试立刻炸。
 */
function loadNoticeModule() {
	const sandbox = { exports: {} };
	vm.runInNewContext(
		ts.transpileModule(readFileSync("src/main/pi/whitelistSkipNotice.ts", "utf8"), {
			compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
		}).outputText,
		sandbox,
		{ filename: "whitelistSkipNotice.ts" },
	);
	return sandbox.exports;
}

test("三类白名单跳过各自映射到独立 i18n key，兜底文案带条数与预算", () => {
	const { resolveWhitelistSkipCopy, WHITELIST_SKIP_KIND_COPY } = loadNoticeModule();
	const keys = new Set();
	for (const kind of ["extensions", "skills", "prompts"]) {
		const copy = resolveWhitelistSkipCopy({
			kind,
			count: 12,
			chars: 30000,
			injected: 28000,
			budget: 26000,
		});
		assert.match(copy.i18nKey, /^diagnostic\./, `${kind} 应映射到 diagnostic.* 文案 key`);
		assert.ok(copy.fallbackText.includes("12"), `${kind} 兜底文案应带条数`);
		assert.ok(copy.fallbackText.includes("26000"), `${kind} 兜底文案应带预算`);
		keys.add(copy.i18nKey);
	}
	// 用户需要知道「是哪类资源被跳过」：三类共用一句话会把扩展/技能/提示词混为一谈。
	assert.equal(keys.size, 3, "三类 skipped 文案 key 不得复用");
	// 技能是首个接入预算守卫的类型，历史上已落到用户时间线，key 必须保持稳定。
	assert.equal(WHITELIST_SKIP_KIND_COPY.skills.i18nKey, "diagnostic.skillWhitelistSkipped");
});

test("新增的白名单跳过文案在中英文两侧都已定义", () => {
	const source = readFileSync("src/shared/i18n/mainProcessCopy.ts", "utf8");
	for (const key of [
		"diagnostic.extensionWhitelistSkipped",
		"diagnostic.promptWhitelistSkipped",
		"diagnostic.skillWhitelistSkipped",
	]) {
		const occurrences = source.split(`"${key}"`).length - 1;
		assert.equal(occurrences, 2, `${key} 应在 zh-CN 与 en-US 各定义一次`);
	}
});
