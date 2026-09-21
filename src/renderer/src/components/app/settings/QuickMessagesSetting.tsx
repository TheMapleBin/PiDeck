import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import { DEFAULT_QUICK_MESSAGES, MAX_QUICK_MESSAGES, MAX_QUICK_MESSAGE_LENGTH } from "../../../../../shared/quickMessages";
import { t } from "../../../i18n";
import { Button } from "../../ui-shadcn/button";
import { Input } from "../../ui-shadcn/input";
import { DirtyMarker, SettingRow } from "./SettingRows";

/**
 * 常用设置 →「快捷消息」维护区：逐行编辑输入框底栏弹框里的条目。
 *
 * 为什么是「列表 + 上移/下移」而不是拖拽排序：条目通常不到 20 条、且顺序只在弹框里
 * 体现一次，做成拖拽既需要引入新的交互栈，也让键盘用户没法排序；上下移按钮对两种
 * 操作方式都成立。
 *
 * 空行是允许的编辑中间态（新增后还没填）：保存时由主进程 normalizeQuickMessages
 * 统一丢弃，界面不为此弹错。
 */
export function QuickMessagesSetting(props: {
	value: string[];
	onChange: (next: string[]) => void;
	/** 未保存标记：与其它设置行一致，改动后标题旁显示黄点。 */
	dirty: boolean;
}) {
	const rows = props.value;
	const atLimit = rows.length >= MAX_QUICK_MESSAGES;

	const replaceAt = (index: number, text: string) => {
		props.onChange(rows.map((item, current) => (current === index ? text : item)));
	};
	const removeAt = (index: number) => {
		props.onChange(rows.filter((_, current) => current !== index));
	};
	/** 与相邻条目交换位置：越界直接忽略（首行上移 / 末行下移）。 */
	const move = (index: number, delta: -1 | 1) => {
		const target = index + delta;
		if (target < 0 || target >= rows.length) return;
		const next = [...rows];
		const [item] = next.splice(index, 1);
		next.splice(target, 0, item);
		props.onChange(next);
	};

	return (
		<SettingRow
			anchor="common-quick-messages"
			stacked
			title={
				<>
					<span>{t("settings.quickMessages")}</span>
					<DirtyMarker dirty={props.dirty} label={t("settings.quickMessages")} />
				</>
			}
			description={t("settings.quickMessagesDesc", { max: MAX_QUICK_MESSAGES })}
		>
			<div className="flex w-full min-w-0 flex-col gap-1.5 pt-1">
				{rows.length === 0 ? <p className="px-1 py-1.5 text-caption text-muted-foreground">{t("settings.quickMessagesEmpty")}</p> : null}
				{rows.map((text, index) => (
					// key 用下标：条目文本随输入实时变化，且允许存在重复/空行——用文本或 id 都会
					// 在编辑过程中重建节点、丢掉输入焦点。顺序调整本身就是重排，无状态可丢。
					<div key={index} className="flex min-w-0 items-center gap-1">
						<Input value={text} maxLength={MAX_QUICK_MESSAGE_LENGTH} placeholder={t("settings.quickMessagesPlaceholder")} onChange={(event) => replaceAt(index, event.target.value)} className="min-w-0 flex-1" />
						<Button type="button" variant="ghost" size="icon-sm" title={t("settings.quickMessagesMoveUp")} aria-label={t("settings.quickMessagesMoveUp")} disabled={index === 0} onClick={() => move(index, -1)}>
							<ArrowUp size={14} strokeWidth={1.8} aria-hidden="true" />
						</Button>
						<Button type="button" variant="ghost" size="icon-sm" title={t("settings.quickMessagesMoveDown")} aria-label={t("settings.quickMessagesMoveDown")} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
							<ArrowDown size={14} strokeWidth={1.8} aria-hidden="true" />
						</Button>
						<Button type="button" variant="ghost" size="icon-sm" title={t("settings.quickMessagesRemove")} aria-label={t("settings.quickMessagesRemove")} onClick={() => removeAt(index)}>
							<Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
						</Button>
					</div>
				))}
				<div className="flex flex-wrap items-center gap-2 pt-1">
					<Button type="button" variant="outline" size="sm" disabled={atLimit} onClick={() => props.onChange([...rows, ""])}>
						<Plus size={14} strokeWidth={2} aria-hidden="true" />
						{t("settings.quickMessagesAdd")}
					</Button>
					<Button type="button" variant="ghost" size="sm" onClick={() => props.onChange([...DEFAULT_QUICK_MESSAGES])}>
						<RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
						{t("settings.quickMessagesReset")}
					</Button>
					{atLimit ? <span className="text-caption text-muted-foreground">{t("settings.quickMessagesLimit", { max: MAX_QUICK_MESSAGES })}</span> : null}
				</div>
			</div>
		</SettingRow>
	);
}
