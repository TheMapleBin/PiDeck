import { net } from "electron";
import { compareVersions } from "../utils/versionCompare";
import { RELEASES_URL } from "./releaseRepo";

/** GitHub 的 `/releases/latest` 不走 REST API 配额，最终会重定向到具体 tag 页面。 */
export const MAC_MANUAL_LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;

export type ManualReleaseCheckResult = {
	latestVersion: string;
	hasUpdate: boolean;
};

export type LatestReleaseResponse = {
	ok: boolean;
	status: number;
	url: string;
	/** OpenAPI JSON 正文。GitHub HTML 重定向路径不需要 body。 */
	body?: string;
};

type LatestReleaseFetcher = (url: string) => Promise<LatestReleaseResponse>;

/**
 * 从 GitHub latest release 重定向 URL 提取发布版本。
 * URL 例：`https://github.com/ayuayue/PiDeck/releases/tag/v0.7.4`。
 * AtomGit 网页 `/releases/latest` 不会 302 到这种路径，返回 null。
 */
export function parseGitHubReleaseVersion(url: string): string | null {
	try {
		const pathname = new URL(url).pathname;
		const match = pathname.match(/\/releases\/tag\/v?([^/?#]+)$/i);
		return match?.[1] ? decodeURIComponent(match[1]) : null;
	} catch {
		return null;
	}
}

/**
 * AtomGit / GitHub REST 的 latest release JSON：版本写在 `tag_name`。
 * 例：`{"tag_name":"v0.7.6"}` → `"0.7.6"`。
 */
export function parseLatestReleaseTagFromJson(body: string): string | null {
	try {
		const payload: unknown = JSON.parse(body);
		if (typeof payload !== "object" || payload === null || !("tag_name" in payload)) {
			return null;
		}
		const tag = payload.tag_name;
		if (typeof tag !== "string") return null;
		const trimmed = tag.trim();
		if (!trimmed) return null;
		return trimmed.replace(/^v/i, "");
	} catch {
		return null;
	}
}

/** 优先从 GitHub 风格的最终 URL 取版本；取不到再读 JSON 的 tag_name（AtomGit OpenAPI）。 */
export function resolveLatestReleaseVersion(
	response: Pick<LatestReleaseResponse, "url" | "body">,
): string | null {
	return (
		parseGitHubReleaseVersion(response.url) ??
		(response.body ? parseLatestReleaseTagFromJson(response.body) : null)
	);
}

/**
 * 默认 fetcher 是否该读响应正文。
 * GitHub HTML 只要最终 URL；AtomGit OpenAPI 的版本号在 JSON 里。
 */
export function shouldReadJsonBody(url: string, contentType: string): boolean {
	if (/\bjson\b/i.test(contentType)) return true;
	try {
		const host = new URL(url).hostname.toLowerCase();
		return host === "api.atomgit.com" || host === "api.github.com";
	} catch {
		return false;
	}
}

/**
 * macOS 无签名分发的更新检测器。
 *
 * 不调用 electron-updater：该路径在没有 Developer ID 签名/公证时无法承诺可靠
 * 的下载、替换和重启体验。随后由 UI 打开 Release 页面交给用户手动安装。
 *
 * GitHub 源：跟随 `/releases/latest` 的 302，从最终 tag URL 取版本（不打 REST，避开配额）。
 * AtomGit 源：网页 `/releases/latest` 是 SPA 壳，地址不会变成 `/releases/tag/vX.Y.Z`，
 * 必须走 OpenAPI `.../releases/latest` 读 `tag_name`（与 CHANGELOG / 扩展热更新同一原因）。
 */
export function createMacManualUpdateChecker(options?: {
	fetchLatestRelease?: LatestReleaseFetcher;
}): (currentVersion: string, latestReleaseUrl?: string) => Promise<ManualReleaseCheckResult> {
	const fetchLatestRelease =
		options?.fetchLatestRelease ??
		(async (url: string): Promise<LatestReleaseResponse> => {
			const response = await net.fetch(url, { redirect: "follow" });
			const contentType = response.headers.get("content-type") ?? "";
			const body = shouldReadJsonBody(response.url || url, contentType)
				? await response.text()
				: undefined;
			return { ok: response.ok, status: response.status, url: response.url, body };
		});

	return async (
		currentVersion: string,
		latestReleaseUrl?: string,
	): Promise<ManualReleaseCheckResult> => {
		const response = await fetchLatestRelease(latestReleaseUrl ?? MAC_MANUAL_LATEST_RELEASE_URL);
		if (!response.ok) {
			throw new Error(`Latest release request failed (${response.status}).`);
		}
		const latestVersion = resolveLatestReleaseVersion(response);
		if (!latestVersion) {
			throw new Error("Latest release response did not resolve to a release tag.");
		}
		return {
			latestVersion,
			hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
		};
	};
}
