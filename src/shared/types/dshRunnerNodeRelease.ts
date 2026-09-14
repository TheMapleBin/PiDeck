/**
 * Windows DSH 沙箱 Node 24 的按需分发契约。
 *
 * 与 DSH runtime 同一模式：不进安装包，打成 zip + 索引后挂到 GitHub/AtomGit
 * 的 `dsh-runner-node` tag，客户端按 settings.updateSource 按需下载。
 * sha256 必须写在索引里（下载前已知），zip 内不能自证哈希。
 */

import { atomGitReleasesBase, gitHubReleasesBase } from "../updateSources";
import type { UpdateSourceId } from "./settings";

export const DSH_RUNNER_NODE_RELEASE_SCHEMA = 1;
export const DSH_RUNNER_NODE_RELEASE_TAG = "dsh-runner-node";
export const DSH_RUNNER_NODE_INDEX_FILE = "dsh-runner-node-releases.json";

/** 与 koffi ABI / CI setup-node 对齐的官方 Node 主版本。 */
export const DSH_RUNNER_NODE_SIDECAR_VERSION = "24.13.0";

export type DshRunnerNodeArch = "x64" | "arm64";

export type DshRunnerNodeRelease = {
	version: string;
	arch: DshRunnerNodeArch;
	url: string;
	sha256: string;
	size: number;
};

export type DshRunnerNodeReleaseIndex = {
	schemaVersion: number;
	releases: DshRunnerNodeRelease[];
};

export function dshRunnerNodeZipName(version: string, arch: DshRunnerNodeArch): string {
	return `node-v${version}-win-${arch}.zip`;
}

export function dshRunnerNodeZipInnerDir(version: string, arch: DshRunnerNodeArch): string {
	return `node-v${version}-win-${arch}`;
}

export function dshRunnerNodeSidecarArch(arch: string = ""): DshRunnerNodeArch {
	return arch === "arm64" ? "arm64" : "x64";
}

/** 官方发行包 URL：只给打包脚本从 nodejs.org 拉源，客户端不走这条。 */
export function officialNodeZipUrl(version: string, arch: DshRunnerNodeArch): string {
	return `https://nodejs.org/dist/v${version}/${dshRunnerNodeZipName(version, arch)}`;
}

export function dshRunnerNodeAssetDownloadUrl(
	source: UpdateSourceId,
	fileName: string,
): string {
	const encoded = encodeURIComponent(fileName);
	if (source === "github") {
		return `${gitHubReleasesBase()}/releases/download/${DSH_RUNNER_NODE_RELEASE_TAG}/${encoded}`;
	}
	return `${atomGitReleasesBase()}/releases/download/${DSH_RUNNER_NODE_RELEASE_TAG}/${encoded}`;
}

export function defaultDshRunnerNodeIndexUrl(source: UpdateSourceId = "atomgit"): string {
	return dshRunnerNodeAssetDownloadUrl(source, DSH_RUNNER_NODE_INDEX_FILE);
}

export function selectDshRunnerNodeRelease(
	releases: readonly DshRunnerNodeRelease[],
	arch: DshRunnerNodeArch,
	version: string = DSH_RUNNER_NODE_SIDECAR_VERSION,
): DshRunnerNodeRelease | undefined {
	return releases.find(
		(release) =>
			release.arch === arch &&
			release.version === version &&
			typeof release.url === "string" &&
			typeof release.sha256 === "string" &&
			release.sha256.length === 64,
	);
}
