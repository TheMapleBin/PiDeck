import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const quickMessages = loadTsCommonJs("src/shared/quickMessages.ts");
const { DEFAULT_QUICK_MESSAGES, MAX_QUICK_MESSAGES, MAX_QUICK_MESSAGE_LENGTH, normalizeQuickMessages } = quickMessages;

const i18n = loadTsCommonJs("src/renderer/src/i18n.ts");

/**
 * 跨 realm 比较：经 vm 加载的模块创建的数组原型与宿主不同，`deepStrictEqual` 会因
 * 原型不同直接报「same structure but are not reference-equal」，这里统一转成宿主普通数组。
 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * 快捷消息（输入框底栏「快捷消息」弹框 + 设置页维护）。
 * 分三层守卫：出厂清单/清洗规则（纯函数）、SettingsStore 落盘边界、UI 接线契约。
 */

// ── 出厂清单 ──────────────────────────────────────────────────────────

test("出厂清单包含用户点名的四条高频指令，且无重复、不超长", () => {
	// 用户明确要求内置「继续 / 推送 / 提交 / 提交推送」：删掉任何一条都算回归。
	for (const item of ["继续", "提交", "推送", "提交推送"]) {
		assert.ok(DEFAULT_QUICK_MESSAGES.includes(item), `出厂清单缺少「${item}」`);
	}
	assert.equal(new Set(DEFAULT_QUICK_MESSAGES).size, DEFAULT_QUICK_MESSAGES.length, "出厂清单出现重复条目");
	for (const item of DEFAULT_QUICK_MESSAGES) {
		assert.ok(item.trim() === item && item.length > 0, `出厂条目不应有首尾空白或为空: ${JSON.stringify(item)}`);
		assert.ok(item.length <= MAX_QUICK_MESSAGE_LENGTH, `出厂条目超长: ${item}`);
	}
	assert.ok(DEFAULT_QUICK_MESSAGES.length <= MAX_QUICK_MESSAGES, "出厂条数不该超过上限");
});

test("清单导出为只读常量：调用方拿到的是副本，不会污染全局默认值", () => {
	const copy = normalizeQuickMessages(undefined);
	copy.push("被污染");
	assert.ok(!DEFAULT_QUICK_MESSAGES.includes("被污染"), "normalize 返回的必须是新数组，不能直接返回 DEFAULT_QUICK_MESSAGES");
});

// ── 清洗规则（主进程加载/保存、渲染层兜底共用） ─────────────────────────

test("字段缺失回退出厂清单：旧 settings.json 没这个字段 ≠ 用户清空", () => {
	assert.deepEqual(plain(normalizeQuickMessages(undefined)), [...DEFAULT_QUICK_MESSAGES]);
	assert.deepEqual(plain(normalizeQuickMessages(null)), [...DEFAULT_QUICK_MESSAGES]);
	assert.deepEqual(plain(normalizeQuickMessages({ 0: "继续" })), [...DEFAULT_QUICK_MESSAGES], "非数组一律回退默认");
});

test("显式空数组保持为空：用户就是想清干净，不能被默认值回填", () => {
	assert.deepEqual(plain(normalizeQuickMessages([])), []);
});

test("丢弃空白条目与非字符串项，其余 trim 后保留顺序", () => {
	assert.deepEqual(plain(normalizeQuickMessages(["  继续  ", "", "   ", 42, null, "提交推送"])), ["继续", "提交推送"]);
});

test("去重按不区分大小写的 trim 后文本：弹框里两条一样的条目只会让人点错", () => {
	assert.deepEqual(plain(normalizeQuickMessages(["继续", " 继续 ", "Review", "review", "REVIEW"])), ["继续", "Review"]);
});

test("超长按上限截断（而非丢弃），超过条数上限的部分丢弃", () => {
	const long = "字".repeat(MAX_QUICK_MESSAGE_LENGTH + 50);
	const [clipped] = normalizeQuickMessages([long]);
	assert.equal(clipped.length, MAX_QUICK_MESSAGE_LENGTH);

	const many = Array.from({ length: MAX_QUICK_MESSAGES + 5 }, (_, index) => `条目 ${index}`);
	const result = normalizeQuickMessages(many);
	assert.equal(result.length, MAX_QUICK_MESSAGES);
	assert.equal(result[MAX_QUICK_MESSAGES - 1], `条目 ${MAX_QUICK_MESSAGES - 1}`, "超限应丢弃尾部而不是打乱顺序");
});

// ── SettingsStore 边界（落盘数据不可信） ───────────────────────────────

/** SettingsStore 依赖 electron / 日志 / git 解析器，按 tests/settingsStoreAtomicSave.test.mjs 同款方式打桩。 */
function makeStore(initialSettings) {
	const userData = mkdtempSync(join(tmpdir(), "pideck-quickmsg-user-"));
	const home = mkdtempSync(join(tmpdir(), "pideck-quickmsg-home-"));
	if (initialSettings) writeFileSync(join(userData, "settings.json"), JSON.stringify(initialSettings));
	const { SettingsStore } = loadTsCommonJs("src/main/settings/SettingsStore.ts", {
		stubs: {
			electron: {
				app: { getPath: (key) => (key === "userData" ? userData : key === "home" ? home : tmpdir()) },
				BrowserWindow: class {},
				Menu: { setApplicationMenu: () => undefined },
			},
			"../logging/sharedLogger": { getAppLogger: () => undefined },
			"../git/gitExecutable": { setConfiguredGitPath: () => undefined },
		},
	});
	return { SettingsStore, userData };
}

test("load：旧 settings.json 没有 quickMessages 时用出厂清单（升级不空列表）", async () => {
	const { SettingsStore } = makeStore({ closeToTray: false, installationType: "installed" });
	const store = new SettingsStore();
	await store.load();
	assert.deepEqual(plain(store.get().quickMessages), [...DEFAULT_QUICK_MESSAGES]);
});

test("load：settings.json 里的脏数据被清洗（手工改文件不会让弹框出现空条目）", async () => {
	const { SettingsStore } = makeStore({ installationType: "installed", quickMessages: ["  继续 ", "继续", "", 7, "推送"] });
	const store = new SettingsStore();
	await store.load();
	assert.deepEqual(plain(store.get().quickMessages), ["继续", "推送"]);
});

test("update：写入前清洗，且落盘内容与内存一致", async () => {
	const { SettingsStore, userData } = makeStore({ installationType: "installed" });
	const store = new SettingsStore();
	await store.load();
	await store.update({ quickMessages: [" 提交推送 ", "提交推送", "   "] });
	assert.deepEqual(plain(store.get().quickMessages), ["提交推送"]);
	assert.deepEqual(JSON.parse(readFileSync(join(userData, "settings.json"), "utf8")).quickMessages, ["提交推送"]);
});

test("update：空数组是合法值（用户清空），不因「空=假值」被默认值覆盖", async () => {
	const { SettingsStore } = makeStore({ installationType: "installed" });
	const store = new SettingsStore();
	await store.load();
	await store.update({ quickMessages: [] });
	assert.deepEqual(plain(store.get().quickMessages), []);
});

// ── UI 接线契约（防漂移：改一处漏一处会静默失效） ───────────────────────

const readSource = (file) => readFileSync(file, "utf8");

test("底栏接线：安全控制位右侧渲染 props.quickMessagesControl，且生图模式一并屏蔽", () => {
	const source = readSource("src/renderer/src/components/session/ComposerComponents.tsx");
	assert.match(source, /quickMessagesControl\?: ReactNode/);
	// 生图模式没有对话 runtime，两个控制位都不该出现；分开判断是为了防止将来只屏蔽一个。
	assert.match(source, /isImageGenMode \? null : \(\s*<>\s*\{props\.securityControl\}\s*\{props\.quickMessagesControl\}/);
});

test("ComposerArea：把 controller 的 pickers/delivery 接进快捷消息入口", () => {
	const source = readSource("src/renderer/src/components/session/ComposerArea.tsx");
	assert.match(source, /quickMessagesControl=\{[\s\S]{0,400}?<QuickMessageMenu/);
	assert.match(source, /onInsert=\{composer\.pickers\.insertQuickMessage\}/);
	assert.match(source, /onSend=\{composer\.delivery\.sendQuickMessage\}/);
	assert.match(source, /sendDisabled=\{!composer\.delivery\.canSendQuickMessage\}/);
});

test("直发契约：overrideText 不消费草稿/附件，也不清空或回填草稿", () => {
	const source = readSource("src/renderer/src/hooks/useSessionSend.ts");
	assert.match(source, /sendSessionPrompt\(streamingBehavior\?: "steer" \| "followUp", overrideText\?: string\)/);
	assert.match(source, /const keepDraft = overrideText !== undefined;/);
	// 草稿快照与附件快照都必须走 keepDraft 分支
	assert.match(source, /const rawDraft = overrideText \?\?/);
	assert.match(source, /keepDraft \? \[\] :/);
	// 清空/回填都要被 keepDraft 挡住
	assert.match(source, /function clearComposerSnapshot\(targetSessionId: string, keepDraft: boolean\) \{\s*if \(keepDraft\) return;/);
	assert.match(source, /function restoreRejectedPrompt\([\s\S]{0,120}?keepDraft: boolean[\s\S]{0,120}?\) \{\s*if \(keepDraft\) return;/);
});

test("弹框条目：直发按钮必须 stopPropagation（Radix 菜单项在 click 阶段选中=插入）", () => {
	const source = readSource("src/renderer/src/components/session/QuickMessageMenu.tsx");
	const sendButton = source.slice(source.indexOf('title={t("app.quickMessagesSend")}'));
	assert.match(sendButton, /event\.stopPropagation\(\);/);
	assert.match(sendButton, /setOpen\(false\);/);
	assert.match(source, /onSelect=\{\(\) => props\.onInsert\(text\)\}/);
	assert.match(source, /openSettings\(\{ tab: "common", section: "common-quick-messages" \}\)/);
});

test("设置页：条目落到 common-quick-messages 锚点，且标题 key 中英都有文案", () => {
	const source = readSource("src/renderer/src/components/app/settings/QuickMessagesSetting.tsx");
	assert.match(source, /anchor="common-quick-messages"/);
	for (const locale of ["zh-CN", "en-US"]) {
		i18n.setI18nLocale(locale);
		for (const key of ["settings.quickMessages", "settings.quickMessagesSection", "settings.quickMessagesDesc", "settings.quickMessagesAdd", "settings.quickMessagesReset", "app.quickMessagesTitle", "app.quickMessagesSend", "app.quickMessagesManage"]) {
			const text = i18n.t(key);
			assert.ok(text && text !== key, `${locale} 缺文案: ${key}`);
		}
	}
});
