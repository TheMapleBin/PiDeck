import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/** 用最小 hook 宿主执行真实编辑命令；保存替身模拟主进程丢弃空行及延迟回包。 */
function editorHarness(initial = ["继续"]) {
	const slots = [];
	let cursor = 0;
	let items = initial;
	const requests = [];
	const timers = new Map();
	let timerId = 0;
	const { useQuickMessageEditor } = loadTsCommonJs("src/renderer/src/hooks/useQuickMessageEditor.ts", {
		stubs: {
			react: {
				useState(initialValue) {
					const index = cursor++;
					if (!(index in slots)) slots[index] = initialValue;
					return [
						slots[index],
						(next) => {
							slots[index] = typeof next === "function" ? next(slots[index]) : next;
						},
					];
				},
				useRef(value) {
					const index = cursor++;
					return (slots[index] ??= { current: value });
				},
				useCallback: (callback) => callback,
				useEffect: () => {},
			},
			"./useQuickMessages": {
				useQuickMessages: () => ({
					items,
					defaults: ["默认"],
					defaultsAvailable: true,
					loading: false,
					save: (next) =>
						new Promise((resolve) =>
							requests.push(() => {
								items = next.filter((item) => item.trim());
								resolve(true);
							}),
						),
					refresh: async () => {},
					openFile: async () => {},
				}),
			},
			"../i18n": { t: (key) => key },
			"../utils/notice": { showNotice: () => {} },
		},
		globals: {
			window: {
				setTimeout: (callback) => {
					timers.set(++timerId, callback);
					return timerId;
				},
				clearTimeout: (id) => timers.delete(id),
			},
		},
	});
	return {
		render() {
			cursor = 0;
			return useQuickMessageEditor();
		},
		async settle() {
			while (requests.length) requests.shift()();
			await new Promise((resolve) => setImmediate(resolve));
		},
		get items() {
			return items;
		},
	};
}

test("添加空行在保存回包后仍可编辑，填写后失焦落盘", async () => {
	const h = editorHarness();
	h.render().addItem();
	await h.settle();
	assert.deepEqual(Array.from(h.render().rows), ["继续", ""]);
	h.render().setItem(1, "新消息");
	h.render().flushPending();
	await h.settle();
	assert.deepEqual(Array.from(h.items), ["继续", "新消息"]);
});

test("旧结构保存回包不能抹掉随后添加的空行", async () => {
	const h = editorHarness(["继续", "提交"]);
	h.render().removeItem(0);
	h.render().addItem();
	await h.settle();
	assert.deepEqual(Array.from(h.render().rows), ["提交", ""]);
});

test("连续添加受条数上限约束", async () => {
	const h = editorHarness(Array.from({ length: 29 }, (_, i) => String(i)));
	h.render().addItem();
	h.render().addItem();
	await h.settle();
	assert.equal(h.render().rows.length, 30);
	assert.equal(h.render().atLimit, true);
});
