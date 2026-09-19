import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { DshHost } = loadTsCommonJs("src/main/dsh/DshHost.ts");

function hostWithForkProbe() {
	const host = new DshHost(
		() => "C:\\pideck-dsh-user-stop-test",
		() => "C:\\pideck-dsh-user-stop-test",
	);
	let forks = 0;
	host.start = async function startStub() {
		forks += 1;
		this.client = { sentinel: true };
	};
	return {
		host,
		forks: () => forks,
	};
}

test("describeSettings / listModels / listProviders do not fork a stopped host", async () => {
	const { host, forks } = hostWithForkProbe();
	const described = await host.describeSettings();
	// DshHost 在 VM 沙箱里跑，返回的数组与测试文件不共享 Array 原型，不能 deepEqual([], [])。
	assert.equal(described.writable, false);
	assert.equal(described.namespaces.length, 0);
	assert.equal((await host.listModels()).length, 0);
	assert.equal((await host.listProviders()).length, 0);
	assert.equal((await host.listAgentPresets()).length, 0);
	assert.equal((await host.listDynamicPlugins()).length, 0);
	assert.equal(forks(), 0, "settings reopen / config reads must not fork after stop");
});

test("ensureStarted respects markUserStopped unless session or explicit", async () => {
	const { host, forks } = hostWithForkProbe();
	host.markUserStopped();
	await host.ensureStarted();
	await host.ensureStarted({ reason: "warmup" });
	await host.ensureStarted({ reason: "implicit" });
	assert.equal(forks(), 0, "implicit/warmup must not revive a user-stopped host");

	await host.ensureStarted({ reason: "explicit" });
	assert.equal(forks(), 1);
	assert.equal(host.isStarted(), true);
});

test("opening a DSH session (reason=session) clears the stop flag and starts", async () => {
	const { host, forks } = hostWithForkProbe();
	host.markUserStopped();
	await host.ensureStarted({ reason: "session" });
	assert.equal(forks(), 1);
	assert.equal(host.isStarted(), true);
});

test("DshAgentManager session paths start host with reason=session", () => {
	const source = readFileSync("src/main/dsh/DshAgentManager.ts", "utf8");
	assert.match(source, /ensureStarted\(\{\s*reason:\s*"session"\s*\}\)/);
});

test("stopDshHostFromMonitor records user-stopped before dispose", () => {
	const index = readFileSync("src/main/index.ts", "utf8");
	const stopFn = index.match(/async function stopDshHostFromMonitor\([\s\S]*?^}/m)?.[0] ?? "";
	assert.match(stopFn, /dshHost\.markUserStopped\(\)/);
	assert.match(stopFn, /await dshHost\.dispose\(\)/);
	assert.ok(
		stopFn.indexOf("markUserStopped()") < stopFn.indexOf("await dshHost.dispose()"),
		"must mark stopped before dispose so in-flight reads cannot fork",
	);
});

test("read methods in DshHost no longer call ensureStarted", () => {
	const source = readFileSync("src/main/dsh/DshHost.ts", "utf8");
	for (const method of [
		"describeSettings",
		"describeCredentials",
		"listModels",
		"listProviders",
		"listAgentPresets",
		"searchSessions",
		"listDynamicPlugins",
		"listStaticPlugins",
	]) {
		const start = source.indexOf(`async ${method}(`);
		assert.ok(start >= 0, `missing ${method}`);
		const next = source.indexOf("\n\tasync ", start + 1);
		const body = source.slice(start, next === -1 ? undefined : next);
		assert.doesNotMatch(
			body,
			/await this\.ensureStarted\(/,
			`${method} must not auto-start the host`,
		);
	}
});
