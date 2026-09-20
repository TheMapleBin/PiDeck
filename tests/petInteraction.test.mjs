import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadDragDirection() {
	const source = readFileSync("src/renderer/src/pet/PetDragDirection.ts", "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	});
	const module = { exports: {} };
	vm.runInNewContext(
		outputText,
		{ module, exports: module.exports },
		{
			filename: "PetDragDirection.ts",
		},
	);
	return module.exports;
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test("drag direction ignores horizontal pointer noise", () => {
	const { updatePetDragDirection } = loadDragDirection();
	const initial = { anchorX: 100, mode: "idle" };

	assert.deepEqual(plain(updatePetDragDirection(initial, 105)), initial);
});

test("drag direction follows left and right movement with hysteresis", () => {
	const { updatePetDragDirection } = loadDragDirection();
	const right = updatePetDragDirection({ anchorX: 100, mode: "idle" }, 106);
	const noise = updatePetDragDirection(right, 102);
	const left = updatePetDragDirection(noise, 100);

	assert.deepEqual(plain(right), { anchorX: 106, mode: "running-right" });
	assert.deepEqual(plain(noise), { anchorX: 106, mode: "running-right" });
	assert.deepEqual(plain(left), { anchorX: 100, mode: "running-left" });
});

test("settings preview is cleared when the pet settings tab unmounts", () => {
	// 设置页拆分后宠物预览清理随 PetTab 走：tab 卸载时真实 Agent 状态重新接管宠物
	const source = readFileSync("src/renderer/src/components/app/settings/PetTab.tsx", "utf8");
	assert.match(source, /useEffect\(\s*\(\) => \(\) => \{\s*void window\.piDesktop\.pet\.setPreviewMode\(""\);\s*\},\s*\[\],?\s*\);/);
});
