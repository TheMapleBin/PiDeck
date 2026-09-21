import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileJson, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { MAX_QUICK_MESSAGES, MAX_QUICK_MESSAGE_LENGTH } from "../../../../../shared/quickMessages";
import { useQuickMessages } from "../../../hooks/useQuickMessages";
import { t } from "../../../i18n";
import { showNotice } from "../../../utils/notice";
import { Button } from "../../ui-shadcn/button";
import { Input } from "../../ui-shadcn/input";
import { SettingRow } from "./SettingRows";

/** 打字合并成一次写盘的等待时间：太短会按字符写文件，太长会让「敲完就关设置」的落盘变迟。 */
const COMMIT_DEBOUNCE_MS = 400;

/**
 * 常用设置 →「快捷消息」维护区：编辑输入框底栏弹框里的条目。
 *
 * 与其它设置项不同，这里**不参与设置弹框的草案/保存/取消**：条目存在独立配置文件
 * userData/quick-messages.json（主进程 QuickMessageStore），读写都操作该文件，
 * 因此本区自己持有「编辑中的原始文本」并在改动后即时落盘（与语音转写、生图设置同一模式）。
 * 这样做的收益：用户手工编辑配置文件也生效，且不必为了调一条快捷消息走一遍全局保存。
 *
 * 为什么要有本地 draft：主进程保存时会 normalize（去首尾空白/去重/截断），
 * 若每次按键都把清洗结果写回输入框，用户打的空格会被当场吃掉、光标乱跳。
 * 所以打字先进 draft（400ms 合并写盘），结构性操作（增删/排序/恢复默认）立即写盘，
 * 并在没有未落盘编辑时把界面交还给文件内容（显示清洗后的真实结果）。
 *
 * 空行是允许的编辑中间态（新增后还没填）：主进程 normalize 会丢弃，界面不为此报错。
 * 列表用「上移/下移」而不是拖拽排序：条目通常不到 20 条，顺序只在弹框里体现一次，
 * 拖拽需要引入新的交互栈且键盘不可用，上下移按钮对两种操作方式都成立。
 */
export function QuickMessagesSetting() {
	const { items, defaults, defaultsAvailable, filePath, loading, error, save, refresh, openFile } = useQuickMessages();
	// draft = 编辑中的原始文本；null = 未在编辑，界面直接跟随文件内容。
	const [draft, setDraft] = useState<string[] | null>(null);
	const pendingRef = useRef<string[] | null>(null);
	const timerRef = useRef<number | null>(null);

	const clearPending = useCallback(() => {
		if (timerRef.current !== null) {
			window.clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		pendingRef.current = null;
	}, []);

	// 组件卸载（关设置弹框、切 tab）或输入框失焦时，把还没落盘的打字补写一次，避免「敲完直接关」丢改动。
	const flushPending = useCallback(() => {
		if (timerRef.current !== null) {
			window.clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		const pending = pendingRef.current;
		pendingRef.current = null;
		if (pending) void save(pending);
	}, [save]);

	useEffect(() => () => flushPending(), [flushPending]);

	/** 结构性操作（增删/排序/恢复默认）：立刻写文件，并回读主进程清洗后的结果。 */
	const commitNow = useCallback(
		async (next: string[]) => {
			clearPending();
			setDraft(next);
			const ok = await save(next);
			if (!ok) return;
			// 期间用户又打字了就别抢回界面，继续用他的 draft。
			if (pendingRef.current === null) setDraft(null);
			showNotice(t("settings.quickMessagesSaved"), 2000);
		},
		[clearPending, save],
	);

	/** 打字：合并成一次写盘（成功不弹提示，避免逐字刷屏）。 */
	const commitSoon = useCallback(
		(next: string[]) => {
			setDraft(next);
			pendingRef.current = next;
			if (timerRef.current !== null) window.clearTimeout(timerRef.current);
			timerRef.current = window.setTimeout(() => {
				timerRef.current = null;
				pendingRef.current = null;
				void save(next);
			}, COMMIT_DEBOUNCE_MS);
		},
		[save],
	);

	const rows = draft ?? items;

	/** 从配置文件重新读取（用户在外面用编辑器改完文件后点）：先把没落盘的打字写回去，再丢掉 draft 显示磁盘真实内容。 */
	const reload = async () => {
		const pending = pendingRef.current;
		if (pending) {
			pendingRef.current = null;
			if (timerRef.current !== null) {
				window.clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			await save(pending);
		}
		setDraft(null);
		await refresh();
	};

	const atLimit = rows.length >= MAX_QUICK_MESSAGES;
	const replaceAt = (index: number, text: string) => commitSoon(rows.map((item, current) => (current === index ? text : item)));
	const removeAt = (index: number) => void commitNow(rows.filter((_, current) => current !== index));
	/** 与相邻条目交换位置：越界直接忽略（首行上移 / 末行下移）。 */
	const move = (index: number, delta: -1 | 1) => {
		const target = index + delta;
		if (target < 0 || target >= rows.length) return;
		const next = [...rows];
		const [item] = next.splice(index, 1);
		next.splice(target, 0, item);
		void commitNow(next);
	};

	return (
		<SettingRow anchor="common-quick-messages" stacked title={t("settings.quickMessages")} description={t("settings.quickMessagesDesc", { max: MAX_QUICK_MESSAGES })}>
			<div className="flex w-full min-w-0 flex-col gap-1.5 pt-1">
				{loading ? (
					<p className="px-1 py-1.5 text-caption text-muted-foreground">{t("settings.quickMessagesLoading")}</p>
				) : (
					<>
						{rows.length === 0 ? <p className="px-1 py-1.5 text-caption text-muted-foreground">{t("settings.quickMessagesEmpty")}</p> : null}
						{rows.map((text, index) => (
							// key 用下标：条目文本随输入实时变化，且允许存在重复/空行——用文本或 id 都会
							// 在编辑过程中重建节点、丢掉输入焦点。顺序调整本身就是重排，无状态可丢。
							<div key={index} className="flex min-w-0 items-center gap-1">
								<Input value={text} maxLength={MAX_QUICK_MESSAGE_LENGTH} placeholder={t("settings.quickMessagesPlaceholder")} onChange={(event) => replaceAt(index, event.target.value)} onBlur={flushPending} className="min-w-0 flex-1" />
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
							<Button type="button" variant="outline" size="sm" disabled={atLimit} onClick={() => void commitNow([...rows, ""])}>
								<Plus size={14} strokeWidth={2} aria-hidden="true" />
								{t("settings.quickMessagesAdd")}
							</Button>
							<Button type="button" variant="ghost" size="sm" disabled={!defaultsAvailable} title={defaultsAvailable ? undefined : t("settings.quickMessagesDefaultsUnavailable")} onClick={() => void commitNow([...defaults])}>
								<RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
								{t("settings.quickMessagesReset")}
							</Button>
							<Button type="button" variant="ghost" size="sm" title={t("settings.quickMessagesReloadHint")} onClick={() => void reload()}>
								<RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
								{t("settings.quickMessagesReload")}
							</Button>
							<Button type="button" variant="ghost" size="sm" onClick={() => void openFile()}>
								<FileJson size={14} strokeWidth={2} aria-hidden="true" />
								{t("settings.quickMessagesOpenFile")}
							</Button>
							{atLimit ? <span className="text-caption text-muted-foreground">{t("settings.quickMessagesLimit", { max: MAX_QUICK_MESSAGES })}</span> : null}
						</div>
					</>
				)}
				{/* 让用户知道数据在哪：改配置文件同样生效，这是「配置化」的可见出口。 */}
				{filePath ? <p className="px-1 break-all text-caption text-muted-foreground">{t("settings.quickMessagesFileHint", { path: filePath })}</p> : null}
				{error ? <p className="px-1 text-caption text-destructive">{error}</p> : null}
			</div>
		</SettingRow>
	);
}
