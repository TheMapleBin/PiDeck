import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import type { ConfigManager } from "../config/ConfigManager";
import type { ProjectResourceManager } from "../projects/ProjectResourceManager";
import type { SkillManager } from "../skills/SkillManager";
import { homeFromPiAgentDir, isMcpServerName, parseMcpConfigFile, validateMcpConfigFile } from "../config/mcpConfig";
import type { McpConfigFile } from "../../shared/types/mcp";
import type {
	ResourceImportApplyInput,
	ResourceImportCandidate,
	ResourceImportScanInput,
	ResourceImportScanResult,
	ResourceImportSourceKind,
	ResourceImportSourceStatus,
	ResourceImportTarget,
	ResourceImportReport,
	StoredResourceImportCandidate,
} from "../../shared/types/resourceImport";
import {
	addUnique,
	fingerprint,
	hasErrorCode,
	isConflictError,
	isRecord,
	pathInside,
	ResourceImportConflictError,
	SCAN_TTL_MS,
	safeMessage,
	sourceLabel,
	targetKey,
} from "./common";
import {
	convertMcpDefinition,
	extractMcpServers,
	mcpTransportOf,
	parseMcpSource,
	probeMcpCandidates,
} from "./mcpImport";
import {
	buildSkillCandidate,
	copySkillDirectoryAtomic,
	findSkillDirs,
	normalizeSkillName,
	parseSkillFrontmatter,
	publicSkillCandidate,
	skillTreeFingerprint,
	sourceDirectoryIsSafe,
} from "./skillImport";

type ProjectLike = { id: string; path: string; kind?: "chat"; environment?: "windows" | "wsl" };
type SourcePath = { source: ResourceImportSourceKind; path: string };
type ScanCandidates = {
	sources: ResourceImportSourceStatus[];
	stored: StoredResourceImportCandidate[];
	publicCandidates: ResourceImportCandidate[];
};

// Keep the helpers available to the existing focused tests and to other main-process callers.
export { normalizeSkillName, parseSkillFrontmatter } from "./skillImport";

/**
 * Coordinates external-resource scans and applies opaque, short-lived selections.
 * Conversion and filesystem traversal live in separate helpers so this class remains an
 * IPC/domain orchestration boundary rather than a second resource implementation.
 */
export class ResourceImportManager {
	private readonly scans = new Map<
		string,
		{
			expiresAt: number;
			input: ResourceImportScanInput;
			candidates: StoredResourceImportCandidate[];
			result: ResourceImportScanResult;
		}
	>();

	constructor(
		private readonly configManager: ConfigManager,
		private readonly skillManager: SkillManager,
		private readonly projectResourceManager: ProjectResourceManager,
		private readonly getProject: (id: string) => ProjectLike | undefined,
		private readonly isTrusted: (projectId: string, root: string) => Promise<boolean>,
		private readonly onReport?: (report: Pick<ResourceImportReport, "kind" | "imported" | "skipped" | "failed">) => void,
	) {}

	async scan(input: ResourceImportScanInput): Promise<ResourceImportScanResult> {
		this.validateInput(input);
		this.pruneExpiredScans();
		if (input.target.scope === "project") await this.assertProjectTarget(input.target);
		const candidates = input.kind === "mcp" ? await this.scanMcp(input) : await this.scanSkills(input);
		const result: ResourceImportScanResult = {
			scanId: randomUUID(),
			kind: input.kind,
			target: input.target,
			sources: candidates.sources,
			candidates: candidates.publicCandidates,
		};
		this.scans.set(result.scanId, {
			expiresAt: Date.now() + SCAN_TTL_MS,
			input,
			candidates: candidates.stored,
			result,
		});
		return result;
	}

	async apply(input: ResourceImportApplyInput): Promise<ResourceImportReport> {
		this.validateApplyInput(input);
		const scan = this.scans.get(input.scanId);
		if (!scan || scan.expiresAt < Date.now()) {
			this.scans.delete(input.scanId);
			throw new Error("Import scan expired. Please scan again.");
		}
		this.validateTarget(input.target, scan.input.kind);
		if (targetKey(scan.input.target) !== targetKey(input.target)) throw new Error("Import target changed. Please scan again.");

		const byId = new Map(scan.candidates.map((candidate) => [candidate.candidateId, candidate]));
		const selected: StoredResourceImportCandidate[] = [];
		for (const candidateId of input.candidateIds) {
			const candidate = byId.get(candidateId);
			if (!candidate || selected.some((item) => item.candidateId === candidateId)) throw new Error("Invalid import candidate.");
			selected.push(candidate);
		}
		for (const candidate of selected) await this.assertCandidateFresh(candidate, scan.input.kind);

		const results: ResourceImportReport["results"] = [];
		try {
			for (const candidate of selected) {
				if (!candidate.importable || candidate.conflict) {
					results.push({
						candidateId: candidate.candidateId,
						name: candidate.name,
						status: "skipped",
						reason: candidate.conflict ? "Target already contains this resource." : candidate.blockers.join("; ") || "Resource cannot be imported.",
					});
					continue;
				}
				try {
					if (scan.input.kind === "mcp") await this.applyMcp(candidate, input.target);
					else await this.applySkill(candidate, input.target);
					results.push({ candidateId: candidate.candidateId, name: candidate.name, status: "imported", warnings: candidate.warnings });
				} catch (error) {
					results.push({
						candidateId: candidate.candidateId,
						name: candidate.name,
						status: isConflictError(error) ? "skipped" : "failed",
						reason: safeMessage(error, "Resource import failed."),
					});
				}
			}
		} finally {
			this.scans.delete(input.scanId);
		}

		const report: ResourceImportReport = {
			scanId: input.scanId,
			kind: scan.input.kind,
			results,
			imported: results.filter((item) => item.status === "imported").length,
			skipped: results.filter((item) => item.status === "skipped").length,
			failed: results.filter((item) => item.status === "failed").length,
		};
		try {
			this.onReport?.(report);
		} catch {
			// Audit logging must never turn a completed import into an IPC failure.
		}
		return report;
	}

	private pruneExpiredScans(): void {
		const now = Date.now();
		for (const [scanId, scan] of this.scans) if (scan.expiresAt < now) this.scans.delete(scanId);
	}

	private validateApplyInput(input: ResourceImportApplyInput): void {
		if (!isRecord(input) || Object.keys(input).some((key) => !["scanId", "target", "candidateIds"].includes(key)) || typeof input.scanId !== "string" || input.scanId.length < 8 || input.scanId.length > 128) throw new Error("Invalid resource import input.");
		if (!Array.isArray(input.candidateIds) || input.candidateIds.length > 1000 || !input.candidateIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128)) throw new Error("Invalid resource import candidate ids.");
		if (!isRecord(input.target)) throw new Error("Invalid resource import target.");
	}

	private validateInput(input: ResourceImportScanInput): void {
		if (!isRecord(input) || Object.keys(input).some((key) => !["kind", "sourceProjectId", "target"].includes(key)) || (input.kind !== "mcp" && input.kind !== "skill") || !input.target) throw new Error("Invalid resource import input.");
		this.validateTarget(input.target, input.kind);
		if (input.sourceProjectId !== undefined) {
			if (typeof input.sourceProjectId !== "string" || !input.sourceProjectId.trim() || input.sourceProjectId.length > 256) throw new Error("Invalid source project id.");
			if (!this.getProject(input.sourceProjectId)) throw new Error("Source project is not registered.");
		}
	}

	private validateTarget(target: ResourceImportTarget, kind: "mcp" | "skill"): void {
		if (!isRecord(target) || (target.scope !== "global" && target.scope !== "project")) throw new Error("Invalid resource import target.");
		const allowed = target.scope === "global" ? ["scope", "locationId"] : ["scope", "projectId", "locationId"];
		if (Object.keys(target).some((key) => !allowed.includes(key))) throw new Error("Invalid resource import target.");
		if (kind === "mcp") {
			if (target.scope === "global" && target.locationId !== "pi-global") throw new Error("Invalid MCP target.");
			if (target.scope === "project" && target.locationId !== "project-pi") throw new Error("Invalid MCP target.");
		} else {
			if (target.scope === "global" && target.locationId !== "pi-global" && target.locationId !== "agents-global") throw new Error("Invalid skill target.");
			if (target.scope === "project" && target.locationId !== "project-pi" && target.locationId !== "project-agents") throw new Error("Invalid skill target.");
		}
		if (target.scope === "project" && (typeof target.projectId !== "string" || !target.projectId.trim() || target.projectId.length > 256)) throw new Error("Invalid project id.");
	}

	private async assertProjectTarget(target: Extract<ResourceImportTarget, { scope: "project" }>): Promise<string> {
		const project = this.getProject(target.projectId);
		if (!project || project.kind === "chat") throw new Error("Project is not available for resource import.");
		const root = await this.projectResourceManager.resolveProjectRoot(target.projectId);
		if (!(await this.isTrusted(target.projectId, root))) throw new Error("Project is not trusted.");
		return root;
	}

	private async sourcePaths(input: ResourceImportScanInput): Promise<SourcePath[]> {
		const home = homeFromPiAgentDir(this.configManager.getConfigDir()) || homedir();
		const paths: SourcePath[] = input.kind === "mcp"
			? [
				{ source: "claude-global", path: join(home, ".claude.json") },
				{ source: "claude-global", path: join(home, ".claude", "mcp-configs", "mcp-servers.json") },
				{ source: "codex-global", path: join(home, ".codex", "config.toml") },
			]
			: [
				{ source: "claude-global", path: join(home, ".claude", "skills") },
				{ source: "codex-global", path: join(home, ".codex", "skills") },
			];
		if (!input.sourceProjectId) return paths;
		const project = this.getProject(input.sourceProjectId);
		if (!project || project.kind === "chat") return paths;
		const root = await this.projectResourceManager.resolveProjectRoot(input.sourceProjectId);
		paths.push(
			input.kind === "mcp" ? { source: "claude-project", path: join(root, ".mcp.json") } : { source: "claude-project", path: join(root, ".claude", "skills") },
			input.kind === "mcp" ? { source: "codex-project", path: join(root, ".codex", "config.toml") } : { source: "codex-project", path: join(root, ".agents", "skills") },
		);
		return paths;
	}

	private async readTextSource(path: string): Promise<{ raw?: string; exists: boolean; error?: string }> {
		try {
			return { raw: await readFile(path, "utf8"), exists: true };
		} catch (error) {
			if (hasErrorCode(error, "ENOENT")) return { exists: false };
			return { exists: true, error: "Source could not be read." };
		}
	}

	private async scanMcp(input: ResourceImportScanInput): Promise<ScanCandidates> {
		const sources: ResourceImportSourceStatus[] = [];
		const stored: StoredResourceImportCandidate[] = [];
		for (const item of await this.sourcePaths(input)) {
			const status: ResourceImportSourceStatus = { source: item.source, pathLabel: item.path, exists: false };
			sources.push(status);
			const sourceFile = await this.readTextSource(item.path);
			status.exists = sourceFile.exists;
			if (!sourceFile.exists || sourceFile.error || sourceFile.raw === undefined) {
				if (sourceFile.error) status.error = sourceFile.error;
				continue;
			}
			if (Buffer.byteLength(sourceFile.raw, "utf8") > 10 * 1024 * 1024) {
				status.error = "Source file is too large.";
				continue;
			}
			const parsed = parseMcpSource(sourceFile.raw, item.path.endsWith(".toml"), status);
			if (!parsed) continue;
			for (const entry of extractMcpServers(parsed, item.path.endsWith(".toml"))) {
				const sourceDef = isRecord(entry.value) ? entry.value : {};
				const warnings: string[] = [];
				const blockers: string[] = [];
				if (!isRecord(entry.value)) blockers.push("MCP server definition must be an object.");
				const definition = convertMcpDefinition(sourceDef, item.path.endsWith(".toml"), warnings, blockers);
				if (!isMcpServerName(entry.name)) blockers.push("MCP name is invalid for PiDeck.");
				stored.push({
					candidateId: randomUUID(),
					kind: "mcp",
					source: item.source,
					sourceLabel: sourceLabel(item.source),
					sourcePathLabel: item.path,
					name: entry.name,
					targetName: entry.name,
					description: typeof sourceDef.description === "string" ? sourceDef.description : "",
					importable: blockers.length === 0 && Boolean(definition),
					warnings,
					blockers,
					conflict: false,
					transport: mcpTransportOf(definition),
					preview: definition ? { command: definition.command, args: definition.args, url: definition.url } : undefined,
					sourcePath: item.path,
					sourceFingerprint: fingerprint(sourceFile.raw),
					mcpDefinition: definition ?? undefined,
				});
			}
		}
		await probeMcpCandidates(this.configManager, stored);
		const existing = await this.existingMcpNames(input.target);
		this.markConflicts(stored, existing);
		return this.publicCandidates(sources, stored);
	}

	private async scanSkills(input: ResourceImportScanInput): Promise<ScanCandidates> {
		const sources: ResourceImportSourceStatus[] = [];
		const stored: StoredResourceImportCandidate[] = [];
		for (const item of await this.sourcePaths(input)) {
			const status: ResourceImportSourceStatus = { source: item.source, pathLabel: item.path, exists: false };
			sources.push(status);
			const root = await sourceDirectoryIsSafe(item.path);
			status.exists = root.exists;
			if (!root.safe) {
				status.error = root.error;
				continue;
			}
			if (!root.exists) continue;
			const discovery = await findSkillDirs(item.path);
			if (discovery.error) status.error = discovery.error;
			for (const dir of discovery.dirs) {
				if (stored.length >= 500) {
					status.error = "Too many skill candidates; remaining entries were omitted.";
					break;
				}
				stored.push(await buildSkillCandidate(item, dir));
			}
		}
		const existing = await this.existingSkillNames(input.target);
		this.markConflicts(stored, existing);
		return {
			sources,
			stored,
			publicCandidates: stored.map(publicSkillCandidate),
		};
	}

	private markConflicts(candidates: StoredResourceImportCandidate[], existing: Set<string>): void {
		const groups = new Map<string, StoredResourceImportCandidate[]>();
		for (const candidate of candidates) {
			const key = candidate.targetName.toLowerCase();
			candidate.conflict = Boolean(key) && existing.has(key);
			if (!key || candidate.conflict) continue;
			const group = groups.get(key) ?? [];
			group.push(candidate);
			groups.set(key, group);
		}
		for (const group of groups.values()) {
			const winner = group.find((candidate) => candidate.importable) ?? group[0];
			for (const candidate of group) {
				if (candidate === winner) continue;
				candidate.conflict = true;
				addUnique(candidate.warnings, "A duplicate name exists in this scan; only one candidate can be imported.");
			}
		}
	}

	private publicCandidates(sources: ResourceImportSourceStatus[], stored: StoredResourceImportCandidate[]): ScanCandidates {
		return {
			sources,
			stored,
			publicCandidates: stored.map((candidate) => {
				const { sourcePath: _sourcePath, sourceFingerprint: _sourceFingerprint, mcpDefinition: _mcpDefinition, ...publicCandidate } = candidate;
				return publicCandidate;
			}),
		};
	}

	private async existingMcpNames(target: ResourceImportTarget): Promise<Set<string>> {
		if (target.scope === "global") {
			const snapshot = await this.configManager.getMcpConfig();
			if (snapshot.writableError) throw new Error("PiDeck MCP configuration is invalid; repair it before importing.");
			return new Set((snapshot.servers ?? []).map((item) => item.name.toLowerCase()));
		}
		const file = await this.readProjectMcpConfig(target.projectId);
		return new Set(Object.keys(file.mcpServers ?? {}).map((name) => name.toLowerCase()));
	}

	private async readProjectMcpConfig(projectId: string): Promise<McpConfigFile> {
		const reader = this.projectResourceManager.readProjectMcpConfig;
		if (typeof reader === "function") return reader.call(this.projectResourceManager, projectId);
		const root = await this.projectResourceManager.resolveProjectRoot(projectId);
		const path = join(root, ".pi", "mcp.json");
		if (!pathInside(root, path)) throw new Error("Project path is outside boundary.");
		const raw = await readFile(path, "utf8").catch((error: unknown) => {
			if (hasErrorCode(error, "ENOENT")) return "{}";
			throw error;
		});
		const parsed = parseMcpConfigFile(raw);
		if (parsed.error) throw new Error(parsed.error);
		return parsed.file;
	}

	private async applyMcp(candidate: StoredResourceImportCandidate, target: ResourceImportTarget): Promise<void> {
		if (!candidate.mcpDefinition) throw new Error("MCP definition unavailable.");
		if (target.scope === "global") {
			const snapshot = await this.configManager.getMcpConfig();
			if (snapshot.writableError) throw new Error("PiDeck MCP configuration is invalid; repair it before importing.");
			if ((snapshot.servers ?? []).some((item) => item.name.toLowerCase() === candidate.targetName.toLowerCase())) throw new ResourceImportConflictError("Target already contains this MCP server.");
			const writableFile = snapshot.writableFile ?? { mcpServers: {} };
			const file: McpConfigFile = {
				...writableFile,
				mcpServers: { ...(writableFile.mcpServers ?? {}), [candidate.targetName]: candidate.mcpDefinition },
			};
			const validationError = validateMcpConfigFile(file);
			if (validationError) throw new Error(validationError);
			const saved = await this.configManager.saveMcpConfig(file);
			if (!saved.valid) throw new Error(saved.error ?? "MCP config could not be saved.");
			return;
		}
		await this.assertProjectTarget(target);
		const file = await this.readProjectMcpConfig(target.projectId);
		if (Object.keys(file.mcpServers ?? {}).some((name) => name.toLowerCase() === candidate.targetName.toLowerCase())) throw new ResourceImportConflictError("Target already contains this MCP server.");
		file.mcpServers = { ...(file.mcpServers ?? {}), [candidate.targetName]: candidate.mcpDefinition };
		const validationError = validateMcpConfigFile(file);
		if (validationError) throw new Error(validationError);
		const writer = this.projectResourceManager.saveProjectMcpConfig;
		if (typeof writer === "function") {
			await writer.call(this.projectResourceManager, target.projectId, file);
			return;
		}
		const root = await this.assertProjectTarget(target);
		const path = join(root, ".pi", "mcp.json");
		if (!pathInside(root, path)) throw new Error("Project path is outside boundary.");
		await mkdir(dirname(path), { recursive: true });
		const temporaryPath = `${path}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
			await rename(temporaryPath, path);
		} finally {
			await rm(temporaryPath, { force: true }).catch(() => undefined);
		}
	}

	private async existingSkillNames(target: ResourceImportTarget): Promise<Set<string>> {
		const names = new Set<string>();
		if (target.scope === "global") {
			const listed = await this.skillManager.list();
			for (const skill of listed.skills ?? []) names.add(skill.name.toLowerCase());
			const location = this.skillManager.getLocations().find((item) => item.id === target.locationId);
			if (location) for (const entry of await readdir(location.path, { withFileTypes: true }).catch(() => [])) names.add(entry.name.toLowerCase());
			return names;
		}
		const listed = await this.projectResourceManager.list(target.projectId);
		for (const skill of listed.skills ?? []) names.add(skill.name.toLowerCase());
		const resolver = this.projectResourceManager.resolveResourceDirectory;
		const directory = typeof resolver === "function"
			? await resolver.call(this.projectResourceManager, target.projectId, target.locationId)
			: join(await this.assertProjectTarget(target), target.locationId === "project-pi" ? ".pi/skills" : ".agents/skills");
		for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) names.add(entry.name.toLowerCase());
		return names;
	}

	private async assertCandidateFresh(candidate: StoredResourceImportCandidate, kind: "mcp" | "skill"): Promise<void> {
		if (kind === "mcp") {
			const source = await readFile(candidate.sourcePath, "utf8").catch(() => null);
			if (source === null || fingerprint(source) !== candidate.sourceFingerprint) throw new Error("Source changed. Please scan again.");
			return;
		}
		try {
			if (await skillTreeFingerprint(candidate.sourcePath) !== candidate.sourceFingerprint) throw new Error("Source changed. Please scan again.");
		} catch {
			throw new Error("Source changed or is no longer safe. Please scan again.");
		}
	}

	private async applySkill(candidate: StoredResourceImportCandidate, target: ResourceImportTarget): Promise<void> {
		const existing = await this.existingSkillNames(target);
		if (existing.has(candidate.targetName.toLowerCase())) throw new ResourceImportConflictError("Target already contains this skill.");
		if (target.scope === "global") {
			const importer = this.skillManager.importSkillDirectory;
			if (typeof importer === "function") {
				await importer.call(this.skillManager, target.locationId, candidate.sourcePath, candidate.targetName);
				return;
			}
			const location = this.skillManager.getLocations().find((item) => item.id === target.locationId);
			if (!location) throw new Error("Skill target is unavailable.");
			await copySkillDirectoryAtomic(location.path, candidate.sourcePath, candidate.targetName);
			return;
		}
		await this.assertProjectTarget(target);
		const importer = this.projectResourceManager.importSkillDirectory;
		if (typeof importer === "function") {
			await importer.call(this.projectResourceManager, target.projectId, target.locationId, candidate.sourcePath, candidate.targetName);
			return;
		}
		const root = await this.assertProjectTarget(target);
		await copySkillDirectoryAtomic(join(root, target.locationId === "project-pi" ? ".pi/skills" : ".agents/skills"), candidate.sourcePath, candidate.targetName);
	}
}
