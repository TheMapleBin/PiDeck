import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

// 供应商卡片自定义顺序纯函数：应用顺序 / 拖拽落点 / 上移下移 / 边界
const { buildProviderRank, applyProviderOrder, moveProviderRelative, neighborProvider, moveProviderByStep } = loadTsCommonJs("src/renderer/src/utils/providerOrder.ts");

// vm 沙箱里「数组字面量 / 展开语法」产出的数组原型属于沙箱 realm，与宿主 realm 的数组
// 原型不同，deepStrictEqual 会判不等。用宿主 realm 的 Array.from 归一化后再比较。
const list = (value) => Array.from(value);

test("applyProviderOrder 把列出的供应商按自定义名次前置，未列出的保持配置原序追加在后", () => {
	const names = ["alpha", "beta", "gamma", "delta"];
	// beta 排到最前，delta 排第二；alpha/gamma 没排过 → 保持它们在配置里的相对顺序
	assert.deepEqual(list(applyProviderOrder(names, ["beta", "delta"])), ["beta", "delta", "alpha", "gamma"]);
});

test("applyProviderOrder 未自定义排序时原样返回副本（不共享引用）", () => {
	const names = ["alpha", "beta"];
	const result = applyProviderOrder(names, undefined);
	assert.deepEqual(list(result), ["alpha", "beta"]);
	assert.notEqual(result, names);
	assert.deepEqual(list(applyProviderOrder(names, [])), ["alpha", "beta"]);
});

test("applyProviderOrder 忽略顺序数组里的未知名字与脏数据，重名只认首次位置", () => {
	const names = ["alpha", "beta"];
	assert.deepEqual(list(applyProviderOrder(names, ["beta", "ghost"])), ["beta", "alpha"]);
	// 重名取首次出现：beta 名次 0、alpha 名次 1 → 仍是 beta 在前
	assert.deepEqual(list(applyProviderOrder(names, ["beta", "alpha", "beta"])), ["beta", "alpha"]);
	// 空串/非字符串（旧 settings.json 脏数据）不产生名次
	const rank = buildProviderRank(["", null, "alpha"]);
	assert.equal(rank.size, 1);
	assert.equal(rank.get("alpha"), 0);
});

test("moveProviderRelative 按锚点前/后落位（拖拽落点语义）", () => {
	const names = ["a", "b", "c", "d"];
	assert.deepEqual(list(moveProviderRelative(names, "d", "b", "before")), ["a", "d", "b", "c"]);
	assert.deepEqual(list(moveProviderRelative(names, "a", "c", "after")), ["b", "c", "a", "d"]);
	// 拖到自己身上/未知名字：原序返回，调用方据此跳过写盘
	assert.deepEqual(list(moveProviderRelative(names, "b", "b", "before")), names);
	assert.deepEqual(list(moveProviderRelative(names, "ghost", "b", "before")), names);
});

test("neighborProvider 取可见列表的邻居，越界返回 null", () => {
	const visible = ["a", "c", "d"];
	assert.equal(neighborProvider(visible, "c", -1), "a");
	assert.equal(neighborProvider(visible, "c", 1), "d");
	assert.equal(neighborProvider(visible, "a", -1), null);
	assert.equal(neighborProvider(visible, "d", 1), null);
});

test("moveProviderByStep 在完整列表上位移，跳过隐藏项且不打乱可见相对顺序", () => {
	// b 被隐藏：完整列表里 b 夹在 a、c 之间，可见列表是 a/c/d
	const full = ["a", "b", "c", "d"];
	const visible = ["a", "c", "d"];
	// c 上移 → 落到 a 前（隐藏的 b 被挤到中间，用户看不到）
	assert.deepEqual(list(moveProviderByStep(full, visible, "c", -1)), ["c", "a", "b", "d"]);
	// a 下移 → 落到 c 后
	assert.deepEqual(list(moveProviderByStep(full, visible, "a", 1)), ["b", "c", "a", "d"]);
	// 边界：首项上移 / 末项下移都返回 null，调用方保持原序
	assert.equal(moveProviderByStep(full, visible, "a", -1), null);
	assert.equal(moveProviderByStep(full, visible, "d", 1), null);
});

test("契约完整性：供应商排序在主进程设置、配置页两处、DSH 页与选择器链路都接线到位", () => {
	const read = (path) => readFileSync(path, "utf8");
	const configModal = read("src/renderer/src/ConfigModal.tsx");
	const settingsTypes = read("src/shared/types/settings.ts");
	const settingsStore = read("src/main/settings/SettingsStore.ts");
	const modelsTab = read("src/renderer/src/config/ModelsTab.tsx");
	const authTab = read("src/renderer/src/config/AuthTab.tsx");
	const dshCards = read("src/renderer/src/config/DshProviderCards.tsx");
	const dshTab = read("src/renderer/src/config/DshConfigTab.tsx");
	const preferenceState = read("src/renderer/src/hooks/useSessionPreferenceState.ts");
	const pickerOptions = read("src/renderer/src/components/session/sessionPickerOptions.ts");
	const pickerHost = read("src/renderer/src/components/session/ComposerPickerHost.tsx");
	const zhCopy = read("src/renderer/src/i18n/rendererCopy.zh-CN.ts");
	const enCopy = read("src/renderer/src/i18n/rendererCopy.en-US.ts");

	// 持久化：两个字段都必须进 AppSettings 与 SettingsStore 的清洗名单（旧数据缺字段要有默认值）
	assert.ok(settingsTypes.includes("providerOrder"));
	assert.ok(settingsTypes.includes("dshProviderOrder"));
	assert.ok(settingsStore.includes('"providerOrder", "dshProviderOrder"'));
	// 配置页：读设置进 state，重排后落盘；顺序同时喂给模型页、认证页与 DSH 页
	assert.ok(configModal.includes("setProviderOrder(settings.providerOrder ?? [])"));
	assert.ok(configModal.includes("setDshProviderOrder(settings.dshProviderOrder ?? [])"));
	assert.ok(configModal.includes("api.settings.update({ providerOrder: next })"));
	assert.ok(configModal.includes("api.settings.update({ dshProviderOrder: next })"));
	assert.equal(configModal.includes("providerOrder={providerOrder}"), true);
	assert.ok(configModal.includes("providerOrder={dshProviderOrder}"));

	// Pi 模型页 / 认证页：同一份顺序（AuthTab 用 applyProviderOrder 排 allProviders）
	assert.ok(modelsTab.includes("applyProviderOrder(providerNames, props.providerOrder)"));
	assert.ok(modelsTab.includes("useProviderReorder("));
	assert.ok(modelsTab.includes("providerReorder.gripProps(name)"));
	assert.ok(modelsTab.includes("providerReorder.cardProps(name)"));
	assert.ok(modelsTab.includes("providerReorder.registerCard(name, element)"));
	assert.ok(modelsTab.includes('data-provider-head=""'));
	assert.ok(authTab.includes("applyProviderOrder(Object.keys(data), props.providerOrder)"));

	// DSH 模型页：卡片复用同一 hook；顺序不能写回 DSH providers（host 侧是 merge 语义 patch，表达不了键顺序）
	assert.ok(dshCards.includes("applyProviderOrder("));
	assert.ok(dshCards.includes("useProviderReorder("));
	assert.ok(dshCards.includes('data-provider-head=""'));
	assert.ok(dshTab.includes("providerOrder={props.providerOrder}"));

	// 模型选择器链路：偏好从 settings 读到 ComposerPickerHost，再传给按顺序分组的选项
	assert.ok(preferenceState.includes("setProviderOrder(settings.providerOrder ?? [])"));
	assert.ok(preferenceState.includes("dshProviderOrder"));
	assert.ok(pickerOptions.includes("orderProviderGroups("));
	// DSH 会话用 dshProviderOrder，Pi 会话用 providerOrder（同一入口三元切换，不能只传一个）
	assert.ok(pickerHost.includes("providerOrder={preference.isDshSession ? preference.dshProviderOrder : preference.providerOrder}"));

	// 拖拽手柄/上移/下移三个提示文案中英都要有（缺 key 会渲染成原始 key）
	for (const key of ["config.dragProvider", "config.moveProviderUp", "config.moveProviderDown"]) {
		assert.ok(zhCopy.includes(`"${key}"`), `zh-CN 缺少 ${key}`);
		assert.ok(enCopy.includes(`"${key}"`), `en-US 缺少 ${key}`);
	}
});
