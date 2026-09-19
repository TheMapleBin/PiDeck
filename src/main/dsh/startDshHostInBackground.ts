import type { DshHostStartReason } from "./dshHostStartGate";

/**
 * DSH host 的启动依赖；保持窄接口，便于在不 fork Electron utilityProcess 的测试中验证启动语义。
 */
export type DshHostStarter = {
	ensureStarted(options?: { reason?: DshHostStartReason }): Promise<void>;
};

export type DshHostStartupLogger = {
	warn(scope: string, message: string, detail?: unknown): void | Promise<void>;
};

export type DshHostWarmupOptions = {
	/**
	 * 是否后台预热。缺省 true 保持旧语义；false 时本函数直接返回。
	 * 默认后端为 pi 的用户不该为 DSH host 常驻付出 ~200MB，真正打开 DSH 会话/
	 * 发消息时仍由 ensureStarted({ reason: "session" }) 拉起；配置只读查询不 fork。
	 */
	enabled?: boolean;
};

/**
 * 在应用首帧之后按需预热 DSH host。
 * 不等待 boot 完成，避免 host 初始化、配置加载或异常影响主窗口可用性。
 * 预热走 reason: "warmup"；用户手动停止后不得再 fork。
 * 预热失败只记录诊断日志，用户可从配置概览手动启动恢复。
 */
export function startDshHostInBackground(
	host: DshHostStarter,
	logger: DshHostStartupLogger,
	options?: DshHostWarmupOptions,
): void {
	// 不用 DSH 的用户（默认后端 pi）跳过预热，避免 utilityProcess 空转占内存。
	if (options?.enabled === false) return;
	void host.ensureStarted({ reason: "warmup" }).catch((error: unknown) => {
		void logger.warn("dsh-host", "Background DSH host startup failed", {
			error: error instanceof Error ? error.message : String(error),
		});
	});
}
