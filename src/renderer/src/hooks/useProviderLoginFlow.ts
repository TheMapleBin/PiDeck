import { useCallback, useEffect, useRef, useState } from "react";
import type { PiAuthFlowEvent, PiAuthMethod, PiAuthPrompt, PiAuthProviderOption } from "../../../shared/types/piAuth";
import { desktopApi as api } from "../desktopApi";
import { t } from "../i18n";

/**
 * 「登录供应商」弹框的状态机与命令。
 *
 * 为什么单独成 hook：弹框要同时处理「列表加载 / 挑选方式 / pi 推来的事件流 / 提问回填 /
 * 取消与失败」五类状态，塞进组件会让渲染与状态互相缠绕。这里 state 只描述「现在处在哪一步」，
 * 组件只负责把它画出来。
 *
 * 事件流来自 pi 自己的认证实现（经 PiAuthService → IPC 推送），宿主不做二次加工：
 * `auth_url` / `device_code` 等只做展示，真正的授权在浏览器/供应商侧完成。
 */

/** 弹框所处阶段。 */
export type ProviderLoginPhase =
	/** 正在拉供应商列表 */
	| { phase: "loading" }
	| { phase: "list-error"; message: string }
	/** 列表就绪：挑供应商与登录方式 */
	| { phase: "picking"; providers: PiAuthProviderOption[]; piVersion?: string }
	/** 登录进行中：事件流 + 待回答问题 */
	| { phase: "running"; providerId: string; method: PiAuthMethod; events: PiAuthFlowEvent[]; prompt?: PiAuthPrompt }
	/** 登录成功：pi 已把凭据写进自己的 auth.json */
	| { phase: "succeeded"; providerId: string }
	/** 登录失败（含 pi 侧报错、进程起不来） */
	| { phase: "failed"; providerId?: string; message: string; detail?: string };

/** 事件流在 UI 上的滚动上限：长流程（轮询 device code）只保留最近若干条。 */
const MAX_EVENTS = 20;

/**
 * 失败分类 → i18n。主进程已把「为什么起不来」翻成人话（WSL / 缺文件 / 找不到入口），
 * 这里再补一层通用文案，保证任何 errorKind 都有可读标题。
 */
function errorTitle(kind: string | undefined): string {
	switch (kind) {
		case "unknown-provider":
			return t("providerLogin.error.unknownProvider");
		case "unsupported":
			return t("providerLogin.error.unsupported");
		case "busy":
			return t("providerLogin.error.busy");
		case "timeout":
			return t("providerLogin.error.timeout");
		case "sdk-unavailable":
			return t("providerLogin.error.sdkUnavailable");
		case "spawn-failed":
			return t("providerLogin.error.spawnFailed");
		case "protocol":
			return t("providerLogin.error.protocol");
		default:
			return t("providerLogin.error.loginFailed");
	}
}

export function useProviderLoginFlow(options: { open: boolean; preselectedProviderId?: string; onClose: () => void }) {
	const { open, preselectedProviderId } = options;
	const [state, setState] = useState<ProviderLoginPhase>({ phase: "loading" });
	const [busyProviderId, setBusyProviderId] = useState<string | undefined>(undefined);
	/** 登录进行中标记：IPC 推送晚到（取消后）时要能丢弃，否则会把已关闭的弹框拽回 running。 */
	const runningRef = useRef(false);
	const openRef = useRef(open);
	openRef.current = open;

	const loadProviders = useCallback(async () => {
		setState({ phase: "loading" });
		try {
			const result = await api.piAuth.listProviders();
			if (!openRef.current) return;
			if (!result.ok) {
				setState({ phase: "list-error", message: `${errorTitle(result.errorKind)}：${result.error}` });
				return;
			}
			setState({ phase: "picking", providers: result.list.providers, piVersion: result.list.piVersion });
		} catch (error) {
			if (!openRef.current) return;
			setState({ phase: "list-error", message: error instanceof Error ? error.message : String(error) });
		}
	}, []);

	// 打开时刷新列表：凭据状态（哪个供应商已登录）是 pi 读 auth.json 得到的实时快照。
	useEffect(() => {
		if (!open) return;
		runningRef.current = false;
		setBusyProviderId(undefined);
		void loadProviders();
	}, [open, loadProviders]);

	// 事件/提问订阅：弹框关掉即退订（preload 的订阅返回 unsubscribe）。
	useEffect(() => {
		if (!open) return;
		const unsubscribe = api.piAuth.onFlowUpdate((update) => {
			if (!runningRef.current) return;
			if (update.kind === "prompt-cancelled") {
				setState((previous) => (previous.phase === "running" && previous.prompt?.id === update.promptId ? { ...previous, prompt: undefined } : previous));
				return;
			}
			setState((previous) => {
				if (previous.phase !== "running") return previous;
				if (update.kind === "prompt") return { ...previous, prompt: update.prompt };
				// 事件与提问互不影响：进度/链接事件到达时不能顺手清掉待答问题，
				// 否则用户会看不到 pi 正在等的那条输入而卡到超时。
				// 提问只在「用户已提交」或「pi 自己解决了该提问（prompt-cancelled）」时消失。
				return { ...previous, events: [...previous.events, update.event].slice(-MAX_EVENTS) };
			});
		});
		return unsubscribe;
	}, [open]);

	const startLogin = useCallback(
		async (providerId: string, method: PiAuthMethod) => {
			runningRef.current = true;
			setBusyProviderId(providerId);
			// 立刻切到 running：登录可能有网络等待，不能等 IPC 返回才有反馈。
			setState({ phase: "running", providerId, method, events: [] });
			try {
				const result = await api.piAuth.login({ providerId, method });
				runningRef.current = false;
				if (!openRef.current) return;
				if (result.cancelled) {
					// 用户主动取消：不是错误，回到列表（pi 侧凭据保持原样）。
					setBusyProviderId(undefined);
					void loadProviders();
					return;
				}
				if (result.ok) {
					setBusyProviderId(undefined);
					setState({ phase: "succeeded", providerId });
					return;
				}
				setBusyProviderId(undefined);
				setState({ phase: "failed", providerId, message: errorTitle(result.errorKind), detail: result.error });
			} catch (error) {
				runningRef.current = false;
				if (!openRef.current) return;
				setBusyProviderId(undefined);
				setState({ phase: "failed", providerId, message: errorTitle(undefined), detail: error instanceof Error ? error.message : String(error) });
			}
		},
		[loadProviders],
	);

	const answerPrompt = useCallback(async (value: string) => {
		let promptId: string | undefined;
		setState((previous) => {
			if (previous.phase !== "running" || !previous.prompt) return previous;
			promptId = previous.prompt.id;
			return { ...previous, prompt: undefined };
		});
		if (!promptId) return;
		try {
			await api.piAuth.answerPrompt(promptId, value);
		} catch (error) {
			if (!openRef.current) return;
			setState({ phase: "failed", message: errorTitle(undefined), detail: error instanceof Error ? error.message : String(error) });
		}
	}, []);

	/** 取消登录：告诉主进程 kill 掉助手进程，等 login 的结果回来再决定 UI（避免假取消）。 */
	const cancelLogin = useCallback(async () => {
		try {
			await api.piAuth.cancel();
		} catch {
			// 取消失败（进程已退出等）不额外报错：等待 login 结果即可。
		}
	}, []);

	const logout = useCallback(
		async (providerId: string) => {
			setBusyProviderId(providerId);
			try {
				const result = await api.piAuth.logout(providerId);
				if (!openRef.current) return;
				if (!result.ok) {
					setState({ phase: "failed", providerId, message: errorTitle(undefined), detail: result.error });
					return;
				}
				await loadProviders();
			} catch (error) {
				if (!openRef.current) return;
				setState({ phase: "failed", providerId, message: errorTitle(undefined), detail: error instanceof Error ? error.message : String(error) });
			} finally {
				setBusyProviderId(undefined);
			}
		},
		[loadProviders],
	);

	/** 关弹框：登录进行中就顺手取消（否则助手进程会一直等到超时）。 */
	const close = useCallback(() => {
		if (runningRef.current) void cancelLogin();
		options.onClose();
	}, [cancelLogin, options]);

	return { state, busyProviderId, preselectedProviderId, loadProviders, startLogin, answerPrompt, cancelLogin, logout, close };
}
