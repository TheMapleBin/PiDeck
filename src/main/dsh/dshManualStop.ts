/**
 * DSH host「用户手动停止」契约（单一数据源）。
 *
 * 场景：部分用户完全不用 DSH，但 host 是共享 utilityProcess（约 200MB 常驻），
 * 会被后台预热 / 按需兜底 / 崩溃自动重启 / runtime 安装后恢复等路径悄悄拉起。
 * 用户手动停止后必须 **只有用户显式启动** 才能再运行，因此：
 * - 所有自动拉起路径都要拒绝，且拒绝原因必须可辨识（不能混同于 boot 失败报红）；
 * - 判定与文案收敛在本模块：DshHost（策略层）与 DshHostProcess（进程层）
 *   都要用，放在任一侧都会形成循环 import。
 */

/** 「DSH host 已被用户手动停止」的错误文案（单一数据源）。 */
export const DSH_MANUALLY_STOPPED_ERROR = "DSH host is manually stopped";

/** 构造手动停止拒绝错误（进程层 fork 被门控时用）。 */
export function dshManuallyStoppedError(): Error {
	return new Error(DSH_MANUALLY_STOPPED_ERROR);
}

/** 判定错误是否为「手动停止」拒绝（非 boot 失败；调用方据此不报红、不重试）。 */
export function isDshManuallyStoppedError(error: unknown): boolean {
	return error instanceof Error && error.message === DSH_MANUALLY_STOPPED_ERROR;
}
