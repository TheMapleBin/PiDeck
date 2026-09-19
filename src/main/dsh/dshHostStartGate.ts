/**
 * DSH host 启动门闩（issue #223）。
 *
 * 进程监控里手动停止 host 后，只读查询和后台预热不得再 fork；
 * 用户点「启动」或真正打开/发送 DSH 会话时才清标记并拉起。
 */
export type DshHostStartReason = "implicit" | "warmup" | "session" | "explicit";

export type DshHostStartDecision = "already-running" | "skip-user-stopped" | "start";

export function decideDshHostStart(input: {
	isRunning: boolean;
	userStopped: boolean;
	reason?: DshHostStartReason;
}): DshHostStartDecision {
	if (input.isRunning) return "already-running";
	const reason = input.reason ?? "implicit";
	// 会话使用 / 显式启动：用户正在用 DSH，允许覆盖「已停止」标记。
	if (input.userStopped && reason !== "session" && reason !== "explicit") {
		return "skip-user-stopped";
	}
	return "start";
}

/** 打开 DSH 会话或点启动/重启时清掉手动停止标记。 */
export function dshHostStartClearsUserStop(reason?: DshHostStartReason): boolean {
	return reason === "session" || reason === "explicit";
}
