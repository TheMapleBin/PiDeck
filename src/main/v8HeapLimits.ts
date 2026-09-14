/**
 * V8 老生代堆上限的分层策略（纯函数 + 常量，不含 Electron 依赖，便于单测）。
 *
 * 背景（2026-08 #213）：原先只有一个全局开关
 * `app.commandLine.appendSwitch("js-flags", "--max-old-space-size=384")`，
 * 意图是 RSS 卫生——让 V8 超过实测 JS 峰值（~185MB）后强制 GC 并把 committed
 * 空间还给 OS。但 Chromium 会把 `--js-flags` 透传到**每个**渲染进程
 * （崩溃报告里能看到渲染进程启动参数确实带上了它），于是会话窗口的 JS 堆也被
 * 钉死在 384MB：上下文超限后的极端会话一次要挂载上千条消息，V8 直接
 * `FatalProcessOutOfMemory` 终止渲染进程（`EXC_BREAKPOINT / SIGTRAP`，
 * `exitCode: 5`），用户感知为「窗口莫名自动重载」。
 *
 * 因此拆成两档职责：
 * - 主进程（Node 侧，实测 JS 峰值低）保留 384MB，RSS 卫生收益主要来自这里；
 * - 渲染进程通过 `webPreferences.additionalArguments` 显式抬到 2GB。
 *
 * 为什么渲染进程用 additionalArguments 而不是再 appendSwitch：后者只有全局档位，
 * 无法按进程类型区分，加了就会连主进程一起放开。additionalArguments 只附加到
 * 该窗口自己的渲染进程命令行，且排在 Chromium 透传参数之后——V8 的
 * `GetV8FlagsFromCommandLine` 按出现顺序拼接所有 `--js-flags`（后者覆盖前者），
 * 所以这个值一定生效。
 *
 * 2GB 是「极端内容别崩」的兜底，不是目标值：消息侧的体量控制交给
 * 轮数窗口 + 条目预算（SessionHistoryReader.boundTurnWindowStart）和
 * 渲染层单轮挂载预算（timeline/turnMountBudget）。这里刻意不做成用户设置项，
 * 避免多一个「调错就崩」的旋钮。
 *
 * 新增窗口时必须在 webPreferences 里带上 rendererHeapAdditionalArguments()，
 * 漏带 = 该窗口回落到 384MB 并重现 #213。
 */

/**
 * 渲染进程 V8 老生代堆上限（MB）。
 * 取 2GB：既远高于正常会话的 JS 峰值（~185MB），也高于 Chromium 在 8GB 机器上的
 * 默认档位量级，因此不会把「本来能跑」的负载改小；同时仍是硬上限，保留兜底语义。
 */
export const RENDERER_MAX_OLD_SPACE_MB = 2048;

/** 主进程 V8 老生代堆上限（MB），保持 #213 之前的实测口径不变。 */
export const MAIN_MAX_OLD_SPACE_MB = 384;

/** 主进程要写入 `--js-flags` 的 V8 参数（由 app.commandLine 在 ready 前安装）。 */
export function mainProcessJsFlags(): string {
	return `--max-old-space-size=${MAIN_MAX_OLD_SPACE_MB}`;
}

/**
 * 窗口 webPreferences.additionalArguments 应带上的渲染进程 V8 参数。
 * 返回数组形式，直接展开给 webPreferences 使用。
 */
export function rendererHeapAdditionalArguments(): string[] {
	return [`--js-flags=--max-old-space-size=${RENDERER_MAX_OLD_SPACE_MB}`];
}
