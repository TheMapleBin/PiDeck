import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("docs/pi-prompt-templates/pi-system.md", "utf8");
const bundled = readFileSync("resources/prompts/pi-system.md", "utf8");

const requiredRules = [
	/workspace-relative path/,
	/`src\/main\/index\.ts:42`/,
	/\[open src\/main\/index\.ts\]\(src\/main\/index\.ts:42\)/,
	/Do not generate `file:\/\/`, `vscode:\/\//,
];

test("pi-system reference template teaches clickable-safe file references", () => {
	for (const rule of requiredRules) assert.match(source, rule);
});

test("bundled pi-system prompt is regenerated from the source template", () => {
	assert.equal(bundled, source);
});
