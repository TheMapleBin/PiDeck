import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/renderer/src/components/app/RichInput.tsx", "utf8");
const controllerSource = readFileSync("src/renderer/src/hooks/useSessionComposerController.ts", "utf8");

test("RichInput keeps native Enter handling without execCommand normalization", () => {
	assert.match(source, /function insertPlainTextAtSelection\(root: HTMLElement, text: string\): void/);
	assert.doesNotMatch(source, /execCommand\("insertText"/);
	assert.match(source, /insertPlainTextAtSelection\(root, event\.clipboardData\.getData\("text\/plain"\)\);\s*handleInput\(\);/s);
	assert.match(source, /不 preventDefault，让浏览器原生的 contentEditable Enter 行为/);
	assert.doesNotMatch(source, /insertPlainTextAtSelection\(root, "\\n"\)/);
});

test("the Session composer delegates newline and IME intent to the shared behavior helper", () => {
	assert.match(controllerSource, /getComposerEnterIntent\(event, sendShortcut\)/);
	// 建议列表的回车分支也必须走共享 IME 判定：TipTap 桥接的原生事件没有
	// nativeEvent，手写 `event.nativeEvent?.isComposing` 会漏判合成态。
	assert.match(controllerSource, /isComposingKeyboardEvent\(event\)/);
	assert.doesNotMatch(controllerSource, /keyCode === 229/);
	assert.doesNotMatch(controllerSource, /insertPlainTextAtSelection/);
});

test("RichInput preserves the browser DOM while native input awaits controlled confirmation", () => {
	assert.match(source, /const nativeInputValueRef = useRef<string \| null>\(null\)/);
	// 输入快照必须在 onChange 前同步记录，Path 2 才能区分「自己输入的回显」与「外部变更」。
	// 变量名容许 main 的 effectiveValue 归一化版本（空 <br> 清理），不断言具体变量名。
	assert.match(source, /nativeInputValueRef\.current = (?:nextValue|effectiveValue);\s*nativeInputCaretRef\.current = [^;]+;\s*onChange\(/s);
	// 新架构：value !== domText 时，先检查是否为 React 正在确认用户输入，
	// 若是则跳过 DOM 操作；否则执行外部变更重建。
	assert.match(source, /if \(value !== domText\) \{[\s\S]*?if \(nativeInputValue !== null && value === nativeInputValue\)/);
	assert.match(source, /if \(nativeInputValue === value\) \{\s*nativeInputValueRef\.current = null;\s*nativeInputCaretRef\.current = null;/s);
});
