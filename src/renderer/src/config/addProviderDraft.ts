import { setHeaderValue } from "./providerHeaders";
import { looksDeepSeekBacked } from "../utils/modelSpecAutoFill";
import type { ModelItem, ProviderCompat, ProviderConfig } from "./configTypes";

/**
 * 新增/编辑供应商弹窗的草稿类型与草稿 → models.json provider 转换（纯函数，便于单测）。
 * 与 AddProviderDialog 组件分离：组件只负责收集字段，转换逻辑独立可测。
 */
export type AddProviderDraft = {
	name: string;
	baseUrl: string;
	api: string;
	apiKey: string;
	userAgent: string;
	compat: {
		supportsDeveloperRole: boolean;
		supportsReasoningEffort: boolean;
		/**
		 * 思考模式回传 reasoning_content。三态：true/false = 用户显式表态；
		 * undefined = 未触碰，交给保存时的 DeepSeek 特征自动判定（见 modelSpecAutoFill）。
		 */
		requiresReasoningContentOnAssistantMessages?: boolean;
	};
	/** 弹窗内维护的模型草稿（新增=空；编辑=现有模型；获取模型勾选后追加）。 */
	models: ModelItem[];
};

/**
 * 打开供应商页/卡片时 reasoning_content 回传勾选的默认值（三态）。
 *
 * 文件里已有显式值 → 原样回显（`false` 是用户否决自动判定的表态，不能被重新打开）；
 * 未表态（undefined，含「模型列表还不全」的新增草稿）时：看着是 DeepSeek 系后端就预置
 * 勾选为 true——让用户看到的勾选状态与保存结果一致（保存时同一判定会再跑一遍，
 * 见 deriveProviderCompat）；其余情况保持未表态，不往 models.json 写无意义的 false 噪声。
 *
 * 参数只取结构子集（不依赖 UI 层的 ProviderDialogInitial），因此可在单测直接调用。
 */
export function resolveInitialReasoningContentReplay(
	initial:
		| {
				name: string;
				baseUrl?: string;
				models?: ModelItem[];
				compat?: ProviderCompat;
		  }
		| undefined,
): boolean | undefined {
	const saved = initial?.compat?.requiresReasoningContentOnAssistantMessages;
	if (saved !== undefined) return saved;
	if (!initial) return undefined;
	const deepseekBacked = looksDeepSeekBacked({ models: initial.models ?? [], baseUrl: initial.baseUrl }, initial.name);
	return deepseekBacked ? true : undefined;
}

/**
 * 弹窗草稿 → models.json provider 配置。
 * 空字段不写入（与手写 models.json 一致）；User-Agent 走 headers；
 * compat 全 false 不写（与 pi 默认一致）；baseUrl 去除首尾空白。
 * models 原样写入（弹窗内已是最终列表）。
 *
 * compat.requiresReasoningContentOnAssistantMessages 是唯一例外：它只在自己被
 * 赋值（true/false）时写入——false 是「用户否决自动判定」的表态，必须落盘才能压住
 * 保存时的 DeepSeek 特征判定，不能像另两项那样无条件显式写入。
 */
export function buildProviderConfigFromDraft(draft: AddProviderDraft): ProviderConfig {
	const provider: ProviderConfig = { models: draft.models ?? [] };
	if (draft.baseUrl.trim()) provider.baseUrl = draft.baseUrl.trim();
	if (draft.api) provider.api = draft.api;
	if (draft.apiKey.trim()) provider.apiKey = draft.apiKey.trim();
	if (draft.userAgent.trim()) {
		provider.headers = setHeaderValue(undefined, "User-Agent", draft.userAgent);
	}
	const reasoningContent = draft.compat.requiresReasoningContentOnAssistantMessages;
	if (draft.compat.supportsDeveloperRole || draft.compat.supportsReasoningEffort || reasoningContent !== undefined) {
		provider.compat = {
			supportsDeveloperRole: draft.compat.supportsDeveloperRole,
			supportsReasoningEffort: draft.compat.supportsReasoningEffort,
		};
		if (reasoningContent !== undefined) {
			provider.compat.requiresReasoningContentOnAssistantMessages = reasoningContent;
		}
	}
	return provider;
}

/**
 * 编辑供应商页保存：以原 provider 为基底合并草稿，保留表单不拥有的字段。
 *
 * 为什么不能用 buildProviderConfigFromDraft 重建：那会把 oauth / authHeader /
 * modelOverrides / 自定义字段以及除 User-Agent 外的自定义 headers 静默丢掉
 * （展开卡片的内联编辑是原地改同一个对象，不会丢——两条入口行为不一致）。
 * 这里统一为「加载的 models.json 是 source of truth，表单只覆盖它拥有的字段」
 * （与 JSON Merge Patch / Kubernetes patch 的保真思路一致）：
 * - models / baseUrl / api / apiKey：表单拥有，空值 = 删除字段；
 * - headers：逐键合并，只覆盖 User-Agent，保留 X-App-URL / 鉴权头等自定义头；
 * - compat：合并两个已知布尔并保留未知子键；原本没有 compat 且两项都 false 时不凭空创建；
 * - 其余字段（oauth / authHeader / modelOverrides / 未知字段）原样透传。
 * original 为空（新增模式）时等价于 buildProviderConfigFromDraft。
 */
export function mergeProviderDraft(original: ProviderConfig | undefined, draft: AddProviderDraft): ProviderConfig {
	if (!original) return buildProviderConfigFromDraft(draft);
	const next: ProviderConfig = { ...original };
	next.models = draft.models ?? [];
	if (draft.baseUrl.trim()) next.baseUrl = draft.baseUrl.trim();
	else delete next.baseUrl;
	if (draft.api) next.api = draft.api;
	else delete next.api;
	if (draft.apiKey.trim()) next.apiKey = draft.apiKey.trim();
	else delete next.apiKey;
	// headers 逐键合并：setHeaderValue 会先删同名旧键，再按需重写 User-Agent
	const headers = setHeaderValue(original.headers, "User-Agent", draft.userAgent);
	if (headers) next.headers = headers;
	else delete next.headers;
	// compat 合并：保留未知子键；原本没有 compat 且两项都 false 时不凭空创建。
	// requiresReasoningContentOnAssistantMessages 只在草稿显式赋值时覆盖，未表态则
	// 沿用文件里的值——否则一次无关编辑就会把用户手写的开关抹回「自动判定」。
	const reasoningContent = draft.compat.requiresReasoningContentOnAssistantMessages;
	const compat: ProviderCompat = {
		...(original.compat ?? {}),
		supportsDeveloperRole: draft.compat.supportsDeveloperRole,
		supportsReasoningEffort: draft.compat.supportsReasoningEffort,
	};
	if (reasoningContent !== undefined) {
		compat.requiresReasoningContentOnAssistantMessages = reasoningContent;
	}
	const hasCompat = original.compat != null || draft.compat.supportsDeveloperRole || draft.compat.supportsReasoningEffort || reasoningContent !== undefined;
	if (hasCompat) next.compat = compat;
	else delete next.compat;
	return next;
}
