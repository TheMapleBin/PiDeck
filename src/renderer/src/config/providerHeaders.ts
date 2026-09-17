import { t, type TranslationKey } from "../i18n";

// User-Agent 预设清单已迁到 ./userAgentPresets（纯函数 + 分组元数据，可单测）：
// 这里保留 providerHeaders 的职责——headers 对象的规范读取/写入与 API 类型映射。

export { getUserAgentOptions, USER_AGENT_UNSET, USER_AGENT_PRESETS } from "./userAgentPresets";

export function getProviderHeaders(value: unknown): Record<string, string> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const entries = Object.entries(value).filter(
		([key, headerValue]) =>
			key.trim().length > 0 && typeof headerValue === "string",
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function getHeaderValue(headers: unknown, targetKey: string) {
	const normalized = getProviderHeaders(headers);
	if (!normalized) return "";
	const entry = Object.entries(normalized).find(
		([key]) => key.toLowerCase() === targetKey.toLowerCase(),
	);
	return entry?.[1] ?? "";
}

export function setHeaderValue(
	headers: unknown,
	targetKey: string,
	value: string,
): Record<string, string> | undefined {
	const normalized = { ...(getProviderHeaders(headers) ?? {}) };
	for (const key of Object.keys(normalized)) {
		if (key.toLowerCase() === targetKey.toLowerCase()) delete normalized[key];
	}
	if (value.trim()) normalized[targetKey] = value.trim();
	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

// pi provider 的 api 字段必须使用官方 registry 名称；openai-completions 实际对应 Chat Completions。
// 不再把历史别名 openai-chat-completions 作为预设暴露，避免测试通过但 pi 会话启动失败。
export const PROVIDER_API_OPTIONS = [
	"openai-completions",
	"openai-responses",
	"openai-codex-responses",
	"anthropic-messages",
	"google-generative-ai",
	"mistral-conversations",
];

export const API_TYPE_LABELS: Record<string, string> = {
	"openai-completions": "OpenAI Chat Completions",
	"openai-responses": "OpenAI Responses",
	"openai-codex-responses": "OpenAI Codex Responses",
	"anthropic-messages": "Anthropic Messages",
	"google-generative-ai": "Google Generative AI",
	"mistral-conversations": "Mistral Conversations",
};

const API_TYPE_DESCRIPTION_KEYS: Record<string, TranslationKey> = {
	"openai-completions": "config.apiTypeDescription.openaiCompletions",
	"openai-responses": "config.apiTypeDescription.openaiResponses",
	"openai-codex-responses": "config.apiTypeDescription.openaiCodexResponses",
	"anthropic-messages": "config.apiTypeDescription.anthropicMessages",
	"google-generative-ai": "config.apiTypeDescription.googleGenerativeAi",
	"mistral-conversations": "config.apiTypeDescription.mistralConversations",
};

export function getApiTypeDescription(apiType: string): string {
	const key = API_TYPE_DESCRIPTION_KEYS[apiType];
	return key ? t(key) : "";
}

/**
 * 主流供应商 → API 端点映射。
 * 用于在 settings 中自动发现 auth-only 供应商的模型列表，无需用户手动在 models.json 中配置。
 */
export const KNOWN_PROVIDER_ENDPOINTS: Record<
	string,
	{ baseUrl: string; apiType: string }
> = {
	"openai": { baseUrl: "https://api.openai.com/v1", apiType: "openai-completions" },
	"anthropic": { baseUrl: "https://api.anthropic.com/v1", apiType: "anthropic-messages" },
	"google": { baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiType: "google-generative-ai" },
	"deepseek": { baseUrl: "https://api.deepseek.com/v1", apiType: "openai-completions" },
	"mistral": { baseUrl: "https://api.mistral.ai/v1", apiType: "mistral-conversations" },
	"nvidia": { baseUrl: "https://integrate.api.nvidia.com/v1", apiType: "openai-completions" },
	"xai": { baseUrl: "https://api.x.ai/v1", apiType: "openai-completions" },
	"groq": { baseUrl: "https://api.groq.com/openai/v1", apiType: "openai-completions" },
	"cerebras": { baseUrl: "https://api.cerebras.ai/v1", apiType: "openai-completions" },
	"openrouter": { baseUrl: "https://openrouter.ai/api/v1", apiType: "openai-completions" },
	"together": { baseUrl: "https://api.together.xyz/v1", apiType: "openai-completions" },
	"fireworks": { baseUrl: "https://api.fireworks.ai/inference/v1", apiType: "openai-completions" },
	"huggingface": { baseUrl: "https://api-inference.huggingface.co/v1", apiType: "openai-completions" },
	"opencode": { baseUrl: "https://opencode.ai/zen/v1", apiType: "openai-completions" },
	"opencode-go": { baseUrl: "https://opencode.ai/zen/go/v1", apiType: "openai-completions" },
	"minimax": { baseUrl: "https://api.minimax.io/v1", apiType: "openai-completions" },
	"minimax-cn": { baseUrl: "https://api.minimaxi.com/v1", apiType: "openai-completions" },
	// TokenDance（词元跳动）：多模型/多供应商网关，OpenAI 兼容 base URL；模型拉取
	// 走其公开 /gateway/v1/models（无需鉴权），余额查询由 providerUsageProbe 专属候选覆盖。
	"tokendance": { baseUrl: "https://tokendance.space/gateway/v1", apiType: "openai-completions" },
};
