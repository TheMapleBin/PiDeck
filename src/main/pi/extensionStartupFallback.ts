/**
 * 扩展导致 pi RPC 起不来时的启动回退策略。
 *
 * 背景：内置扩展依赖 pi 自带的 @earendil-works/*。全局 pi 残缺时，
 * `--extension` 加载失败会让进程 exit 1，用户体感是「消息发不出去」。
 * 桌面端在首次启动失败后用 --no-extensions 再试一次，让会话先能用。
 */

export type ExtensionFallbackDecisionInput = {
	/** 用户或上次回退已经开了 --no-extensions，再试没有意义。 */
	alreadyNoExtensions: boolean;
	stderr?: string;
	errorMessage?: string;
	exitCode?: number | null;
	/**
	 * 进程仍在跑：多半是 get_state 超时/慢启动，而不是扩展把进程打死。
	 * 这时杀进程改无扩展会误伤，必须跳过。
	 */
	processStillRunning?: boolean;
	/**
	 * spawn 阶段就失败（进程从未起来，对应 PiProcess diagnostics.spawnFailed）。
	 * 这类失败与「加载了哪些扩展」毫无关系（Node 只发 error、不发 exit，pid 都没拿到），
	 * 重试 --no-extensions 只会原样再失败一次，还把用户引向错误的排查方向。
	 */
	spawnFailed?: boolean;
};

/**
 * 回退决策：retry 决定是否用 --no-extensions 再启动一次；
 * skipReason 是人话原因（retry 为 true 时为 null），用于诊断卡解释「为什么没自动回退」——
 * 用户记忆中「启动失败会自动禁用扩展重试」，不解释清楚就会被当成没生效。
 */
export type ExtensionFallbackDecision = {
	retry: boolean;
	skipReason: string | null;
};

/**
 * 是否值得用 --no-extensions 再启动一次，以及不重试时的原因。
 * 单一判定源：shouldRetryWithoutExtensions / describeExtensionFallbackSkip 都由它派生，
 * 避免「决策与解释」两条分支各自漂移。
 *
 * 不重试：已禁用扩展、进程还活着（超时）、spawn 阶段就失败、pi 本体不存在、
 * WSL 不可用。
 * 重试：明确扩展加载失败，或进程已非 0 退出 / 报 pi exited。
 */
export function decideExtensionFallback(
	input: ExtensionFallbackDecisionInput,
): ExtensionFallbackDecision {
	const text = `${input.stderr ?? ""}\n${input.errorMessage ?? ""}`;
	const spawnLikeFailure = input.spawnFailed === true || (/\bENOENT\b/.test(text) && /spawn/i.test(text));

	if (input.alreadyNoExtensions) {
		return { retry: false, skipReason: "当前启动已禁用扩展（设置里的诊断开关），无需再回退。" };
	}
	if (input.processStillRunning) {
		return {
			retry: false,
			skipReason: "pi 进程仍在运行（启动等待超时，而非进程被打死）：杀进程改无扩展会误伤慢启动，故不自动回退。",
		};
	}
	if (spawnLikeFailure) {
		return {
			retry: false,
			skipReason: "pi 进程从未启动（spawn 阶段失败），与加载了哪些扩展无关，回退 --no-extensions 也会同样失败。",
		};
	}
	if (/WSL distribution is unavailable/i.test(text)) {
		return { retry: false, skipReason: "WSL 发行版不可用，回退禁用扩展无法解决。" };
	}
	if (/Failed to load extension/i.test(text)) return { retry: true, skipReason: null };
	if (/Cannot find module/.test(text) && /extension/i.test(text)) return { retry: true, skipReason: null };
	if (typeof input.exitCode === "number" && input.exitCode !== 0) return { retry: true, skipReason: null };
	if (/pi exited\s*:/i.test(text)) return { retry: true, skipReason: null };
	return { retry: false, skipReason: null };
}

/** 是否值得用 --no-extensions 再启动一次（decideExtensionFallback 的布尔视图）。 */
export function shouldRetryWithoutExtensions(input: ExtensionFallbackDecisionInput): boolean {
	return decideExtensionFallback(input).retry;
}

/** 未回退时的人话原因（会回退或无法归因时返回 null）。 */
export function describeExtensionFallbackSkip(
	input: ExtensionFallbackDecisionInput,
): string | null {
	return decideExtensionFallback(input).skipReason;
}

/** 从 stderr 抽出扩展加载失败行，方便用户把诊断贴进聊天让 AI 分析。 */
export function extractExtensionLoadHints(stderr: string): string[] {
	const lines = stderr
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const hints: string[] = [];
	for (const line of lines) {
		if (/Failed to load extension/i.test(line) || /Cannot find module/.test(line)) {
			hints.push(line);
		}
	}
	return [...new Set(hints)].slice(0, 8);
}

/** 回退成功后写入系统消息 debugDetails 的原文（不走 i18n，给 AI/Issue 看）。 */
export function formatExtensionFallbackDebug(input: {
	rawMessage: string;
	stderr: string;
	exitCode?: number | null;
}): string {
	const lines: string[] = [];
	if (input.exitCode !== null && input.exitCode !== undefined) {
		lines.push(`First start exit code: ${input.exitCode}`);
	}
	if (input.rawMessage.trim()) {
		lines.push(input.rawMessage.trim());
	}
	const hints = extractExtensionLoadHints(input.stderr);
	if (hints.length > 0) {
		lines.push("Extension load errors:");
		lines.push(...hints);
	} else {
		const stderrText = input.stderr.trim();
		if (stderrText) {
			const snippet = stderrText.length > 600 ? `…${stderrText.slice(-600)}` : stderrText;
			lines.push(`Process stderr:\n${snippet}`);
		}
	}
	return lines.join("\n");
}
