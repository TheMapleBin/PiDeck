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
 *
 * ── 2026-09 补记：大会话闪退事件与「别用加内存解决问题」─────────────
 *
 * 现场：打开 424MiB / 994MiB 的会话历史时应用闪退，日志里**没有任何堆栈**。
 * 根因不是档位设小了，而是主进程把整份会话 JSONL `readFile(utf8)`：
 * - 994MiB 样本（10.34 亿字符）超过 V8 单字符串上限（2^29-24 ≈ **5.37 亿字符**），
 *   连字符串都建不出来（`ERR_STRING_TOO_LONG`）；
 * - 424MiB 样本能建出字符串，但主进程 384MB 老生代堆装不下 → V8
 *   `FatalProcessOutOfMemory` **abort 进程**。abort 不是可捕获异常，AppLogger 拿不到
 *   堆栈；主进程即应用本体，所以表现为「闪退」。
 *
 * 结论（改档位前请先读）：
 * - **先问「这个文件/数组有没有字节上界」**。正确的修复是有界 IO（流式扫描 +
 *   按 offset 定向读 + 字节预算，见 src/main/sessions/jsonlLineStream.ts），
 *   抬档位只是把崩溃阈值往后推一点，还会顺带抬高常驻 RSS。
 * - 抬主进程档位不会让渲染进程跟着变小：渲染进程的 additionalArguments 排在
 *   透传的 `--js-flags` 之后，永远以 renderer 档位为准。
 * - 真的需要抬档时（有 `reason:"oom"` / `FatalProcessOutOfMemory` 证据），
 *   用下面的诊断环境变量临时验证，再决定是否改常量发版。
 *
 * ── 什么时候改、改了什么时候生效 ────────────────────────────────
 *
 * - 主进程：`app.commandLine.appendSwitch("js-flags", mainProcessJsFlags())` 必须在
 *   **app ready 之前**执行（见 src/main/index.ts）；V8 在堆创建时读取该参数。
 * - 渲染进程：窗口 **创建时** 的 webPreferences.additionalArguments 生效；
 *   已有窗口不受影响（新开窗口 / 重启应用才换档）。
 * - **运行期无法调整**：`--max-old-space-size` 在进程启动时确定，
 *   `v8.setFlagsFromString` 改不了已建堆的上限。要换档只能重启进程
 *   （应用侧可用 app.relaunch() 自重启）。
 * - DSH host 跑在 Electron utilityProcess 里（src/main/dsh/DshHostProcess.ts），
 *   那份 V8 堆不跟随上面两档；若将来出现 host 侧 OOM，应在 forkEnv 里显式给
 *   `NODE_OPTIONS=--max-old-space-size=...`，而不是抬主进程档位。
 */

/**
 * 渲染进程 V8 老生代堆上限（MB）。
 * 取 2GB：既远高于正常会话的 JS 峰值（~185MB），也高于 Chromium 在 8GB 机器上的
 * 默认档位量级，因此不会把「本来能跑」的负载改小；同时仍是硬上限，保留兜底语义。
 */
export const RENDERER_MAX_OLD_SPACE_MB = 2048;

/** 主进程 V8 老生代堆上限（MB），保持 #213 之前的实测口径不变。 */
export const MAIN_MAX_OLD_SPACE_MB = 384;

/**
 * 诊断用环境变量（不是产品设置项）：现场遇到 OOM 时临时抬档复现/验证，
 * 不必重新打包；值非法则回落默认，越界则夹到边界。
 * 例如 `PIDECK_MAIN_HEAP_MB=768 npm run dev`。
 */
const MAIN_HEAP_ENV = "PIDECK_MAIN_HEAP_MB";
const RENDERER_HEAP_ENV = "PIDECK_RENDERER_HEAP_MB";
/** 主进程档位下限高于实测峰值（~185MB），上限防手滑把 RSS 卫生彻底放开。 */
const MAIN_HEAP_BOUNDS = { min: 256, max: 4096 } as const;
/** 渲染进程档位下限 1GB（低于它等于退回 #213 的危险区），上限防手滑。 */
const RENDERER_HEAP_BOUNDS = { min: 1024, max: 8192 } as const;

export type HeapEnv = Record<string, string | undefined>;

/** 读取并校验环境变量覆盖值：非法回落默认，越界夹到边界。 */
export function resolveHeapOverrideMb(
	env: HeapEnv,
	name: string,
	fallbackMb: number,
	bounds: { min: number; max: number },
): number {
	const raw = env?.[name];
	if (typeof raw !== "string" || !raw.trim()) return fallbackMb;
	const parsed = Number(raw.trim());
	if (!Number.isFinite(parsed)) return fallbackMb;
	return Math.min(bounds.max, Math.max(bounds.min, Math.round(parsed)));
}

/** 主进程实际生效的档位（默认 384MB，可被 PIDECK_MAIN_HEAP_MB 覆盖）。 */
export function mainProcessHeapMb(env: HeapEnv = process.env): number {
	return resolveHeapOverrideMb(env, MAIN_HEAP_ENV, MAIN_MAX_OLD_SPACE_MB, MAIN_HEAP_BOUNDS);
}

/** 渲染进程实际生效的档位（默认 2GB，可被 PIDECK_RENDERER_HEAP_MB 覆盖）。 */
export function rendererProcessHeapMb(env: HeapEnv = process.env): number {
	return resolveHeapOverrideMb(env, RENDERER_HEAP_ENV, RENDERER_MAX_OLD_SPACE_MB, RENDERER_HEAP_BOUNDS);
}

/** 主进程要写入 `--js-flags` 的 V8 参数（由 app.commandLine 在 ready 前安装）。 */
export function mainProcessJsFlags(env: HeapEnv = process.env): string {
	return `--max-old-space-size=${mainProcessHeapMb(env)}`;
}

/**
 * 窗口 webPreferences.additionalArguments 应带上的渲染进程 V8 参数。
 * 返回数组形式，直接展开给 webPreferences 使用。
 */
export function rendererHeapAdditionalArguments(env: HeapEnv = process.env): string[] {
	return [`--js-flags=--max-old-space-size=${rendererProcessHeapMb(env)}`];
}
