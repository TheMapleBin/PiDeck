import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppLogger } from "../logging/AppLogger";

/**
 * Git refs 变化检测（主进程侧）。
 *
 * 为什么需要它：push/pull 角标（ahead/behind）与工作区变更列表原本只靠 5 秒轮询，
 * AI 在终端里 commit/push 之后用户往往要等下一轮才看到角标归零。本地 commit、push、
 * fetch、切分支、reset 都会改写 HEAD / refs\*\* / packed-refs，盯住这几个文件的签名
 * 就能把延迟从「最多 5 秒」压到一个轮询间隔（默认 1.5 秒），而 5 秒轮询继续兜底
 * （工作区文件改动不改变 refs 签名，变更列表仍然依赖轮询）。
 *
 * 为什么不用 fs.watch（2026-09 于 Windows 实测）：
 * - 只要在仓库子树里持有任何 fs.watch 句柄，**项目目录就无法被重命名/移动**（EPERM：
 *   Windows 要求待改名的目录子树内没有打开的句柄）。实测连只监听 `.git/HEAD` 一个
 *   文件也照样被挡——Node 在 Windows 上监听文件本质是持有其父目录句柄。删除仓库目录、
 *   删 `.git`、git 操作、`git worktree remove` 都不受影响，但「占用目录」对用户是
 *   不可预期的副作用，不能拿它换几百毫秒。
 * - 换成 stat 轮询后零句柄占用：每仓库每次只 stat 几个小文件（微秒级、不 spawn 进程），
 *   代价是检测延迟等于轮询间隔。
 *
 * 设计取舍：
 * - **按仓库去重 + 订阅计数**：分屏或两个项目指向同一路径时共用一份轮询，计数归零才
 *   停掉该仓库；全部归零后停掉全局定时器。
 * - **只在签名变化时通知**：一次 push 会连续改写多个 ref 文件，按间隔取样天然合并成
 *   一次通知；签名未变则完全不惊动渲染层。
 * - **失败静默降级**：非 git 目录、路径不存在、config 读不出来只记 warn——检测是加速
 *   手段，不是正确性的前提。
 */

/** 默认轮询间隔：用户抱怨的是「5 秒太久」，1.5 秒足够让角标跟平，成本可忽略。 */
const DEFAULT_POLL_INTERVAL_MS = 1500;

export type GitRefsWatcherDeps = {
	logger?: Pick<AppLogger, "warn">;
	/** 轮询间隔（毫秒），测试可调小。 */
	intervalMs?: number;
	/** 签名读取实现（测试注入点）；默认读真实文件。返回 null 表示该路径不是仓库。 */
	readSignature?: (repoPath: string) => string | null;
	/** 定时器注入点（测试用假定时器手动推进），默认真实 setInterval。 */
	setTimer?: (handler: () => void, intervalMs: number) => unknown;
	clearTimer?: (timer: unknown) => void;
};

type RepoWatch = {
	repoPath: string;
	/** 订阅计数：同一仓库被多个面板订阅时共用一份轮询。 */
	refs: number;
	/** 上一次采样到的签名；acquire 时先读一次做基线，避免第一次 tick 误报变化。 */
	signature: string | null;
};

/**
 * 解析工作区对应的 gitDir 与 refs 公共目录。
 *
 * - `.git` 可能是目录（普通仓库），也可能是文件（worktree / submodule，内容形如
 *   `gitdir: ../.git/worktrees/xxx`）。直接拼 `.git/refs` 在 worktree 下指向不存在的
 *   路径，会静默退化成「只靠轮询」。
 * - worktree 的 gitDir 里只有 HEAD 等文件，分支与远程引用在 `commondir` 指向的公共
 *   仓库目录里，所以两边都要看。
 *
 * @returns null 表示这不是仓库 / 无法读取（调用方静默降级）
 */
export function resolveGitDir(repoPath: string): { gitDir: string; commonDir: string } | null {
	const dotGit = join(repoPath, ".git");
	let gitDir: string;
	try {
		const info = statSync(dotGit);
		if (info.isDirectory()) {
			gitDir = dotGit;
		} else if (info.isFile()) {
			const content = readFileSync(dotGit, "utf8");
			const match = /^\s*gitdir:\s*(.+?)\s*$/m.exec(content);
			if (!match) return null;
			// 相对路径按工作区目录解析（worktree 的 .git 文件可能写相对路径）
			gitDir = resolve(repoPath, match[1]);
		} else {
			return null;
		}
	} catch {
		return null;
	}
	let commonDir = gitDir;
	try {
		const commonDirFile = join(gitDir, "commondir");
		if (existsSync(commonDirFile)) {
			const raw = readFileSync(commonDirFile, "utf8").trim();
			// commondir 相对 gitDir 解析（worktree 下通常是 "../.."）
			if (raw) commonDir = resolve(gitDir, raw);
		}
	} catch {
		// commondir 读不出来就退回 gitDir：worktree 场景少盯一个 refs 目录，仍有轮询兜底
	}
	return { gitDir, commonDir };
}

/**
 * 文件签名：不存在记 absent，目录只取 mtime，文件取 mtime + size。
 * 文件带上 size 是因为部分文件系统的 mtime 分辨率只有秒级，同一秒内的改写会看不出来。
 */
function fileStamp(path: string): string {
	try {
		const info = statSync(path);
		return info.isDirectory() ? `d${info.mtimeMs}` : `f${info.mtimeMs}.${info.size}`;
	} catch {
		return "absent";
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 读 HEAD 得到当前分支的完整 ref 名（refs/heads/x）；detached HEAD 返回 null。 */
function readHeadBranch(headPath: string): string | null {
	try {
		const match = /^\s*ref:\s*(\S+)\s*$/m.exec(readFileSync(headPath, "utf8"));
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

/**
 * 从 .git/config 取指定分支的 upstream（remote + merge）。
 * 手写解析而不是 `git rev-parse @{upstream}`：轮询里不能起子进程。
 */
export function readBranchUpstream(configText: string, branch: string): { remote: string; merge: string } | null {
	const sectionPattern = new RegExp(`^\\[branch\\s+"${escapeRegExp(branch)}"\\]$`);
	let inSection = false;
	let remote: string | null = null;
	let merge: string | null = null;
	for (const rawLine of configText.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.startsWith("[")) {
			// 进入/离开目标 section：只认当前分支，别的 section 直接跳过
			inSection = sectionPattern.test(line);
			continue;
		}
		if (!inSection || !line || line.startsWith("#") || line.startsWith(";")) continue;
		const separator = line.indexOf("=");
		if (separator < 0) continue;
		const key = line.slice(0, separator).trim().toLowerCase();
		const value = line.slice(separator + 1).trim();
		if (key === "remote") remote = value;
		else if (key === "merge") merge = value;
	}
	if (!remote || !merge) return null;
	return { remote, merge };
}

/** config 的 remote/merge → 真正需要盯的引用路径（远程跟踪引用，或本地分支）。 */
function upstreamRefPath(upstream: { remote: string; merge: string }): string | null {
	const { remote, merge } = upstream;
	if (merge.startsWith("refs/heads/")) {
		const branchName = merge.slice("refs/heads/".length);
		// remote 为 "." 表示 upstream 是同仓库的另一个本地分支（branch.x.remote = .）
		return remote === "." ? `refs/heads/${branchName}` : `refs/remotes/${remote}/${branchName}`;
	}
	// 少见的 merge 目标（如 refs/tags/x）也能直接当引用路径用
	return merge.startsWith("refs/") ? merge : null;
}

/**
 * 与 ahead/behind 相关的引用状态签名（变化即说明角标/分支可能需要刷新）。
 *
 * 刻意排除 index：`git status` 自己会改写它，收进签名就是「刷新 → status → index →
 * 再刷新」的自激循环。同理不碰 FETCH_HEAD / ORIG_HEAD：它们只记录某次动作，不含新信息。
 */
export function readRefsSignature(repoPath: string): string | null {
	const roots = resolveGitDir(repoPath);
	if (!roots) return null;
	const { gitDir, commonDir } = roots;
	const headPath = join(gitDir, "HEAD");
	const parts = [
		// HEAD：切分支 / detached HEAD
		`HEAD=${fileStamp(headPath)}`,
		// packed-refs：gc / pack-refs / fetch 把松散引用打包（同时删掉松散文件）
		`packed=${fileStamp(join(commonDir, "packed-refs"))}`,
		// config：改 upstream（git push -u、branch --set-upstream-to）会改变角标基线
		`config=${fileStamp(join(commonDir, "config"))}`,
		`configwt=${fileStamp(join(gitDir, "config.worktree"))}`,
		// 目录 mtime 是粗信号（NTFS 会延迟更新，不可靠但免费）：新建/删除分支时兜一下
		`heads=${fileStamp(join(commonDir, "refs", "heads"))}`,
		`remotes=${fileStamp(join(commonDir, "refs", "remotes"))}`,
	];
	const branchRef = readHeadBranch(headPath);
	if (branchRef) {
		// 当前分支：commit / reset / push 都会改写它
		parts.push(`branch=${fileStamp(join(commonDir, branchRef))}`);
		const upstream = readBranchUpstream(readTextIfExists(join(commonDir, "config")) ?? "", branchRef.replace(/^refs\/heads\//, ""));
		const refPath = upstream ? upstreamRefPath(upstream) : null;
		// 上游引用：fetch / push 更新远程跟踪引用
		if (refPath) parts.push(`upstream=${fileStamp(join(commonDir, refPath))}`);
	}
	return parts.join("|");
}

function readTextIfExists(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

function buildWatchId(projectId: string, repoPath: string): string {
	return `${projectId}::${repoPath}`;
}

function describeError(caught: unknown): string {
	return caught instanceof Error ? caught.message : String(caught);
}

export class GitRefsWatcher {
	private readonly logger: Pick<AppLogger, "warn"> | undefined;
	private readonly intervalMs: number;
	private readonly readSignatureFn: (repoPath: string) => string | null;
	private readonly setTimer: (handler: () => void, intervalMs: number) => unknown;
	private readonly clearTimer: (timer: unknown) => void;
	private readonly listeners = new Set<(watchId: string) => void>();
	private readonly repos = new Map<string, RepoWatch>();
	private timer: unknown = null;
	private polling = false;

	constructor(deps: GitRefsWatcherDeps = {}) {
		this.logger = deps.logger;
		this.intervalMs = deps.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		this.readSignatureFn = deps.readSignature ?? readRefsSignature;
		this.setTimer = deps.setTimer ?? ((handler, intervalMs) => setInterval(handler, intervalMs));
		this.clearTimer = deps.clearTimer ?? ((timer) => clearInterval(timer as NodeJS.Timeout));
	}

	/** 订阅「某个仓库的 refs 变化」；返回退订函数。通知 payload 是 watchId，便于渲染层过滤自己的仓库。 */
	on(listener: (watchId: string) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** 当前登记中的仓库数（诊断/测试用）。 */
	get activeRepoCount(): number {
		return this.repos.size;
	}

	/**
	 * 登记一个仓库订阅；同一 projectId + repoPath 复用同一个 watchId 并累加计数。
	 * 非 git 目录也会返回 id（调用方不必分支处理），只是永远不会收到通知。
	 */
	acquire(projectId: string, repoPath: string): string {
		const watchId = buildWatchId(projectId, repoPath);
		const existing = this.repos.get(watchId);
		if (existing) {
			existing.refs += 1;
			return watchId;
		}
		const signature = this.sample(repoPath);
		if (signature === null) this.warn("git refs watch skipped: not a git repository", { repoPath });
		this.repos.set(watchId, { repoPath, refs: 1, signature });
		this.startPolling();
		return watchId;
	}

	/** 退订一次；计数归零才停掉该仓库。未知 id 静默忽略（重复退订必须安全）。 */
	release(watchId: string): void {
		const repo = this.repos.get(watchId);
		if (!repo) return;
		repo.refs -= 1;
		if (repo.refs > 0) return;
		this.repos.delete(watchId);
		if (this.repos.size === 0) this.stopPolling();
	}

	/** 退出清理：停轮询并清空订阅与登记（装配层 quitCleanup 调用）。 */
	disposeAll(): void {
		this.stopPolling();
		this.repos.clear();
		this.listeners.clear();
	}

	private startPolling(): void {
		if (this.polling) return;
		this.polling = true;
		const timer = this.setTimer(() => this.tick(), this.intervalMs);
		// 不把进程钉住；退出路径由装配层的 quitCleanup 负责
		(timer as { unref?: () => void } | null)?.unref?.();
		this.timer = timer;
	}

	private stopPolling(): void {
		if (!this.polling) return;
		this.polling = false;
		this.clearTimer(this.timer);
		this.timer = null;
	}

	/** 一轮采样：签名变化才通知（一次 push 的多文件改写按间隔天然合并成一次）。 */
	private tick(): void {
		for (const [watchId, repo] of this.repos) {
			const next = this.sample(repo.repoPath);
			if (next === repo.signature) continue;
			// 先更新基线再通知：通知处理里若同步引发新的采样，也不会重复上报同一状态
			repo.signature = next;
			this.notify(watchId);
		}
	}

	private notify(watchId: string): void {
		for (const listener of this.listeners) {
			try {
				listener(watchId);
			} catch (caught) {
				// 单个订阅者（如已销毁的窗口回调）抛错不能影响其它订阅者与后续轮询
				this.warn("git refs change listener failed", { watchId, error: describeError(caught) });
			}
		}
	}

	/** 采样失败（目录消失、权限、竞态）不抛给轮询循环：记 warn 后当作「无法判断」。 */
	private sample(repoPath: string): string | null {
		try {
			return this.readSignatureFn(repoPath);
		} catch (caught) {
			this.warn("git refs signature failed", { repoPath, error: describeError(caught) });
			return null;
		}
	}

	private warn(message: string, detail?: Record<string, unknown>): void {
		this.logger?.warn("git", message, detail);
	}
}
