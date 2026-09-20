import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DshRunnerNodeInfo, DshRunnerNodeProbe, DshRunnerNodeSystemProbe } from "../../shared/types/dshRunnerNode";
import { DSH_RUNNER_NODE_ENV, dshRunnerNodeFileName, resolveDshRunnerNodeSidecar, resolveInstalledDshRunnerNodeSidecar } from "./dshRunnerNodeSidecar";

/**
 * Windows DSH 沙箱 runner 的 CUI node 探测（可单测）。
 *
 * 不随包 86MB 的 node.exe：复用本机 Node。GUI electron.exe 当 runner 会闪黑窗口；
 * 受限 token 下也不能 CREATE_NO_WINDOW。必须是真正的 CUI node.exe。
 *
 * koffi 预编译按 Node ABI 分发，DSH runtime 跟 CI 钉在 Node 24，主版本不对会加载失败。
 */

const execFileAsync = promisify(execFile);
const NODE_PROBE_TIMEOUT_MS = 5_000;

/** 与 CI setup-node / DSH runtime koffi ABI 对齐。 */
export const DSH_RUNNER_NODE_MAJOR = 24;

function listChildDirs(parent: string): string[] {
	try {
		return readdirSync(parent, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(parent, entry.name));
	} catch {
		return [];
	}
}

/**
 * 版本管理器 / 包管理器里的真实 node 二进制（不是 PATH 垫片）。
 * PATH 上的 `node` 经常是 22/25 的 current，但 nvm/fnm/mise 目录里仍可能装着 24。
 * 只扫磁盘、不改 PATH，其它项目继续用它们自己的版本。
 */
export function versionManagerNodeCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
	const fileName = dshRunnerNodeFileName(platform);
	const home = env.HOME || env.USERPROFILE || homedir();
	const localAppData = env.LOCALAPPDATA;
	const appData = env.APPDATA;
	const out: string[] = [];

	const push = (dir: string, ...segments: string[]) => {
		out.push(join(dir, ...segments, fileName));
	};

	// nvm-windows：%NVM_HOME%\v24.x.y\node.exe 或 %APPDATA%\nvm
	const nvmHome = env.NVM_HOME || (appData ? join(appData, "nvm") : "");
	if (nvmHome) {
		for (const dir of listChildDirs(nvmHome)) push(dir);
	}
	// 官方 nvm（Unix 布局，WSL/部分 Windows 移植也会用）
	for (const dir of listChildDirs(join(home, ".nvm", "versions", "node"))) {
		push(dir, "bin");
	}
	push(home, ".nvm", "current", "bin");

	// fnm：%LOCALAPPDATA%\fnm\node-versions\<ver>\installation\node.exe
	const fnmRoot = env.FNM_DIR || (localAppData ? join(localAppData, "fnm") : join(home, ".fnm"));
	for (const dir of listChildDirs(join(fnmRoot, "node-versions"))) {
		push(dir, "installation");
		push(dir, "installation", "bin");
	}

	// mise：%LOCALAPPDATA%\mise\installs\node\<ver>\node.exe
	const miseDataDir = env.MISE_DATA_DIR || (platform === "win32" && localAppData ? join(localAppData, "mise") : join(home, ".local", "share", "mise"));
	const miseInstalls = env.MISE_INSTALL_PATH || join(miseDataDir, "installs", "node");
	for (const dir of listChildDirs(miseInstalls)) {
		push(dir);
		push(dir, "bin");
	}

	if (platform === "win32") {
		// Scoop 可并存多个 nodejs* bucket；current 可能不是 24，所以连 version 目录一起扫。
		push(home, "scoop", "apps", "nodejs", "current");
		for (const dir of listChildDirs(join(home, "scoop", "apps", "nodejs"))) {
			if (dir.endsWith("current")) continue;
			push(dir);
		}
		push(home, "scoop", "apps", "nodejs-lts", "current");
		for (const dir of listChildDirs(join(home, "scoop", "apps", "nodejs-lts"))) {
			if (dir.endsWith("current")) continue;
			push(dir);
		}
		push(home, "scoop", "apps", "nodejs24", "current");
	}

	// volta 工具链：bin\node.exe 是垫片，真实版本在 tools\image\node\<ver>\
	const voltaHome = env.VOLTA_HOME || (platform === "win32" && localAppData ? join(localAppData, "Volta") : join(home, ".volta"));
	for (const dir of listChildDirs(join(voltaHome, "tools", "image", "node"))) {
		push(dir);
		push(dir, "bin");
	}

	return [...new Set(out)];
}

export function nodePathCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
	const fileName = dshRunnerNodeFileName(platform);
	const official: string[] = [];
	if (platform === "win32") {
		const programFiles = env.ProgramFiles ?? "C:\\Program Files";
		const localAppData = env.LOCALAPPDATA;
		official.push(`${programFiles}\\nodejs\\${fileName}`);
		if (localAppData) official.push(`${localAppData}\\Programs\\nodejs\\${fileName}`);
	} else if (platform === "darwin") {
		official.push("/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node");
	} else {
		official.push("/usr/bin/node", "/usr/local/bin/node");
	}
	return [...new Set([...official, ...versionManagerNodeCandidates(platform, env)])];
}

/** 从 `node -v` / `v24.13.0` 抽出语义化版本。 */
export function parseNodeVersion(raw: string): string {
	const match = /v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw);
	if (!match) return "";
	return `${match[1]}.${match[2]}.${match[3] ?? "0"}`;
}

export function nodeMajor(version: string): number | undefined {
	const match = /^(\d+)\./.exec(version);
	if (!match) return undefined;
	return Number(match[1]);
}

export function isDshRunnerNodeCompatible(version: string): boolean {
	return nodeMajor(version) === DSH_RUNNER_NODE_MAJOR;
}

/**
 * 路径里已经写明主版本（nvm 的 v22.12.0、mise 的 22.12.0）且不是 24 时跳过探测。
 * 避免本机装了十几个 Node 时每个都 spawn `node -v`。目录名不含版本的（如 current）仍探测。
 */
export function pathLooksLikeOtherNodeMajor(candidate: string): boolean {
	for (const match of candidate.matchAll(/[\\/]v?(\d+)\.\d+/g)) {
		if (Number(match[1]) !== DSH_RUNNER_NODE_MAJOR) return true;
	}
	return false;
}

export function resolveConfiguredNodePath(configuredPath?: string | null): string {
	return typeof configuredPath === "string" ? configuredPath.trim() : "";
}

async function resolvePathLocation(platform: NodeJS.Platform = process.platform): Promise<string> {
	try {
		const command = platform === "win32" ? "where" : "which";
		const { stdout } = await execFileAsync(command, ["node"], {
			timeout: NODE_PROBE_TIMEOUT_MS,
			windowsHide: true,
		});
		return (
			stdout
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find(Boolean) ?? ""
		);
	} catch {
		return "";
	}
}

async function probeExecutable(executable: string): Promise<DshRunnerNodeProbe | null> {
	try {
		const { stdout } = await execFileAsync(executable, ["-v"], {
			timeout: NODE_PROBE_TIMEOUT_MS,
			windowsHide: true,
		});
		const version = parseNodeVersion(stdout);
		if (!version) return null;
		const resolvedPath = executable === "node" ? (await resolvePathLocation()) || executable : executable;
		return { resolvedPath, version };
	} catch {
		return null;
	}
}

export type DetectSystemNodeInput = {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	/** 一键下载的专用副本（userData/dsh-runner-node/node.exe）。 */
	sidecarPath?: string;
};

/** 忽略用户配置：PATH → 专用 sidecar → 官方目录 / nvm/fnm/mise。 */
export async function detectSystemNode(platformOrInput: NodeJS.Platform | DetectSystemNodeInput = process.platform, envArg?: NodeJS.ProcessEnv): Promise<DshRunnerNodeSystemProbe | null> {
	const input: DetectSystemNodeInput = typeof platformOrInput === "string" ? { platform: platformOrInput, env: envArg } : platformOrInput;
	const platform = input.platform ?? process.platform;
	const env = input.env ?? process.env;

	const fromPath = await probeExecutable("node");
	if (fromPath && isDshRunnerNodeCompatible(fromPath.version)) {
		return { ...fromPath, source: "path" };
	}

	const sidecar = input.sidecarPath?.trim();
	if (sidecar && existsSync(sidecar)) {
		const probe = await probeExecutable(sidecar);
		if (probe && isDshRunnerNodeCompatible(probe.version)) {
			return { ...probe, source: "sidecar" };
		}
	}

	for (const candidate of nodePathCandidates(platform, env)) {
		if (!existsSync(candidate)) continue;
		if (pathLooksLikeOtherNodeMajor(candidate)) continue;
		const probe = await probeExecutable(candidate);
		if (probe && isDshRunnerNodeCompatible(probe.version)) {
			return { ...probe, source: "known-location" };
		}
	}

	// 找到了但不兼容：仍返回 PATH 命中，让 UI 提示版本不对，并引导指定 24 或一键下载。
	if (fromPath) return { ...fromPath, source: "path" };
	return null;
}

export type DetectDshRunnerNodeInput = {
	configuredPath?: string | null;
	envPath?: string | null;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	userDataPath?: string | null;
	resourcesPath?: string | null;
	appPath?: string | null;
};

function incompatibleError(version: string): string {
	return `需要 Node ${DSH_RUNNER_NODE_MAJOR}.x（当前 ${version}）。PATH 上的 node 可以保持现状；请指定本机 Node ${DSH_RUNNER_NODE_MAJOR} 的路径，或一键下载仅给 PiDeck 用的副本。`;
}

/**
 * 探测当前应给 DSH runner 用的 node：env 覆盖 > 用户配置 > 系统自动探测。
 */
export async function detectDshRunnerNode(input: DetectDshRunnerNodeInput = {}): Promise<DshRunnerNodeInfo> {
	const platform = input.platform ?? process.platform;
	const env = input.env ?? process.env;
	const sidecarPath = resolveInstalledDshRunnerNodeSidecar({
		platform,
		userDataPath: input.userDataPath ?? undefined,
		resourcesPath: input.resourcesPath ?? undefined,
		appPath: input.appPath ?? undefined,
	});
	const system = await detectSystemNode({ platform, env, sidecarPath });
	const envPath = resolveConfiguredNodePath(input.envPath);
	if (envPath) {
		if (!existsSync(envPath)) {
			return notFound(`环境变量 ${DSH_RUNNER_NODE_ENV} 指向的文件不存在：${envPath}`, system, envPath);
		}
		const probe = await probeExecutable(envPath);
		if (!probe) return notFound(`无法执行 ${envPath}`, system, envPath);
		const compatible = isDshRunnerNodeCompatible(probe.version);
		return {
			source: "env",
			executable: envPath,
			resolvedPath: probe.resolvedPath,
			version: probe.version,
			error: compatible ? null : incompatibleError(probe.version),
			compatible,
			system,
		};
	}

	const configured = resolveConfiguredNodePath(input.configuredPath);
	if (configured) {
		if (!existsSync(configured)) {
			return notFound(`无法执行配置的 Node 路径：${configured}`, system, configured);
		}
		const probe = await probeExecutable(configured);
		if (!probe) return notFound(`无法执行配置的 Node 路径：${configured}`, system, configured);
		const compatible = isDshRunnerNodeCompatible(probe.version);
		return {
			source: "configured",
			executable: configured,
			resolvedPath: probe.resolvedPath,
			version: probe.version,
			error: compatible ? null : incompatibleError(probe.version),
			compatible,
			system,
		};
	}

	if (system) {
		const compatible = isDshRunnerNodeCompatible(system.version);
		return {
			source: system.source,
			executable: system.resolvedPath,
			resolvedPath: system.resolvedPath,
			version: system.version,
			error: compatible ? null : incompatibleError(system.version),
			compatible,
			system,
		};
	}

	return notFound(`未检测到 Node ${DSH_RUNNER_NODE_MAJOR}。可在开发设置里一键下载 PiDeck 专用副本（走应用更新源，不改系统 PATH），或手动指定本机 node.exe。`, null, "");
}

function notFound(error: string, system: DshRunnerNodeSystemProbe | null, executable: string): DshRunnerNodeInfo {
	return {
		source: "not-found",
		executable,
		resolvedPath: "",
		version: "",
		error,
		compatible: false,
		system,
	};
}

/** host fork 用：只返回可 spawn 的兼容绝对路径。 */
export async function resolveDshRunnerNodePath(input: DetectDshRunnerNodeInput = {}): Promise<string | undefined> {
	if ((input.platform ?? process.platform) !== "win32") return undefined;
	const info = await detectDshRunnerNode(input);
	if (info.compatible && info.resolvedPath) return info.resolvedPath;
	// 手动路径/PATH 钉在 22/25 时，仍用自动探测到的 24 或 userData 专用副本。
	if (info.system && isDshRunnerNodeCompatible(info.system.version) && info.system.resolvedPath) {
		return info.system.resolvedPath;
	}
	return resolveDshRunnerNodeSidecar({
		platform: input.platform ?? process.platform,
		envPath: input.envPath ?? undefined,
		userDataPath: input.userDataPath ?? undefined,
		resourcesPath: input.resourcesPath ?? undefined,
		appPath: input.appPath ?? undefined,
	});
}
