import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { PiAuthFlowEvent } from "../../../../shared/types/piAuth";
import { closeProviderLoginAtom, providerLoginRequestAtom } from "../../atoms/providerLoginAtoms";
import { useProviderLoginFlow, type ProviderLoginPhase } from "../../hooks/useProviderLoginFlow";
import { t } from "../../i18n";
import { openInSystemBrowser } from "../../utils/openExternal";
import { classifyAuthFailure } from "../../utils/providerLoginList";
import { Alert, AlertDescription, AlertTitle } from "../ui-shadcn/alert";
import { Button } from "../ui-shadcn/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui-shadcn/dialog";
import { Input } from "../ui-shadcn/input";
import { ProviderAuthTable } from "./ProviderAuthTable";

/**
 * 「登录供应商」弹框。
 *
 * 入口是输入框里的 `/login`（pi 的命令表里也有这条，所以 `/` 菜单会列出来），
 * 但 pi 的登录实现只在它的 CLI 交互层，桌面端通过认证例外通道复用 pi 官方
 * `ModelRuntime` 的认证 API 完成登录：见 `shared/types/piAuth.ts` 与 AGENTS.md。
 *
 * 两层组件：外壳只订阅「是否打开」的 atom；body 在打开时才挂载，于是每次打开都是
 * 全新流程状态（上一次的提问/事件不会残留）。真正的流程状态机在 `useProviderLoginFlow`，
 * 列表呈现（搜索 + 表格）在 `ProviderAuthTable`。
 *
 * 尺寸约定：五个阶段共用同一个外层宽度与内容区高度，切换阶段时弹框不会忽大忽小。
 */
export function ProviderLoginModal() {
	const request = useAtomValue(providerLoginRequestAtom);
	if (!request.open) return null;
	return <ProviderLoginBody preselectedProviderId={request.providerId} />;
}

/** 阶段内容区：固定最小高度避免弹框抖动，超高走内部滚动（不放宽弹框本身）。 */
const PHASE_BODY_CLASS = "min-h-56 max-h-[60vh] overflow-y-auto pr-1";

function ProviderLoginBody({ preselectedProviderId }: { preselectedProviderId?: string }) {
	const close = useSetAtom(closeProviderLoginAtom);
	// 关弹框时 hook 会顺手取消进行中的登录（否则助手进程要等到超时）。
	const flow = useProviderLoginFlow({ open: true, preselectedProviderId, onClose: () => close() });
	const { state } = flow;

	return (
		<Dialog open onOpenChange={(next) => (next ? undefined : flow.close())}>
			<DialogContent
				className="sm:max-w-3xl"
				onEscapeKeyDown={(event) => {
					event.preventDefault();
					flow.close();
				}}
			>
				<DialogHeader>
					<DialogTitle>{t("providerLogin.title")}</DialogTitle>
					<DialogDescription>{state.phase === "running" ? t("providerLogin.running.title", { provider: state.providerId }) : t("providerLogin.subtitle")}</DialogDescription>
				</DialogHeader>
				<div className={PHASE_BODY_CLASS}>
					{state.phase === "loading" && (
						<div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							{t("providerLogin.loading")}
						</div>
					)}
					{state.phase === "list-error" && (
						<Alert variant="destructive">
							<AlertTriangle />
							<AlertTitle>{t("providerLogin.listFailed")}</AlertTitle>
							<AlertDescription>
								<RawDetail text={state.message} />
							</AlertDescription>
						</Alert>
					)}
					{state.phase === "picking" && (
						<ProviderAuthTable providers={state.providers} piVersion={state.piVersion} busyProviderId={flow.busyProviderId} onStartLogin={(providerId, method) => void flow.startLogin(providerId, method)} onLogout={(providerId) => void flow.logout(providerId)} onRefresh={() => void flow.loadProviders()} />
					)}
					{state.phase === "running" && <RunningBody flow={flow} state={state} />}
					{state.phase === "succeeded" && (
						<Alert>
							<CheckCircle2 className="text-emerald-500" />
							<AlertTitle>{t("providerLogin.success.title")}</AlertTitle>
							<AlertDescription>{t("providerLogin.success.hint")}</AlertDescription>
						</Alert>
					)}
					{state.phase === "failed" && <FailedBody state={state} />}
				</div>
				<div className="flex justify-end gap-2">
					{state.phase === "list-error" && (
						<Button variant="secondary" onClick={() => void flow.loadProviders()}>
							{t("providerLogin.retry")}
						</Button>
					)}
					{state.phase === "succeeded" && (
						<Button variant="default" onClick={() => flow.close()}>
							{t("providerLogin.success.done")}
						</Button>
					)}
					{state.phase === "failed" && (
						<Button variant="secondary" onClick={() => void flow.loadProviders()}>
							{t("providerLogin.retry")}
						</Button>
					)}
					{state.phase === "succeeded" && (
						<Button variant="ghost" onClick={() => void flow.loadProviders()}>
							{t("providerLogin.backToList")}
						</Button>
					)}
					{state.phase !== "running" && state.phase !== "succeeded" && (
						<Button variant="ghost" onClick={() => flow.close()}>
							{t("providerLogin.close")}
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

/** 登录失败：可操作的归类提示 + pi 的原始报错（原文是排障唯一线索，不折叠）。 */
function FailedBody({ state }: { state: Extract<ProviderLoginPhase, { phase: "failed" }> }) {
	const kind = classifyAuthFailure(state.detail);
	return (
		<div className="space-y-3">
			<Alert variant="destructive">
				<AlertTriangle />
				<AlertTitle>{state.message}</AlertTitle>
				<AlertDescription>
					{kind === "region" && <p>{t("providerLogin.errorHint.region")}</p>}
					{kind === "network" && <p>{t("providerLogin.errorHint.network")}</p>}
					{kind === "code-expired" && <p>{t("providerLogin.errorHint.codeExpired")}</p>}
					{state.detail && <RawDetail text={state.detail} />}
				</AlertDescription>
			</Alert>
		</div>
	);
}

/** 原始报错文本块：等宽、可选中、长行换行，避免撑破弹框。 */
function RawDetail({ text }: { text: string }) {
	return <p className="max-h-32 overflow-y-auto break-all font-mono text-xs text-muted-foreground select-text">{text}</p>;
}

/** 登录进行中：pi 推来的事件流 + 需要用户回答的提问 + 取消。 */
function RunningBody({ flow, state }: { flow: ReturnType<typeof useProviderLoginFlow>; state: Extract<ProviderLoginPhase, { phase: "running" }> }) {
	const seconds = useElapsedSeconds();
	const openedBrowser = state.events.some((event) => event.type === "auth_url" || event.type === "device_code");
	return (
		<div className="space-y-3">
			<div className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-muted/40 p-3">
				{state.events.length === 0 && (
					<p className="flex items-center gap-2 text-xs text-muted-foreground">
						<Loader2 className="size-3.5 animate-spin" />
						{t("providerLogin.method.oauthHint")}
					</p>
				)}
				{state.events.map((event, index) => (
					<FlowEventRow key={index} event={event} />
				))}
			</div>
			{openedBrowser && <p className="text-xs text-muted-foreground">{t("providerLogin.running.browserHint")}</p>}
			{state.prompt && <PromptRow prompt={state.prompt} onSubmit={(value) => void flow.answerPrompt(value)} />}
			{/*
				授权在浏览器完成后，pi 会去供应商换 token；若本机连不上（地区限制/需要代理），
				这一步会长时间无反馈。只靠转圈用户无法判断「是在等还是已经卡死」，
				所以超过阈值给一条可操作提示 + 计时，让用户知道该取消/换网络。
			*/}
			{seconds >= SLOW_HINT_SECONDS && (
				<Alert>
					<AlertTriangle />
					<AlertTitle>{t("providerLogin.running.slowTitle", { seconds })}</AlertTitle>
					<AlertDescription>{t("providerLogin.running.slowHint")}</AlertDescription>
				</Alert>
			)}
			<div className="flex justify-end">
				<Button variant="ghost" onClick={() => void flow.cancelLogin()}>
					{t("providerLogin.running.cancel")}
				</Button>
			</div>
		</div>
	);
}

/** 超过这个秒数仍无结果就提示用户「多半是网络到不了供应商」；codex 在国内必然走到这里。 */
const SLOW_HINT_SECONDS = 15;

/** 秒表：只在运行时挂载，卸载即清理 interval。 */
function useElapsedSeconds(): number {
	const [seconds, setSeconds] = useState(0);
	useEffect(() => {
		const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
		return () => window.clearInterval(timer);
	}, []);
	return seconds;
}

/** 单条 pi 事件；链接走系统浏览器（与应用内浏览器面板的设置无关）。 */
function FlowEventRow({ event }: { event: PiAuthFlowEvent }) {
	switch (event.type) {
		case "auth_url":
			return (
				<div className="space-y-1 text-xs">
					<button type="button" className="break-all text-left text-primary underline" onClick={() => openInSystemBrowser(event.url)}>
						{event.url}
					</button>
					{event.instructions && <p className="text-muted-foreground">{event.instructions}</p>}
				</div>
			);
		case "device_code":
			return (
				<div className="space-y-1 text-xs">
					<p className="font-mono text-base tracking-widest">{event.userCode}</p>
					<button type="button" className="break-all text-left text-primary underline" onClick={() => openInSystemBrowser(event.verificationUri)}>
						{event.verificationUri}
					</button>
				</div>
			);
		case "info":
			return (
				<div className="space-y-1 text-xs">
					<p className="whitespace-pre-wrap break-words">{event.message}</p>
					{event.links?.map((link) => (
						<button key={link.url} type="button" className="block break-all text-left text-primary underline" onClick={() => openInSystemBrowser(link.url)}>
							{link.label || link.url}
						</button>
					))}
				</div>
			);
		default:
			return <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{event.message}</p>;
	}
}

/** pi 的提问：select 用按钮组，其余用输入框（secret 走密码框）。 */
function PromptRow({ prompt, onSubmit }: { prompt: Extract<ProviderLoginPhase, { phase: "running" }>["prompt"]; onSubmit: (value: string) => void }) {
	const [value, setValue] = useState("");
	if (!prompt) return null;
	return (
		<div className="space-y-2 rounded-lg border border-border p-3">
			<p className="text-sm">{prompt.message || t("providerLogin.prompt.hint")}</p>
			{/* manual_code 是「浏览器里显示的一次性代码」：不提示来源，用户常把整段回调地址粘进来。 */}
			{prompt.kind === "manual_code" && <p className="text-xs text-muted-foreground">{t("providerLogin.prompt.manualCodeHint")}</p>}
			{prompt.kind === "select" ? (
				<div className="flex flex-wrap gap-2">
					{prompt.options?.map((option) => (
						<Button key={option.id} size="sm" variant="secondary" title={option.description} onClick={() => onSubmit(option.id)}>
							{option.label}
						</Button>
					))}
				</div>
			) : (
				<div className="flex items-center gap-2">
					<Input
						autoFocus
						type={prompt.kind === "secret" ? "password" : "text"}
						placeholder={prompt.placeholder || t("providerLogin.prompt.placeholder")}
						value={value}
						onChange={(event) => setValue(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && value.trim()) onSubmit(value);
						}}
					/>
					<Button variant="default" disabled={!value.trim()} onClick={() => onSubmit(value)}>
						{t("providerLogin.prompt.submit")}
					</Button>
				</div>
			)}
		</div>
	);
}
