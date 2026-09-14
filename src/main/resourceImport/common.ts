import { createHash } from "node:crypto";
import { relative, resolve, sep } from "node:path";
import type { ResourceImportSourceKind, ResourceImportTarget } from "../../shared/types/resourceImport";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_SKILL_DEPTH = 32;
export const MAX_SKILL_CANDIDATES = 500;
export const MAX_SKILL_TREE_BYTES = 50 * 1024 * 1024;
export const SCAN_TTL_MS = 5 * 60 * 1000;
export const PROBE_CONCURRENCY = 4;
export const PROBE_TIMEOUT_MS = 3_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasErrorCode(value: unknown, code: string): boolean {
	return isRecord(value) && value.code === code;
}

export function fingerprint(raw: string | Uint8Array): string {
	return createHash("sha256").update(raw).digest("hex");
}

export function sourceLabel(source: ResourceImportSourceKind): string {
	return {
		"claude-global": "Claude Code · 用户级",
		"claude-project": "Claude Code · 当前项目",
		"codex-global": "Codex · 用户级",
		"codex-project": "Codex · 当前项目",
	}[source];
}

export function pathInside(root: string, target: string): boolean {
	const rel = relative(resolve(root), resolve(target));
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.includes(`..${sep}`));
}

export function targetKey(target: ResourceImportTarget): string {
	return target.scope === "global"
		? `global:${target.locationId}`
		: `project:${target.projectId}:${target.locationId}`;
}

export function redactPreviewUrl(value: string): string {
	try {
		const parsed = new URL(value);
		for (const key of [...parsed.searchParams.keys()]) {
			if (/(token|secret|password|passwd|api[-_]?key|authorization|auth)/i.test(key)) {
				parsed.searchParams.set(key, "***");
			}
		}
		return parsed.toString();
	} catch {
		return value;
	}
}

export function addUnique(values: string[], value: string): void {
	if (!values.includes(value)) values.push(value);
}

export function safeMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export class ResourceImportConflictError extends Error {
	readonly code = "RESOURCE_IMPORT_CONFLICT";
}

export function isConflictError(error: unknown): boolean {
	return error instanceof ResourceImportConflictError || (isRecord(error) && error.code === "RESOURCE_IMPORT_CONFLICT");
}
