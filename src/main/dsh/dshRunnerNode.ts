import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type {
	DshRunnerNodeInfo,
	DshRunnerNodeProbe,
	DshRunnerNodeSystemProbe,
} from "../../shared/types/dshRunnerNode";
import { DSH_RUNNER_NODE_ENV, dshRunnerNodeFileName, resolveDshRunnerNodeSidecar } from "./dshRunnerNodeSidecar";

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

export function nodePathCandidates(
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	const fileName = dshRunnerNodeFileName(platform);
	if (platform === "win32") {
		const programFiles = env.ProgramFiles ?? "C:\\Program Files";
		const localAppData = env.LOCALAPPDATA;
		return [
			`${programFiles}\\nodejs\\${fileName}`,
			...(localAppData ? [`${localAppData}\\Programs\\nodejs\\${fileName}`] : []),
		];
	}
	if (platform === "darwin") {
		return ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"];
	}
	return ["/usr/bin/node", "/usr/local/bin/node"];
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

export function resolveConfiguredNodePath(configuredPath?: string | null): string {
	return typeof configuredPath === "string" ? configuredPath.trim() : "";
}

async function resolvePathLocation(
	platform: NodeJS.Platform = process.platform,
): Promise<string> {
	try {
		const command = platform === "win32" ? "where" : "which";
		const { stdout } = await execFileAsync(command, ["node"], {
			timeout: NODE_PROBE_TIMEOUT_MS,
			windowsHide: true,
		});
		return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
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
		const resolvedPath =
			executable === "node" ? (await resolvePathLocation()) || executable : executable;
		return { resolvedPath, version };
	} catch {
		return null;
	}
}

/** 忽略用户配置：PATH，再各平台常见安装位置。 */
export async function detectSystemNode(
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): Promise<DshRunnerNodeSystemProbe | null> {
	const fromPath = await probeExecutable("node");
	if (fromPath && isDshRunnerNodeCompatible(fromPath.version)) {
		return { ...fromPath, source: "path" };
	}
	for (const candidate of nodePathCandidates(platform, env)) {
		if (!existsSync(candidate)) continue;
		const probe = await probeExecutable(candidate);
		if (probe && isDshRunnerNodeCompatible(probe.version)) {
			return { ...probe, source: "known-location" };
		}
	}
	// 找到了但不兼容：仍返回 PATH 命中，让 UI 提示版本不对。
	if (fromPath) return { ...fromPath, source: "path" };
	return null;
}

export type DetectDshRunnerNodeInput = {
	configuredPath?: string | null;
	envPath?: string | null;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
};

function incompatibleError(version: string): string {
	return `需要 Node ${DSH_RUNNER_NODE_MAJOR}.x（当前 ${version}）。DSH 沙箱 native 模块按 Node ${DSH_RUNNER_NODE_MAJOR} ABI 编译，请安装对应版本后在设置里指定路径。`;
}

/**
 * 探测当前应给 DSH runner 用的 node：env 覆盖 > 用户配置 > 系统自动探测。
 */
export async function detectDshRunnerNode(
	input: DetectDshRunnerNodeInput = {},
): Promise<DshRunnerNodeInfo> {
	const platform = input.platform ?? process.platform;
	const env = input.env ?? process.env;
	const system = await detectSystemNode(platform, env);
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

	return notFound(
		`未检测到 Node ${DSH_RUNNER_NODE_MAJOR}。请安装 https://nodejs.org/ 后在开发设置里指定 node 路径。`,
		null,
		"",
	);
}

function notFound(
	error: string,
	system: DshRunnerNodeSystemProbe | null,
	executable: string,
): DshRunnerNodeInfo {
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
export async function resolveDshRunnerNodePath(
	input: DetectDshRunnerNodeInput = {},
): Promise<string | undefined> {
	if ((input.platform ?? process.platform) !== "win32") return undefined;
	const info = await detectDshRunnerNode(input);
	if (!info.compatible || !info.resolvedPath) {
		return resolveDshRunnerNodeSidecar({
			platform: input.platform ?? process.platform,
			envPath: input.envPath ?? undefined,
			configuredPath: input.configuredPath ?? undefined,
		});
	}
	return info.resolvedPath;
}
