/**
 * 快捷消息（composer 底栏「快捷消息」弹框里一键插入 / 直发的一句话指令）。
 *
 * 为什么放在 shared：主进程 SettingsStore 用它「兜底默认 + 保存时清洗」（用户可能手工改坏
 * settings.json），渲染层用同一份清单做首屏兜底与「恢复默认」——两处各写一份必然会漂移成
 * 「恢复默认恢复不出出厂那几条」。
 *
 * 清单按「高频在前」排序：弹框不分组、不做搜索，前几条就是每天最常点的。
 * 内容取舍（见下方注释）：只收工作指令，不收闲聊/自测用词（hello、test、你是什么模型…），
 * 那些放进去只会把真正常用的项挤到下面。
 */

/** 上界：弹框一屏放得下十几条，再多就该用提示词模板；同时挡住 settings.json 被塞爆。 */
export const MAX_QUICK_MESSAGES = 30;

/**
 * 单条长度上限：快捷消息是「一句话」。
 * 超长内容（整段任务描述）应写成提示词模板，否则弹框里每条都要折行、点击区域也失去辨识度。
 */
export const MAX_QUICK_MESSAGE_LENGTH = 200;

/**
 * 出厂清单（16 条）。顺序即弹框展示顺序，改动等于改用户的第一屏，需谨慎。
 *
 * 前 4 条是最高频的「推进指令」（继续 / 提交 / 推送 / 提交推送），
 * 之后依次是「约束语气」（中文回答 / 完整文件 / 只改该改的）、「排查口令」与「流程口令」。
 */
export const DEFAULT_QUICK_MESSAGES: readonly string[] = [
	"继续",
	"提交",
	"推送",
	"提交推送",
	"用中文回答我",
	"给出完整可运行的文件",
	"只改我提到的部分，不要顺手改其它代码",
	"参考项目里已有的实现和代码风格",
	"不要添加不必要的注释",
	"请仔细思考，确保正确且完整实现",
	"再确认一下",
	"还是不对，请重新排查",
	"还是无法运行，先看报错再修",
	"先检索查证再回答，不要凭猜测下结论",
	"先别写代码，先梳理方案",
	"review 一下这个 commit",
];

/**
 * 清洗快捷消息清单：主进程加载 / 保存、渲染层兜底都走这里，保证各入口结果一致。
 *
 * 规则与理由：
 * - 非数组（含 undefined）→ 回退出厂清单：字段缺失代表「旧 settings.json 还没这个字段」，
 *   而不是「用户清空了」；真正的清空是一个显式空数组；
 * - 空白条目直接丢弃（误触回车留下的空行，留着重启后就是一个点不出效果的按钮）；
 * - 超长按上限截断而非丢弃（用户写了长句说明他确实想用，只是超了界面能接受的量级）；
 * - 去重（大小写无关）：弹框里两条一模一样的条目只会让人点错；
 * - 超出上限的部分丢弃：上限是防御性的，正常维护到不了。
 */
export function normalizeQuickMessages(value: unknown): string[] {
	if (!Array.isArray(value)) return [...DEFAULT_QUICK_MESSAGES];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") continue;
		const text = item.trim();
		if (!text) continue;
		const clipped = text.slice(0, MAX_QUICK_MESSAGE_LENGTH);
		const dedupeKey = clipped.toLowerCase();
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		result.push(clipped);
		if (result.length >= MAX_QUICK_MESSAGES) break;
	}
	return result;
}
