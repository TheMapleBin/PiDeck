import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const {
	DSH_RUNNER_NODE_MAJOR,
	isDshRunnerNodeCompatible,
	nodePathCandidates,
	parseNodeVersion,
	resolveConfiguredNodePath,
	detectDshRunnerNode,
} = loadTsCommonJs("src/main/dsh/dshRunnerNode.ts");

test("Windows 候选路径含官方安装目录", () => {
	const candidates = nodePathCandidates("win32", { ProgramFiles: "C:\\Program Files" });
	assert.equal(candidates[0], "C:\\Program Files\\nodejs\\node.exe");
});

test("Windows 用户级安装位置随 LOCALAPPDATA 拼出", () => {
	const candidates = nodePathCandidates("win32", {
		ProgramFiles: "C:\\Program Files",
		LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
	});
	assert.ok(candidates.includes("C:\\Users\\tester\\AppData\\Local\\Programs\\nodejs\\node.exe"));
});

test("无 LOCALAPPDATA 时不产生 undefined 路径", () => {
	const candidates = nodePathCandidates("win32", { ProgramFiles: "C:\\Program Files" });
	assert.ok(!candidates.some((p) => p.includes("undefined")));
});

test("macOS / Linux 候选覆盖 Homebrew 与系统路径", () => {
	assert.ok(nodePathCandidates("darwin").includes("/opt/homebrew/bin/node"));
	assert.equal(nodePathCandidates("linux")[0], "/usr/bin/node");
});

test("parseNodeVersion 剥 v 前缀", () => {
	assert.equal(parseNodeVersion("v24.13.0\n"), "24.13.0");
	assert.equal(parseNodeVersion("24.13.0"), "24.13.0");
});

test("两段版本号补齐为三段", () => {
	assert.equal(parseNodeVersion("v24.13"), "24.13.0");
});

test("ABI 兼容只认 Node 24", () => {
	assert.equal(DSH_RUNNER_NODE_MAJOR, 24);
	assert.equal(isDshRunnerNodeCompatible("24.13.0"), true);
	assert.equal(isDshRunnerNodeCompatible("22.12.0"), false);
	assert.equal(isDshRunnerNodeCompatible(""), false);
});

test("配置路径去空白；空串视为未配置", () => {
	assert.equal(resolveConfiguredNodePath("  C:\\nodejs\\node.exe  "), "C:\\nodejs\\node.exe");
	assert.equal(resolveConfiguredNodePath(""), "");
	assert.equal(resolveConfiguredNodePath(undefined), "");
	assert.equal(resolveConfiguredNodePath(null), "");
});

test("配置了不存在的路径时 source=not-found，不把脏路径当可执行文件", async () => {
	const info = await detectDshRunnerNode({
		configuredPath: "C:\\definitely-missing-pideck-node.exe",
		platform: "win32",
		env: {},
	});
	assert.equal(info.source, "not-found");
	assert.equal(info.compatible, false);
	assert.match(info.error ?? "", /无法执行配置的 Node 路径/);
});

test("配置了存在但不是 node 的文件时探测失败", async () => {
	const root = await mkdtemp(join(tmpdir(), "pideck-node-"));
	try {
		const fake = join(root, "not-node.exe");
		await writeFile(fake, "nope");
		const info = await detectDshRunnerNode({
			configuredPath: fake,
			platform: "win32",
			env: {},
		});
		assert.equal(info.source, "not-found");
		assert.equal(info.compatible, false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
