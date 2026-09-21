import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Check, ExternalLink, KeyRound, Loader2, LogOut } from "lucide-react";
import type { PiAuthFlowEvent, PiAuthProviderOption } from "../../../../shared/types/piAuth";
import { closeProviderLoginAtom, providerLoginRequestAtom } from "../../atoms/providerLoginAtoms";
import { useProviderLoginFlow, type ProviderLoginPhase } from "../../hooks/useProviderLoginFlow";
import { t } from "../../i18n";
import { openInSystemBrowser } from "../../utils/openExternal";
import { Button } from "../ui-shadcn/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui-shadcn/dialog";
import { Input } from "../ui-shadcn/input";

/**
 * 「登录供应商」弹框。
 *
 * 入口是输入框里的 `/login`（pi 的命令表里也有这条，所以 `/` 菜单会列出来），
 * 但 pi 的登录实现只在它的 CLI 交互层，桌面端通过认证例外通道复用 pi 官方
 * `ModelRuntime` 的认证 API 完成登录：见 `shared/types/piAuth.ts` 与 AGENTS.md。
 *
 * 两层组件：外壳只订阅「是否打开」的 atom；body 在打开时才挂载，于是每次打开都是
 * 全新流程状态（上一次的提问/事件不会残留）。真正的流程状态机在 `useProviderLoginFlow`。
 */
export function ProviderLoginModal() {
	const request = useAtomValue(providerLoginRequestAtom);
	if (!request.open) return null;
	return <ProviderLoginBody preselectedProviderId={request.providerId} />;
}

function ProviderLoginBody({ preselectedProviderId }: { preselectedProviderId?: string }) {
	const close = useSetAtom(closeProviderLoginAtom);
	// 关弹框时 hook 会顺手取消进行中的登录（否则助手进程要等到超时）。
	const flow = useProviderLoginFlow({ open: true, preselectedProviderId, onClose: () => close() });
	const { state } = flow;

	return (
		<Dialog open onOpenChange={(next) => (next ? undefined : flow.close())}>
			<DialogContent
				className="sm:max-w-lg"
				onEscapeKeyDown={(event) => {
					event.preventDefault();
					flow.close();
				}}
			>
				<DialogHeader>
					<DialogTitle>{t("providerLogin.title")}</DialogTitle>
					<DialogDescription>{state.phase === "running" ? t("providerLogin.running.title", { provider: state.providerId }) : t("providerLogin.subtitle")}</DialogDescription>
				</DialogHeader>
				{state.phase === "loading" && (
					<div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						{t("providerLogin.loading")}
					</div>
				)}
				{state.phase === "list-error" && (
					<div className="space-y-3 py-3">
						<p className="text-sm text-destructive">{t("providerLogin.listFailed")}</p>
						<p className="break-all font-mono text-xs text-muted-foreground">{state.message}</p>
					</div>
				)}
				{state.phase === "picking" && <ProviderListBody flow={flow} providers={state.providers} piVersion={state.piVersion} />}
				{state.phase === "running" && <RunningBody flow={flow} state={state} />}
				{state.phase === "succeeded" && (
					<div className="space-y-2 py-3">
						<p className="flex items-center gap-2 text-sm font-medium">
							<Check className="size-4 text-emerald-500" />
							{t("providerLogin.success.title")}
						</p>
						<p className="text-sm text-muted-foreground">{t("providerLogin.success.hint")}</p>
					</div>
				)}
				{state.phase === "failed" && (
					<div className="space-y-2 py-3">
						<p className="text-sm font-medium text-destructive">{state.message}</p>
						{state.detail && <p className="break-all font-mono text-xs text-muted-foreground">{state.detail}</p>}
					</div>
				)}
				<div className="flex justify-end gap-2 pt-2">
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
					{state.phase !== "running" && (
						<Button variant="ghost" onClick={() => flow.close()}>
							{t("providerLogin.close")}
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

/** 供应商列表：每个可登录方式一个按钮，已登录的给「退出登录」。 */
function ProviderListBody({ flow, providers, piVersion }: { flow: ReturnType<typeof useProviderLoginFlow>; providers: PiAuthProviderOption[]; piVersion?: string }) {
	if (providers.length === 0) {
		return <p className="py-4 text-sm text-muted-foreground">{t("providerLogin.noProviders")}</p>;
	}
	return (
		<div className="max-h-[50vh] space-y-2 overflow-y-auto py-1">
			{providers.map((provider) => (
				<div key={provider.id} className="rounded-lg border border-border p-3">
					<div className="flex items-center justify-between gap-2">
						<div className="min-w-0">
							<p className="truncate text-sm font-medium">{provider.name || provider.id}</p>
							<p className="truncate font-mono text-xs text-muted-foreground">{provider.id}</p>
						</div>
						<span className="shrink-0 text-xs text-muted-foreground">{provider.credential ? t("providerLogin.status.loggedIn") : t("providerLogin.status.loggedOut")}</span>
					</div>
					<div className="mt-2 flex flex-wrap items-center gap-2">
						{provider.oauth && (
							<Button size="sm" variant="secondary" disabled={!!flow.busyProviderId} onClick={() => void flow.startLogin(provider.id, "oauth")}>
								<ExternalLink className="size-3.5" />
								{provider.oauth.label || t("providerLogin.method.oauth")}
							</Button>
						)}
						{provider.apiKey?.canLogin && (
							<Button size="sm" variant="secondary" disabled={!!flow.busyProviderId} onClick={() => void flow.startLogin(provider.id, "api_key")}>
								<KeyRound className="size-3.5" />
								{provider.apiKey.name || t("providerLogin.method.apiKey")}
							</Button>
						)}
						{provider.credential && (
							<Button size="sm" variant="ghost" disabled={!!flow.busyProviderId} onClick={() => void flow.logout(provider.id)}>
								<LogOut className="size-3.5" />
								{t("providerLogin.action.logout")}
							</Button>
						)}
						{provider.ambientOnly && <span className="text-xs text-muted-foreground">{t("providerLogin.method.apiKeyHint")}</span>}
					</div>
				</div>
			))}
			{piVersion && <p className="pt-1 text-right font-mono text-xs text-muted-foreground">{t("providerLogin.piVersion", { version: piVersion })}</p>}
		</div>
	);
}

/** 登录进行中：pi 推来的事件流 + 需要用户回答的提问 + 取消。 */
function RunningBody({ flow, state }: { flow: ReturnType<typeof useProviderLoginFlow>; state: Extract<ProviderLoginPhase, { phase: "running" }> }) {
	return (
		<div className="space-y-3 py-1">
			<div className="max-h-64 space-y-1 overflow-y-auto rounded-lg bg-muted/40 p-3">
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
			{state.prompt && <PromptRow prompt={state.prompt} onSubmit={(value) => void flow.answerPrompt(value)} />}
			<div className="flex justify-end">
				<Button variant="ghost" onClick={() => void flow.cancelLogin()}>
					{t("providerLogin.running.cancel")}
				</Button>
			</div>
		</div>
	);
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
