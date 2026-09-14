import type { McpProbeResult, McpServerDefinition, McpServerTransport } from "../../shared/types/mcp";
import type {
	ResourceImportCandidate,
	ResourceImportSourceStatus,
	StoredResourceImportCandidate,
} from "../../shared/types/resourceImport";
import { isRecord, addUnique, redactPreviewUrl, safeMessage, PROBE_CONCURRENCY, PROBE_TIMEOUT_MS } from "./common";
import {
	isMcpServerName,
	normalizeMcpServerDefinition,
	validateMcpConfigFile,
} from "../config/mcpConfig";
import { parseCodexToml } from "./toml";

const UNSUPPORTED_KEYS = new Set([
	"type",
	"command",
	"args",
	"env",
	"cwd",
	"url",
	"headers",
	"http_headers",
	"socket",
	"enabled",
	"disabled",
	"description",
	"startup_timeout_sec",
	"startup_timeout_ms",
]);

export type McpSourceParse = Record<string, unknown>;
export type McpSourceEntry = { name: string; value: unknown };

function stringRecord(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) return undefined;
	const result: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item === "string") result[key] = item;
	}
	return result;
}

/** Parse one Claude JSON or Codex TOML source without exposing parse details to the UI. */
export function parseMcpSource(
	raw: string,
	codex: boolean,
	sourceStatus: ResourceImportSourceStatus,
): McpSourceParse | null {
	if (codex) {
		const parsedToml = parseCodexToml(raw);
		if (parsedToml.error) {
			sourceStatus.error = "Codex TOML could not be parsed.";
			return null;
		}
		return parsedToml.value;
	}
	try {
		const value: unknown = JSON.parse(raw);
		if (!isRecord(value)) {
			sourceStatus.error = "Source JSON must be an object.";
			return null;
		}
		return value;
	} catch {
		sourceStatus.error = "Source JSON could not be parsed.";
		return null;
	}
}

/** Extract a server map from the two vendors' different top-level spellings. */
export function extractMcpServers(parsed: McpSourceParse, codex: boolean): McpSourceEntry[] {
	const value = parsed[codex ? "mcp_servers" : "mcpServers"];
	if (isRecord(value)) return Object.entries(value).map(([name, item]) => ({ name, value: item }));
	if (!codex) {
		// A few Claude exports are a bare map rather than { mcpServers: ... }.
		const entries = Object.entries(parsed);
		const transportKeys = ["command", "url", "socket", "type", "args", "env", "headers"];
		if (entries.length > 0 && entries.every(([, item]) => {
			if (!isRecord(item)) return false;
			return transportKeys.some((key) => key in item);
		})) {
			return entries.map(([name, item]) => ({ name, value: item }));
		}
	}
	return [];
}

/** Convert a vendor definition to the PiDeck MCP schema. */
export function convertMcpDefinition(
	raw: Record<string, unknown>,
	codex: boolean,
	warnings: string[],
	blockers: string[],
): McpServerDefinition | null {
	const type = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : undefined;
	if (type && type !== "http" && type !== "stdio" && type !== "socket") {
		blockers.push(`Unsupported transport: ${type}`);
		return null;
	}

	const command = typeof raw.command === "string" && raw.command.trim() ? raw.command : undefined;
	const url = typeof raw.url === "string" && raw.url.trim() ? raw.url : undefined;
	const socket = typeof raw.socket === "string" && raw.socket.trim() ? raw.socket : undefined;
	const transportCount = Number(Boolean(command)) + Number(Boolean(url)) + Number(Boolean(socket));
	if (transportCount !== 1) {
		blockers.push("Exactly one transport is required.");
		return null;
	}
	if ((type === "http" && !url) || (type === "stdio" && !command) || (type === "socket" && !socket)) {
		blockers.push("Transport type does not match the configured fields.");
		return null;
	}

	const definition: McpServerDefinition = {};
	if (command) {
		definition.command = command;
		if (Array.isArray(raw.args)) definition.args = raw.args.filter((item): item is string => typeof item === "string");
		if (isRecord(raw.env)) {
			definition.env = stringRecord(raw.env);
			if (Object.values(raw.env).some((value) => typeof value !== "string")) addUnique(warnings, "Some environment values were not strings and were omitted.");
			if (Object.values(raw.env).some((value) => typeof value === "string" && looksUnresolved(value))) addUnique(warnings, "Environment variables may be missing at runtime.");
		}
		if (typeof raw.cwd === "string" && raw.cwd.trim()) definition.cwd = raw.cwd;
	}
	if (url) {
		definition.url = url;
		const headerValue = raw.headers ?? raw.http_headers;
		if (isRecord(headerValue)) {
			definition.headers = stringRecord(headerValue);
			if (Object.values(headerValue).some((value) => typeof value !== "string")) addUnique(warnings, "Some header values were not strings and were omitted.");
			if (Object.values(headerValue).some((value) => typeof value === "string" && looksUnresolved(value))) addUnique(warnings, "HTTP headers may be missing at runtime.");
		}
		if (isRecord(raw.headers) && isRecord(raw.http_headers)) addUnique(warnings, "Both headers fields were present; the standard headers field was used.");
	}
	if (socket) definition.socket = socket;
	if (codex && raw.enabled === false) definition.disabled = true;
	if (!codex && typeof raw.disabled === "boolean") definition.disabled = raw.disabled;

	for (const key of Object.keys(raw)) {
		if (!UNSUPPORTED_KEYS.has(key)) addUnique(warnings, `Field not preserved: ${key.replace(/[\r\n]/g, " ").slice(0, 80)}`);
	}
	for (const key of ["startup_timeout_sec", "startup_timeout_ms", "description"]) {
		if (key in raw) addUnique(warnings, `Field not preserved: ${key}`);
	}
	if ("token" in raw || "api_key" in raw || "apiKey" in raw || "bearer_token" in raw || "oauth" in raw) {
		addUnique(warnings, "Authentication values require manual verification.");
	}

	const validationError = validateMcpConfigFile({
		mcpServers: { candidate: normalizeMcpServerDefinition(definition) ?? definition },
	});
	if (validationError) {
		blockers.push("Converted MCP definition is invalid.");
		return null;
	}
	return definition;
}

function looksUnresolved(value: string): boolean {
	return value.trim().length === 0 || /^\$\{[^}]+\}$/.test(value.trim()) || /^\$[A-Z_][A-Z0-9_]*$/i.test(value.trim());
}

export function mcpTransportOf(definition: McpServerDefinition | null): McpServerTransport | undefined {
	if (!definition) return undefined;
	if (definition.command) return "stdio";
	if (definition.url) return "http";
	if (definition.socket) return "socket";
	return undefined;
}

type ProbeProvider = {
	probeMcpServer?: (definition: McpServerDefinition) => Promise<McpProbeResult>;
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error("probe-timeout")), timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/** Probe valid definitions with a small concurrency cap; never returns vendor secrets. */
export async function probeMcpCandidates(provider: ProbeProvider, candidates: StoredResourceImportCandidate[]): Promise<void> {
	const probeMcpServer = provider.probeMcpServer;
	if (typeof probeMcpServer !== "function") return;
	const pending = candidates.filter((candidate) => candidate.importable && candidate.mcpDefinition);
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < pending.length) {
			const candidate = pending[next++];
			if (!candidate.mcpDefinition) continue;
			try {
				const result = await withTimeout(probeMcpServer.call(provider, candidate.mcpDefinition), PROBE_TIMEOUT_MS);
				if (!result.ok) {
					addUnique(candidate.warnings, result.transport === "stdio"
						? "Command was not found on PATH."
						: result.transport === "http"
							? "URL could not be reached during the compatibility check."
							: "MCP endpoint could not be reached during the compatibility check.");
				}
			} catch {
				addUnique(candidate.warnings, "Compatibility check timed out or failed.");
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, pending.length) }, () => worker()));
}

export function publicMcpCandidate(candidate: StoredResourceImportCandidate): ResourceImportCandidate {
	const {
		sourcePath: _sourcePath,
		sourceFingerprint: _sourceFingerprint,
		mcpDefinition: _mcpDefinition,
		...publicCandidate
	} = candidate;
	return {
		...publicCandidate,
		preview: candidate.preview?.url
			? { ...candidate.preview, url: redactPreviewUrl(candidate.preview.url) }
			: candidate.preview,
	};
}

export function mcpErrorMessage(error: unknown): string {
	return safeMessage(error, "MCP compatibility check failed.");
}
