/**
 * DSH host 手动停止（dshManualStopped）接线测试。
 *
 * 背景：部分用户不想让 DSH host（共享 utilityProcess，~200MB）运行。手动停止后
 * 必须 **只有用户显式启动** 才能再运行——所有自动拉起路径都要被门控。
 * 本测试验证各层接线齐全（单层行为已由 dshManualStop.test.mjs 覆盖）：
 * - 设置类型 + 持久化默认值（false = 保持按需自动启动的历史语义）；
 * - 主进程所有自动路径（预热 / 按需兜底 / IPC 门控）都读取标记；
 * - IPC 三处同步（通道常量 / sessionIpc handler / preload 暴露）；
 * - i18n 中英文案齐全。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settingsType = readFileSync("src/shared/types/settings.ts", "utf8");
const store = readFileSync("src/main/settings/SettingsStore.ts", "utf8");
const mainIndex = readFileSync("src/main/index.ts", "utf8");
const dshHost = readFileSync("src/main/dsh/DshHost.ts", "utf8");
const dshHostProcess = readFileSync("src/main/dsh/DshHostProcess.ts", "utf8");
const ipcChannels = readFileSync("src/shared/ipc.ts", "utf8");
const sessionIpc = readFileSync("src/main/ipc/sessionIpc.ts", "utf8");
const preload = readFileSync("src/preload/index.ts", "utf8");
const zh = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
const en = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");

test("dshManualStopped: 类型定义存在且默认 false（保持自动启动语义）", () => {
	assert.match(settingsType, /dshManualStopped\?: boolean/);
	assert.match(store, /dshManualStopped: false/);
});

test("dshManualStopped: 旧 JSON 脏值回落 false（字符串/数字不能把 host 永久锁死）", () => {
	// 加载清洗 + 更新入口双向校验：读路径回落 + 写路径拒绝非布尔
	assert.match(store, /typeof this\.settings\.dshManualStopped !== "boolean"[\s\S]{0,120}dshManualStopped = false/);
	assert.match(store, /"dshManualStopped" in safePatch && typeof safePatch\.dshManualStopped !== "boolean"[\s\S]{0,80}delete safePatch\.dshManualStopped/);
});

test("dshManualStopped: 主进程自动拉起路径全部读标记", () => {
	// 后台预热（含自动更新完成后补预热）统一走 dshWarmupEnabled 门控
	assert.match(mainIndex, /dshWarmupEnabled\(\): boolean/);
	assert.match(mainIndex, /dshManualStopped !== true/);
	// runtime 磁盘操作后的 host 恢复也必须跳过手动停止态
	assert.match(mainIndex, /startDshHostAfterRuntimeDiskOperation/);
	// DshHost / DshHostProcess 构造注入标记 getter
	assert.match(mainIndex, /settingsStore\.get\(\)\.dshManualStopped === true/);
	// 策略层：ensureStarted 门控 + 显式启动入口
	assert.match(dshHost, /isManualStopped\(\)[\s\S]{0,200}dshManuallyStoppedError/);
	assert.match(dshHost, /async startManually\(\): Promise<boolean>/);
	// 进程层：fork 前门控（崩溃自动重启路径不经 DshHost.start）
	assert.match(dshHostProcess, /if \(this\.isManualStopped\(\)\) throw dshManuallyStoppedError\(\)/);
	assert.match(dshHostProcess, /isDshManuallyStoppedError/);
});

test("dshManualStopped: IPC 三处同步（通道 / handler / preload）", () => {
	assert.match(ipcChannels, /dshStopHost: "dsh:stop-host"/);
	assert.match(ipcChannels, /dshStartHost: "dsh:start-host"/);
	assert.match(sessionIpc, /ipcChannels\.dshStopHost/);
	assert.match(sessionIpc, /ipcChannels\.dshStartHost/);
	assert.match(preload, /stopDshHost: \(\) =>[\s\S]{0,80}ipcChannels\.dshStopHost/);
	assert.match(preload, /startDshHost: \(\) =>[\s\S]{0,80}ipcChannels\.dshStartHost/);
});

test("dshManualStopped: 状态回传 manuallyStopped（渲染层显示中性徽标而非错误态）", () => {
	// getStatus 必须透出手动停止态，配置页据此区分「未启动」与「已手动停止」
	assert.match(dshHost, /manuallyStopped: this\.isManualStopped\(\)/);
	assert.match(preload, /manuallyStopped\?: boolean/);
});

test("dshManualStopped: i18n 中英文案齐全", () => {
	for (const key of [
		"config.dsh.stopHost",
		"config.dsh.startHost",
		"config.dsh.manuallyStopped",
		"config.dsh.manuallyStoppedDesc",
		"config.dsh.hostStopped",
		"config.dsh.hostStopFailed",
		"config.dsh.hostStarted",
		"config.dsh.hostStartFailed",
	]) {
		assert.match(zh, new RegExp(`"${key.replace(/\./g, "\\.")}"`));
		assert.match(en, new RegExp(`"${key.replace(/\./g, "\\.")}"`));
	}
});
