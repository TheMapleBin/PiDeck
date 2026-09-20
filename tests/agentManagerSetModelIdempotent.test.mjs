import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { AgentManager } = loadTsCommonJs("src/main/pi/AgentManager.ts");

/**
 * set_model 幂等短路回归（用户反馈「轨迹里出现我没做过的模型切换」）。
 *
 * 根因：pi 的 setModel 无条件追加 model_change（值没变也写），而
 * SessionRuntimeCoordinator.applyPreferences 在每次激活/重启都会重放会话偏好。
 * 因此「模型没变」也必须不发 set_model，否则每重启一次就在轨迹里多一条假切换。
 *
 * 反面要求（fail-open）：判定不了当前模型时必须照旧发送——宁可多一条记录，
 * 也不能让会话保存的模型偏好静默不生效。
 */

/** 构造一个 runtime：get_state 返回 stateModel（null=无 model 字段，undefined=RPC 失败）。 */
function createManager(stateModel) {
	const calls = [];
	const manager = new AgentManager(
		() => ({ id: "project-1", name: "Project", path: "C:/project" }),
		() => null,
		{ get: () => ({}) },
		{},
	);
	const runtime = {
		tab: {
			id: "agent-1",
			projectId: "project-1",
			cwd: "C:/project",
			title: "Session",
			status: "running",
			sessionPath: undefined,
			sessionEnvironment: "native",
			sessionSource: "pi",
			createdAt: 1,
		},
		process: {
			client: {
				request: async (payload) => {
					calls.push(payload);
					if (payload.type === "get_state") {
						if (stateModel === undefined) return { success: false, error: "rpc boom" };
						if (stateModel === null) return { success: true, data: { isStreaming: false } };
						return { success: true, data: { model: stateModel } };
					}
					return { success: true, data: {} };
				},
			},
		},
	};
	manager.agents.set("agent-1", runtime);
	return { manager, calls };
}

const setModelCalls = (calls) => calls.filter((item) => item.type === "set_model");

test("模型未变：不发 set_model，但返回当前 runtime state", async () => {
	const { manager, calls } = createManager({ provider: "acme", id: "gpt-5" });

	const state = await manager.setModel("agent-1", "acme", "gpt-5");

	assert.deepEqual(setModelCalls(calls), [], "同一 provider+modelId 不应再发 set_model（pi 会因此写 model_change）");
	assert.equal(state.provider, "acme");
	assert.equal(state.modelId, "gpt-5");
});

test("模型变了：照旧发送 set_model", async () => {
	const { manager, calls } = createManager({ provider: "acme", id: "gpt-5" });

	await manager.setModel("agent-1", "acme", "gpt-6");

	const sent = setModelCalls(calls);
	assert.equal(sent.length, 1);
	// 逐字段断言：模块经 vm 加载，跨 realm 的 deepEqual 会因原型不同而误报
	assert.equal(sent[0].type, "set_model");
	assert.equal(sent[0].provider, "acme");
	assert.equal(sent[0].modelId, "gpt-6");
});

test("仅 modelId 不同也算变化（不把同 provider 任意模型当相等）", async () => {
	const { manager, calls } = createManager({ provider: "acme", id: "gpt-5" });

	await manager.setModel("agent-1", "acme", "gpt-5-mini");

	assert.equal(setModelCalls(calls).length, 1);
});

test("判定不了当前模型（RPC 失败 / 无 model 字段）：回退为发送，保证偏好不静默失效", async () => {
	for (const stateModel of [undefined, null]) {
		const { manager, calls } = createManager(stateModel);
		await manager.setModel("agent-1", "acme", "gpt-5");
		assert.equal(setModelCalls(calls).length, 1, `stateModel=${String(stateModel)} 时应照旧发送`);
	}
});
