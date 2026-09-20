import { existsSync, type FSWatcher, readFileSync, readdirSync, statSync, watch } from "node:fs";
import { join, resolve } from "node:path";
import type { AppLogger } from "../logging/AppLogger";

/**
 * Git refs 变化监听（主进程侧）。
 *
 * 为什么需要它：push/pull 角标（ahead/behind）与工作区变更列表原本只靠 5 秒轮询，
 * AI 在终端里 commit/push 之后，用户往往要等下一轮才看到角标归零。`.git/refs` 是这类
 * 变化的唯一汇聚点：本地 commit、push、fetch、切分支、reset 都会改写 HEAD /
 * refs\*\* / packed-refs。监听它能把延迟从「最多 5 秒」压到百毫秒级，而轮询保留为
 * 兜底（工作区文件改动不产生 refs 事件，变更列表仍需要轮询）。
 *
 * 设计取舍：
 * - **按仓库去重 + 订阅计数**：多个面板可能同时看同一个仓库（分屏、多个项目指向同一
 *   路径），重复 `fs.watch` 只是白占句柄；计数归零才真正 close。
 * - **事件合并**：一次 push 会连续改写多个 ref 文件，pack-refs 还会重写 packed-refs，
 *   用固定窗口去抖合并成一次通知，避免渲染层连打若干轮刷新。
 * - **失败静默降级**：非 git 目录、权限不足、Linux inotify 句柄耗尽时只记 warn，
 *   渲染层继续用轮询兜底——监听是加速手段，不是正确性的前提。
 */

/** 事件合并窗口：push/fetch/pack-refs 会在毫秒级连续改写多个 ref 文件。 */
const DEFAULT_DEBOUNCE_MS = 200;
/** refs/ 子目录扫描深度上限（refs/heads/<org>/<branch> 已够用，更深的层多是异常仓库）。 */
const REFS_SCAN_MAX_DEPTH = 4;

/**
 * commonDir（普通仓库就是 .git 本身）直属文件里与 refs 变化有关的名字，其余一律忽略。
 *
 * 尤其是 `index`：`git status` 自己会刷新 index 里的 stat 信息并改写它，若把它算作变化，
 * 就会形成「刷新 → status → index 改写 → 再刷新」的自激循环。同理 FETCH_HEAD /
 * ORIG_HEAD 只记录一次 fetch 动作，对变更列表和角标没有意义，收进来只会多刷一轮。
 */
const REFS_RELEVANT_FILES = new Set(["HEAD", "packed-refs", "refs"]);

export type GitRefsWatcherDeps = {
	/** 监听适配器（可替换以便测试注入确定性假实现）。 */
	watchDirectory?: (directory: string, listener: (eventType: string, fileName: string | Buffer | null) => void, recursive: boolean) => Pick<FSWatcher, "close">;
	logger?: Pick<AppLogger, "warn">;
	debounceMs?: number;
	/** refs/ 是否支持递归监听；缺省按平台判断，测试可强制 false 走逐层补挂分支。 */
	recursiveRefs?: boolean;
};

type RepoWatch = {
	watchers: Array<Pick<FSWatcher, "close">>;
	/** watchId → 订阅计数：同一仓库被多个面板订阅时共用一份句柄。 */
	subscribers: Map<string, number>;
	timer: NodeJS.Timeout | null;
	/** Linux 下已挂句柄的 refs 子目录（Windows/macOS 走递归监听，这里为空）。 */
	watchedDirs: Set<string>;
	/** 解析出来的 refs 根目录（commonDir）；Linux 补挂子目录时复用。 */
	refsDir: string | null;
};

/**
 * 默认监听适配器：`persistent: false` 让监听句柄不把进程钉住（退出清理另由 C12 登记表负责）。
 * 导出以便测试替换成确定性假实现。
 */
export function watchGitRefsDirectory(directory: string, listener: (eventType: string, fileName: string | Buffer | null) => void, recursive = false): Pick<FSWatcher, "close"> {
	return watch(directory, { persistent: false, recursive }, listener);
}

/** macOS/Windows 上 fs.watch 支持递归；Linux（inotify）不支持，必须逐层补挂句柄。 */
function platformSupportsRecursiveRefs(): boolean {
	return process.platform === "darwin" || process.platform === "win32";
}

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
		// commondir 读不出来就退回 gitDir：worktree 场景少一份 refs 监听，仍有轮询兜底
	}
	return { gitDir, commonDir };
}

export class GitRefsWatcher {
	private readonly deps: GitRefsWatcherDeps;
	private readonly debounceMs: number;
	private readonly recursiveRefs: boolean;
	/** repoPath → 仓库级监听（多个 watchId 共用） */
	private readonly repos = new Map<string, RepoWatch>();
	/** watchId → repoPath，release 时定位仓库 */
	private readonly watchIdToRepo = new Map<string, string>();
	private readonly listeners = new Set<(watchId: string) => void>();

	constructor(deps: GitRefsWatcherDeps = {}) {
		this.deps = deps;
		this.debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
		this.recursiveRefs = deps.recursiveRefs ?? platformSupportsRecursiveRefs();
	}

	/**
	 * 订阅某个仓库的 refs 变化。
	 *
	 * 必须与 {@link release} 成对调用（一次 acquire 对应一次 release），计数归零才关闭监听。
	 *
	 * @returns watchId：同一 (projectId, repoPath) 恒定，渲染层用它过滤推送事件
	 */
	acquire(projectId: string, repoPath: string): string {
		const watchId = `${projectId}::${repoPath}`;
		const existing = this.watchIdToRepo.get(watchId);
		if (existing) {
			const repo = this.repos.get(existing);
			if (repo) {
				repo.subscribers.set(watchId, (repo.subscribers.get(watchId) ?? 0) + 1);
				return watchId;
			}
		}
		this.watchIdToRepo.set(watchId, repoPath);
		const repo = this.ensureRepo(repoPath);
		repo.subscribers.set(watchId, (repo.subscribers.get(watchId) ?? 0) + 1);
		return watchId;
	}

	/** 退订：计数归零时关闭该仓库的监听句柄。未知 watchId 静默忽略（重复退订是安全的）。 */
	release(watchId: string): void {
		const repoPath = this.watchIdToRepo.get(watchId);
		if (!repoPath) return;
		const repo = this.repos.get(repoPath);
		if (!repo) {
			this.watchIdToRepo.delete(watchId);
			return;
		}
		const remaining = (repo.subscribers.get(watchId) ?? 0) - 1;
		if (remaining > 0) {
			repo.subscribers.set(watchId, remaining);
			return;
		}
		repo.subscribers.delete(watchId);
		this.watchIdToRepo.delete(watchId);
		if (repo.subscribers.size === 0) this.closeRepo(repoPath, repo);
	}

	/** 订阅推送：回调收到 watchId，渲染层只处理自己那一份。返回退订函数。 */
	on(listener: (watchId: string) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** 退出清理：关闭全部句柄与待触发定时器。 */
	disposeAll(): void {
		for (const [repoPath, repo] of this.repos) this.closeRepo(repoPath, repo);
		this.repos.clear();
		this.watchIdToRepo.clear();
		this.listeners.clear();
	}

	/** 活跃仓库监听数（诊断/测试用）。 */
	get activeRepoCount(): number {
		return this.repos.size;
	}

	private ensureRepo(repoPath: string): RepoWatch {
		const existing = this.repos.get(repoPath);
		if (existing) return existing;
		const repo: RepoWatch = { watchers: [], subscribers: new Map(), timer: null, watchedDirs: new Set(), refsDir: null };
		this.repos.set(repoPath, repo);
		this.attach(repoPath, repo);
		return repo;
	}

	/** 挂上监听句柄；任何一步失败都只记 warn（渲染层轮询兜底）。 */
	private attach(repoPath: string, repo: RepoWatch): void {
		const roots = resolveGitDir(repoPath);
		if (!roots) {
			this.warn("git refs watch skipped: not a git repository", { repoPath });
			return;
		}
		const onEvent = (fileName: string | Buffer | null, fromRefsDir: boolean) => {
			if (!fromRefsDir) {
				// fileName 为 null 时无法过滤：宁可多刷一轮，也不要漏掉 refs 变化
				const name = fileName == null ? null : String(fileName);
				if (name !== null && !REFS_RELEVANT_FILES.has(name)) return;
			}
			this.scheduleFlush(repo);
		};
		this.watchDir(repo, roots.commonDir, (name) => onEvent(name, false));
		// worktree/submodule：HEAD 在自己的 gitDir，refs 在公共目录
		if (roots.commonDir !== roots.gitDir) this.watchDir(repo, roots.gitDir, (name) => onEvent(name, false));

		const refsDir = join(roots.commonDir, "refs");
		repo.refsDir = refsDir;
		if (!existsSync(refsDir)) return;
		if (this.recursiveRefs) {
			this.watchDir(repo, refsDir, (name) => onEvent(name, true), true);
			return;
		}
		// Linux 无递归监听：逐层挂句柄，并在事件到达时补挂新出现的分支目录
		this.watchRefSubdirs(repo, refsDir);
	}

	private watchDir(repo: RepoWatch, directory: string, listener: (fileName: string | Buffer | null) => void, recursive = false): boolean {
		try {
			const adapter = this.deps.watchDirectory ?? watchGitRefsDirectory;
			repo.watchers.push(adapter(directory, (_eventType, fileName) => listener(fileName), recursive));
			return true;
		} catch (caught) {
			this.warn("git refs watch failed to attach", {
				directory,
				recursive,
				error: caught instanceof Error ? caught.message : String(caught),
			});
			return false;
		}
	}

	/** Linux 专用：把 refs/ 下每一层目录都挂上句柄（分支名带斜杠时会新建目录）。 */
	private watchRefSubdirs(repo: RepoWatch, root: string): void {
		const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
		while (queue.length > 0) {
			const current = queue.shift();
			if (!current) break;
			if (!repo.watchedDirs.has(current.dir)) {
				this.watchDir(repo, current.dir, () => this.scheduleFlush(repo));
				// 挂失败也记入集合：目录可能被并发删除，反复重试只会拖慢每次事件处理
				repo.watchedDirs.add(current.dir);
			}
			if (current.depth >= REFS_SCAN_MAX_DEPTH) continue;
			try {
				for (const entry of readdirSync(current.dir, { withFileTypes: true })) {
					if (entry.isDirectory()) queue.push({ dir: join(current.dir, entry.name), depth: current.depth + 1 });
				}
			} catch {
				// 目录刚被删除：忽略，下一轮事件或轮询会兜住
			}
		}
	}

	/** 固定窗口去抖：合并连续事件，但不因持续改写无限推迟通知。 */
	private scheduleFlush(repo: RepoWatch): void {
		if (repo.timer) return;
		repo.timer = setTimeout(() => {
			repo.timer = null;
			this.flush(repo);
		}, this.debounceMs);
		// 不把进程钉在事件循环上：主进程退出阶段不需要等这 200ms
		repo.timer.unref?.();
	}

	private flush(repo: RepoWatch): void {
		if (repo.subscribers.size === 0) return;
		// 窗口期内可能新出现 refs 子目录（如 feature/xxx 分支）：Linux 下先补挂句柄
		if (!this.recursiveRefs && repo.refsDir) this.watchRefSubdirs(repo, repo.refsDir);
		for (const watchId of repo.subscribers.keys()) {
			for (const listener of this.listeners) {
				try {
					listener(watchId);
				} catch (caught) {
					// 单个订阅者出错（典型：窗口已销毁）不能拖垮其余订阅者与后续事件
					this.warn("git refs listener failed", { watchId, error: caught instanceof Error ? caught.message : String(caught) });
				}
			}
		}
	}

	private closeRepo(repoPath: string, repo: RepoWatch): void {
		if (repo.timer) {
			clearTimeout(repo.timer);
			repo.timer = null;
		}
		for (const watcher of repo.watchers) {
			try {
				watcher.close();
			} catch {
				// 句柄可能已经失效：关闭失败不影响后续流程
			}
		}
		repo.watchers = [];
		repo.watchedDirs.clear();
		repo.subscribers.clear();
		if (this.repos.get(repoPath) === repo) this.repos.delete(repoPath);
	}

	private warn(message: string, detail: Record<string, unknown>): void {
		this.deps.logger?.warn("git", message, detail);
	}
}
