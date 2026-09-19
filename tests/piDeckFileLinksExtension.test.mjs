import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const extensionPath = "resources/extensions/pi-deck-file-links.ts";

function loadExtension() {
	return loadTsCommonJs(extensionPath);
}

function createHarness(initialPrompt = "Base system prompt") {
	const handlers = new Map();
	let currentPrompt = initialPrompt;
	const extension = loadExtension();
	const pi = {
		on(event, handler) {
			handlers.set(event, handler);
		},
	};
	const context = {
		getSystemPrompt() {
			return currentPrompt;
		},
	};
	extension.default(pi);
	return {
		handlers,
		context,
		async emit(eventPrompt = currentPrompt) {
			return handlers.get("before_agent_start")(
				{ type: "before_agent_start", prompt: "请总结修改", systemPrompt: eventPrompt },
				context,
			);
		},
	};
}

test("file-links extension appends file reference guidance to the live system prompt", async () => {
	const harness = createHarness();
	const result = await harness.emit();
	assert.match(result.systemPrompt, /^Base system prompt\n\n/);
	assert.match(result.systemPrompt, /workspace-relative path/);
	assert.match(result.systemPrompt, /src\/main\/index\.ts:42/);
	assert.match(result.systemPrompt, /file:\/\//);
});

test("file-links extension preserves earlier sections and is idempotent", async () => {
	const { appendFileReferenceInstructions, FILE_REFERENCE_SYSTEM_PROMPT } = loadExtension();
	const first = appendFileReferenceInstructions("security rules");
	const second = appendFileReferenceInstructions(first);
	assert.equal(second, first);
	assert.match(first, /security rules/);
	assert.equal((first.match(/pideck-file-reference-rules/g) ?? []).length, 1);
	assert.match(FILE_REFERENCE_SYSTEM_PROMPT, /Do not emit `file:\/\//);
});

test("file-links extension can use the event prompt when no context getter exists", async () => {
	const { default: extension } = loadExtension();
	let handler;
	extension({
		on(_event, registered) {
			handler = registered;
		},
	});
	const result = await handler({
		type: "before_agent_start",
		prompt: "test",
		systemPrompt: "event system prompt",
	}, {});
	assert.match(result.systemPrompt, /^event system prompt\n\n/);
});

test("file-links extension is registered as a built-in extension", () => {
	const source = readFileSync("src/main/extensions/builtInExtensions.ts", "utf8");
	assert.match(source, /"pi-deck-file-links\.ts"/);
});
