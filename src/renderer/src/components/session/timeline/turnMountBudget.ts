/**
 * 单轮步骤挂载预算：控制「一轮最多挂多少个步骤 DOM」。
 *
 * 为什么需要（2026-08 #213）：`turnRenderWindow` 只按轮数窗口裁剪，
 * 叠上主进程的 12 轮缓存窗口后，「12 轮 × 每轮几十条」是正常量级——
 * 但上下文超限后的极端会话里，单轮可以塞进上百个工具调用/思考段。
 * 此时轮数窗口完全不起作用：一个 `agent-run` 就能挂出上千个 ToolStep 子树
 * （每个含 Markdown/结果视图），渲染进程内存直接被打爆。
 *
 * 语义（与 turnRenderWindow 的「整轮保留」刻意不同，见下）：
 * - 默认只挂尾部 N 条步骤，顶部给「显示更早 N 条步骤」入口；
 * - 点开后本行全量挂载（内容从未丢失，只是默认不进 DOM）。
 *
 * 为什么这一层允许不整轮挂载：轮数窗口的完整性承诺是「不切开一个回答」——
 * 步骤条目本身是同一轮内的**过程**内容，且提供了显式展开入口，
 * 不存在「静默丢内容」。折叠态本就会整段卸载，挂载预算只是把
 * 「一次性全挂」换成「默认挂尾部 + 可展开」，退化路径有出口。
 */

/** 单轮默认挂载的步骤条目上限（思考/工具/中间回答统一计数）。 */
export const TIMELINE_MOUNTED_STEP_LIMIT = 120;

export interface MountedStepsWindow<T> {
	/** 实际挂载的条目（尾部窗口；未裁剪时是原数组引用，便于 memo）。 */
	items: readonly T[];
	/** 被默认折叠在窗口外的更早条目数（0 = 未裁剪）。 */
	hiddenCount: number;
}

/**
 * 按条目预算裁剪单轮步骤列表（纯函数，可单测）。
 *
 * 从尾部保留 limit 条：步骤是时序的，最新内容才是用户当下要看的；
 * 更早的步骤由调用方渲染「显示更早 N 条」入口，点击后以 showAll=true 重新调用。
 * limit <= 0 视为未启用预算（返回原列表）。
 */
export function boundMountedSteps<T>(
	items: readonly T[],
	limit: number = TIMELINE_MOUNTED_STEP_LIMIT,
	showAll = false,
): MountedStepsWindow<T> {
	if (showAll || limit <= 0 || items.length <= limit) {
		return { items, hiddenCount: 0 };
	}
	return {
		items: items.slice(items.length - limit),
		hiddenCount: items.length - limit,
	};
}
