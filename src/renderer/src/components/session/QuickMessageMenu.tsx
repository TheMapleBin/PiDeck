import { useState } from "react";
import { useSetAtom } from "jotai";
import { FileJson, MessageSquareText, SendHorizontal, Settings2 } from "lucide-react";
import { t } from "../../i18n";
import { openSettingsAtom } from "../../atoms";
import { useQuickMessages } from "../../hooks/useQuickMessages";
import { Button } from "../ui-shadcn/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui-shadcn/dropdown-menu";

/**
 * 输入框底栏「快捷消息」入口（在安全等级/权限控制位的右侧）。
 *
 * 两个动作刻意并存在同一行里：
 * - 点条目 = 把这句话插进草稿（可继续补参数、拼上下文，再按回车发送）；
 * - 点条目右侧的直发按钮 = 跳过草稿直接发出去（「继续」「提交推送」这类不需要改写的口令）。
 *
 * 清单来源是配置文件 userData/quick-messages.json（useQuickMessages 负责读文件、
 * 并在设置页改完后回写快照），不是硬编码常量：用户手工编辑该文件同样立刻生效。
 * 直发走 controller 的 sendQuickMessage，正文不经过草稿，也不会动用户写了一半的输入
 * （契约见 useSessionSend 的 overrideText）。
 */
export function QuickMessageMenu(props: {
	/** Agent 启动中：整个入口禁用（与底栏其它按钮一致）。 */
	disabled?: boolean;
	/** 直发不可用（DSH 模型不可路由 / 生图进行中）：仍可插入草稿，只是不给直发。 */
	sendDisabled?: boolean;
	onInsert: (text: string) => void;
	onSend: (text: string) => void;
}) {
	const { items, loading, error, openFile, refresh } = useQuickMessages();
	const openSettings = useSetAtom(openSettingsAtom);
	// 直发按钮要显式关菜单（它停掉了事件冒泡，Radix 的「选中即关闭」不会触发）。
	const [open, setOpen] = useState(false);

	return (
		<DropdownMenu
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				// 打开时重读文件：用户可以手工编辑 quick-messages.json，弹框必须显示磁盘上的最新清单，
				// 而不是上次挂载时的快照（主进程侧本来就不缓存，重读成本只是一次小文件读）。
				if (next) void refresh();
			}}
		>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" className="composer-bar-btn icon size-7 rounded-md text-foreground hover:bg-muted/60" aria-label={t("app.quickMessagesTitle")} title={t("app.quickMessagesTitle")} disabled={props.disabled}>
					<MessageSquareText size={15} strokeWidth={2} aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			{/* 宽度按内容自适应但设上限：条目里有中英混排的长句，太窄会截到看不清。 */}
			<DropdownMenuContent align="start" sideOffset={4} className="min-w-56 max-w-80">
				{loading ? (
					// 读文件很快但要区分「还没读完」与「真的没有」：否则每次打开弹框都会闪一下空态。
					<p className="px-2 py-3 text-caption leading-relaxed text-muted-foreground">{t("app.quickMessagesLoading")}</p>
				) : error ? (
					<p className="px-2 py-3 text-caption leading-relaxed text-destructive">{error}</p>
				) : items.length === 0 ? (
					<p className="px-2 py-3 text-caption leading-relaxed text-muted-foreground">{t("app.quickMessagesEmpty")}</p>
				) : (
					<>
						{/* 菜单不分组不搜索，靠这一行说明两个动作的分工，避免用户以为只能插入。 */}
						<DropdownMenuLabel className="text-micro font-normal text-muted-foreground">{t("app.quickMessagesHint")}</DropdownMenuLabel>
						{items.map((text, index) => (
							<DropdownMenuItem key={`${index}:${text}`} className="gap-1 pr-1" onSelect={() => props.onInsert(text)}>
								<span className="min-w-0 flex-1 truncate">{text}</span>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									className="shrink-0 text-muted-foreground"
									title={t("app.quickMessagesSend")}
									aria-label={t("app.quickMessagesSend")}
									disabled={props.sendDisabled}
									onClick={(event) => {
										// 与 ComposerSkillPicker 的条目内按钮同构：停掉冒泡避免菜单项的
										// 「选中=插入」再跑一遍，然后自己把菜单收起来。
										event.stopPropagation();
										setOpen(false);
										props.onSend(text);
									}}
								>
									<SendHorizontal size={14} strokeWidth={1.8} aria-hidden="true" />
								</Button>
							</DropdownMenuItem>
						))}
					</>
				)}
				<DropdownMenuSeparator />
				{/* 配置文件就是数据本身：既给了「手工编辑」的出口，也解释了清单从哪来。 */}
				<DropdownMenuItem onSelect={() => void openFile()}>
					<FileJson size={14} strokeWidth={2} aria-hidden="true" />
					{t("settings.quickMessagesOpenFile")}
				</DropdownMenuItem>
				{/* 维护入口直达设置页那一行（锚点由 settingsFieldAnchors 索引 + SettingRow.anchor 提供）。 */}
				<DropdownMenuItem onSelect={() => openSettings({ tab: "common", section: "common-quick-messages" })}>
					<Settings2 size={14} strokeWidth={2} aria-hidden="true" />
					{t("app.quickMessagesManage")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
