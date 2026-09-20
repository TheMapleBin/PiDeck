/**
 * GitRefsWatcher 单元测试。
 *
 * 为什么注入假监听而不是用真实 fs.watch：真实事件时序依赖平台实现
 * （inotify / FSEvents / ReadDirectoryChangesW），去抖窗口又会引入 flaky。
 * 这里替换掉 watchDirectory 适配器、由测试直接触发事件，覆盖真正容易写错的逻辑：
 * 哪些事件算 refs 变化、去抖合并、订阅计数与句柄回收；真实 fs 只用于
 * resolveGitDir 的目录结构（临时目录）。
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { GitRefsWatcher, resolveGitDir } = loadTsCommonJs("src/main/git/GitRefsWatcher.ts");

const temps = [];
function makeTempDir() {
	const dir = mkdtempSync(join(tmpdir(), "pideck-refs-"));
	temps.push(dir);
	return dir;
}
test.after(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** 普通仓库：<root>/.git/{HEAD,packed-refs,index,refs/**} */
function createPlainRepo() {
	const root = makeTempDir();
	const gitDir = join(root, ".git");
	mkdirSync(join(gitDir, "refs", "heads"), { recursive: true });
	mkdirSync(join(gitDir, "refs", "remotes", "origin"), { recursive: true });
	writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n");
	writeFileSync(join(gitDir, "packed-refs"), "# pack-refs with: peeled fully-peeled\n");
	writeFileSync(join(gitDir, "refs", "heads", "main"), "0".repeat(40) + "\n");
	return { root, gitDir };
}

/** 可编程的监听适配器：记录被监听的目录，并允许测试直接投递事件 */
function createWatchProbe() {
	const targets = [];
	return {
		watchDirectory(directory, listener, recursive = false) {
			const target = { directory, listener, recursive, closed: false };
			targets.push(target);
			return {
				close: () => {
					target.closed = true;
				},
			};
		},
		/** 模拟某个被监听目录里发生一次事件（fileName 为事件里的文件名/相对路径） */
		trigger(directory, fileName) {
			for (const target of targets) {
				if (target.directory === directory && !target.closed) target.listener("change", fileName);
			}
		},
		liveDirs() {
			return targets.filter((target) => !target.closed).map((target) => target.directory);
		},
		recursiveDirs() {
			return targets.filter((target) => !target.closed && target.recursive).map((target) => target.directory);
		},
		allClosed() {
			return targets.every((target) => target.closed);
		},
	};
}

async function settle(ms = 30) {
	await new Promise((done) => setTimeout(done, ms));
}

test("resolveGitDir 解析普通仓库与 worktree 的 .git 文件 + commondir", () => {
	const { root, gitDir } = createPlainRepo();
	const plain = resolveGitDir(root);
	assert.equal(plain.gitDir, gitDir);
	assert.equal(plain.commonDir, gitDir, "普通仓库的公共目录就是 gitDir 本身");

	// worktree：.git 是文件，真实 refs 在 commondir 指向的主仓库目录里
	const superRoot = makeTempDir();
	const worktreeGitDir = join(superRoot, ".git", "worktrees", "wt");
	mkdirSync(worktreeGitDir, { recursive: true });
	writeFileSync(join(worktreeGitDir, "commondir"), "../..\n");
	writeFileSync(join(worktreeGitDir, "HEAD"), "ref: refs/heads/wt\n");
	const worktreeRoot = makeTempDir();
	writeFileSync(join(worktreeRoot, ".git"), `gitdir: ${worktreeGitDir}\n`);
	const worktree = resolveGitDir(worktreeRoot);
	assert.equal(worktree.gitDir, worktreeGitDir);
	assert.equal(worktree.commonDir, join(superRoot, ".git"), "worktree 的 refs 必须指向主仓库公共目录");

	// .git 文件里写相对路径时按工作区目录解析（worktree 的 .git 文件可能写相对路径）
	const relativeRoot = makeTempDir();
	writeFileSync(join(relativeRoot, ".git"), "gitdir: ../pideck-relative-gitdir\n");
	assert.equal(resolveGitDir(relativeRoot).gitDir, resolve(relativeRoot, "../pideck-relative-gitdir"));

	// 非仓库（无 .git）：返回 null，调用方静默降级
	assert.equal(resolveGitDir(makeTempDir()), null);
});

test("按 (projectId, repoPath) 复用同一个 watchId，订阅计数归零才关闭句柄", async () => {
	const { root, gitDir } = createPlainRepo();
	const probe = createWatchProbe();
	const watcher = new GitRefsWatcher({ watchDirectory: probe.watchDirectory, debounceMs: 1, recursiveRefs: true });
	const seen = [];
	const stop = watcher.on((watchId) => seen.push(watchId));

	const first = watcher.acquire("p1", root);
	const second = watcher.acquire("p1", root);
	assert.equal(first, second, "同一 (projectId, repoPath) 必须复用 watchId");
	assert.equal(watcher.activeRepoCount, 1, "同一仓库只保留一份监听");

	probe.trigger(join(gitDir, "refs"), "heads/main");
	await settle();
	assert.deepEqual([...seen], [first], "refs 目录事件必须推送");

	// 还有一个订阅者：退订一次不能让句柄提前关闭
	watcher.release(first);
	seen.length = 0;
	probe.trigger(join(gitDir, "refs"), "heads/main");
	await settle();
	assert.deepEqual([...seen], [second], "计数未归零时必须继续推送");
	assert.equal(probe.allClosed(), false);

	// 最后一个订阅者退出：句柄关闭，后续事件不再推送
	watcher.release(second);
	assert.equal(watcher.activeRepoCount, 0);
	assert.equal(probe.allClosed(), true, "最后一个订阅者退出必须关闭 fs.watch 句柄");
	seen.length = 0;
	probe.trigger(join(gitDir, "refs"), "heads/main");
	await settle();
	assert.deepEqual([...seen], [], "句柄关闭后不再推送");
	stop();
});

test("只认 HEAD / packed-refs / refs 三类 gitDir 变更，忽略 index 等噪声", async () => {
	const { root, gitDir } = createPlainRepo();
	const probe = createWatchProbe();
	const watcher = new GitRefsWatcher({ watchDirectory: probe.watchDirectory, debounceMs: 1, recursiveRefs: true });
	const seen = [];
	const stop = watcher.on((watchId) => seen.push(watchId));
	const watchId = watcher.acquire("p1", root);

	// index：git status 自己会改写它，算作变化就会形成「刷新 → status → index 改写 → 再刷新」自激
	probe.trigger(gitDir, "index");
	// FETCH_HEAD：一次 fetch 的副产品，对变更列表与角标没有意义
	probe.trigger(gitDir, "FETCH_HEAD");
	probe.trigger(gitDir, "COMMIT_EDITMSG");
	await settle();
	assert.deepEqual([...seen], [], "无关文件的变化不该触发刷新");

	probe.trigger(gitDir, "HEAD");
	await settle();
	assert.deepEqual([...seen], [watchId], "切分支（HEAD）必须推送");

	seen.length = 0;
	probe.trigger(gitDir, "packed-refs");
	await settle();
	assert.deepEqual([...seen], [watchId], "git gc / pack-refs 重写引用必须推送");
	stop();
});

test("同一合并窗口内的连续事件只推送一次（push 会连改多个 ref 文件）", async () => {
	const { root, gitDir } = createPlainRepo();
	const probe = createWatchProbe();
	const watcher = new GitRefsWatcher({ watchDirectory: probe.watchDirectory, debounceMs: 25, recursiveRefs: true });
	const seen = [];
	const stop = watcher.on((watchId) => seen.push(watchId));
	watcher.acquire("p1", root);

	probe.trigger(gitDir, "HEAD");
	probe.trigger(join(gitDir, "refs"), "remotes/origin/main");
	probe.trigger(join(gitDir, "refs"), "heads/main");
	await settle(60);
	assert.equal(seen.length, 1, "窗口内的事件必须合并成一次刷新信号");
	stop();
});

test("单个订阅者抛错不影响其它订阅者（窗口销毁场景）", async () => {
	const { root, gitDir } = createPlainRepo();
	const probe = createWatchProbe();
	const warnings = [];
	const watcher = new GitRefsWatcher({
		watchDirectory: probe.watchDirectory,
		debounceMs: 1,
		recursiveRefs: true,
		logger: { warn: (scope, message, detail) => warnings.push({ scope, message, detail }) },
	});
	const stopThrowing = watcher.on(() => {
		throw new Error("Object has been destroyed");
	});
	const accepted = [];
	const stopAccepted = watcher.on((watchId) => accepted.push(watchId));
	const watchId = watcher.acquire("p1", root);

	probe.trigger(gitDir, "HEAD");
	await settle();
	assert.deepEqual([...accepted], [watchId], "一个订阅者抛错不能吞掉其它订阅者的通知");
	assert.equal(warnings.length, 1);
	assert.equal(warnings[0].scope, "git");
	assert.match(String(warnings[0].detail.error), /Object has been destroyed/);
	stopThrowing();
	stopAccepted();
});

test("不支持递归监听的平台（Linux）逐层挂 refs 子目录，并在事件后补挂新目录", async () => {
	const { root, gitDir } = createPlainRepo();
	const probe = createWatchProbe();
	const watcher = new GitRefsWatcher({ watchDirectory: probe.watchDirectory, debounceMs: 1, recursiveRefs: false });
	const refsDir = join(gitDir, "refs");
	watcher.acquire("p1", root);

	const dirs = probe.liveDirs();
	assert.ok(dirs.includes(gitDir), "gitDir 必须被监听（HEAD 在这里）");
	assert.ok(dirs.includes(refsDir), "refs 根目录必须被监听");
	assert.ok(dirs.includes(join(refsDir, "heads")), "逐层补挂必须覆盖 refs/heads");
	assert.ok(dirs.includes(join(refsDir, "remotes", "origin")), "逐层补挂必须覆盖 refs/remotes/origin");
	assert.equal(probe.recursiveDirs().length, 0, "非递归平台不得传 recursive 标志（会用不了）");

	// 新出现的分支目录（feature/xxx）在下一轮事件后补挂
	const nested = join(refsDir, "heads", "feature");
	mkdirSync(nested, { recursive: true });
	probe.trigger(refsDir, "heads");
	await settle(40);
	assert.ok(probe.liveDirs().includes(nested), "补挂必须覆盖新出现的 refs 子目录");
});

test("非 git 目录静默降级：不抛错、不挂句柄、退订与未知 id 都安全", () => {
	const bare = makeTempDir();
	const probe = createWatchProbe();
	const warnings = [];
	const watcher = new GitRefsWatcher({ watchDirectory: probe.watchDirectory, logger: { warn: (scope, message) => warnings.push({ scope, message }) } });

	const watchId = watcher.acquire("p1", bare);
	assert.equal(typeof watchId, "string");
	assert.equal(probe.liveDirs().length, 0, "非仓库不得挂监听句柄");
	assert.equal(warnings.length, 1, "降级只记 warn，不抛给调用方");
	assert.equal(warnings[0].scope, "git");

	watcher.release(watchId);
	watcher.release("unknown::watch-id");
	assert.equal(watcher.activeRepoCount, 0);
});

test("disposeAll 关闭全部句柄并清空订阅（退出清理路径）", async () => {
	const repoA = createPlainRepo();
	const repoB = createPlainRepo();
	const probe = createWatchProbe();
	const watcher = new GitRefsWatcher({ watchDirectory: probe.watchDirectory, debounceMs: 1, recursiveRefs: true });
	const seen = [];
	watcher.on((watchId) => seen.push(watchId));
	watcher.acquire("p1", repoA.root);
	watcher.acquire("p2", repoB.root);
	assert.equal(watcher.activeRepoCount, 2);

	watcher.disposeAll();
	assert.equal(watcher.activeRepoCount, 0);
	assert.equal(probe.allClosed(), true, "退出时必须关掉所有 fs.watch 句柄");
	probe.trigger(repoA.gitDir, "HEAD");
	await settle();
	assert.deepEqual([...seen], [], "disposeAll 后不再推送（订阅者集合已清空）");
});
