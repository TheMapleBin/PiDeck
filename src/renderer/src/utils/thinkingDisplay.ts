/**
 * Derive the thinking-level text from the latest runtime or catalog value.
 * The backend decides whether a live change affects the current turn, so the
 * renderer must not invent a separate "next turn" state.
 */
export type ThinkingDisplayResult = {
	levels: string[];
	pending: false;
};

export function computeThinkingDisplay(current: string | undefined): ThinkingDisplayResult {
	return {
		levels: current ? [current] : [],
		pending: false,
	};
}

/**
 * 底栏/选择器当前思考档位：会话保存的用户选择优先，runtime 仅在没有选择时兜底。
 * 候选档位已由当前模型能力校验，pi/DSH 回传值用于执行状态而不是改写用户偏好。
 */
export function resolveComposerThinkingLevel(input: { state?: string; record?: string; fallback?: string; isLive: boolean }): string | undefined {
	return input.record ?? (input.isLive ? input.state : undefined) ?? input.fallback;
}
