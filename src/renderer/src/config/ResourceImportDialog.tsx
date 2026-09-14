import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui-shadcn/dialog";
import { Button } from "../components/ui-shadcn/button";
import { Checkbox } from "../components/ui-shadcn/checkbox";
import { ConfigSelect } from "./ConfigShared";
import { t } from "../i18n";
import type { PiDesktopApi } from "../../../preload";
import type {
	ResourceImportCandidate,
	ResourceImportKind,
	ResourceImportReport,
	ResourceImportScanResult,
	ResourceImportSourceKind,
	ResourceImportTarget,
} from "../../../shared/types/resourceImport";

const api: PiDesktopApi = window.piDesktop;

type Project = { id: string; name: string; kind?: string };

function formatImportMessage(message: string): string {
	const unsupported = /^Unsupported transport:\s*(.+)$/.exec(message);
	if (unsupported) return t("config.import.blockerUnsupportedTransport", { transport: unsupported[1] });
	if (message === "Exactly one transport is required.") return t("config.import.blockerTransportRequired");
	if (message === "MCP name is invalid for PiDeck.") return t("config.import.blockerInvalidName");
	if (message === "Converted MCP definition is invalid.") return t("config.import.blockerInvalidDefinition");
	if (message === "Skill name cannot be converted to a safe name.") return t("config.import.blockerSkillName");
	if (message === "MCP server definition must be an object.") return t("config.import.blockerDefinitionObject");
	if (message === "Transport type does not match the configured fields.") return t("config.import.blockerTransportMismatch");
	if (message === "Source could not be read." || message === "Skill source could not be read.") return t("config.import.sourceReadError");
	if (message === "Source JSON could not be parsed." || message === "Codex TOML could not be parsed.") return t("config.import.sourceParseError");
	const field = /^Field not preserved:\s*(.+)$/.exec(message);
	if (field) return t("config.import.warningFieldNotPreserved", { field: field[1] });
	if (message === "Some environment values were not strings and were omitted.") return t("config.import.warningEnvValues");
	if (message === "Environment variables may be missing at runtime.") return t("config.import.warningEnvMissing");
	if (message === "Some header values were not strings and were omitted.") return t("config.import.warningHeaderValues");
	if (message === "HTTP headers may be missing at runtime.") return t("config.import.warningHeadersMissing");
	if (message === "Authentication values require manual verification.") return t("config.import.warningAuth");
	if (message === "Command was not found on PATH.") return t("config.import.warningCommandMissing");
	if (message === "URL could not be reached during the compatibility check.") return t("config.import.warningUrlUnreachable");
	if (message === "MCP endpoint could not be reached during the compatibility check.") return t("config.import.warningEndpointUnreachable");
	if (message === "Compatibility check timed out or failed.") return t("config.import.warningProbeFailed");
	if (message === "A duplicate name exists in this scan; only one candidate can be imported.") return t("config.import.warningDuplicate");
	if (message === "The skill name exceeds 64 characters and will be truncated.") return t("config.import.warningSkillNameLong");
	if (message === "Skill description exceeds 1024 characters.") return t("config.import.warningSkillDescriptionLong");
	if (message.includes("symbolic link")) return t("config.import.warningSkillSymlink");
	if (message.includes("unsupported file type")) return t("config.import.warningSkillFileType");
	if (message.includes("too large")) return t("config.import.warningSkillTooLarge");
	if (message.includes("too deep")) return t("config.import.warningSkillTooDeep");
	return message;
}

function sourceLabelFor(source: ResourceImportSourceKind): string {
	if (source === "claude-global") return t("config.import.sourceClaudeGlobal");
	if (source === "claude-project") return t("config.import.sourceClaudeProject");
	if (source === "codex-global") return t("config.import.sourceCodexGlobal");
	return t("config.import.sourceCodexProject");
}

function targetMatches(left: ResourceImportTarget, right: ResourceImportTarget): boolean {
	if (left.scope !== right.scope || left.locationId !== right.locationId) return false;
	if (left.scope === "global" || right.scope === "global") return true;
	return left.projectId === right.projectId;
}

function candidateCanImport(candidate: ResourceImportCandidate): boolean {
	return candidate.importable && !candidate.conflict;
}

function resultStatusLabel(status: ResourceImportReport["results"][number]["status"]): string {
	if (status === "imported") return t("config.import.itemImported");
	if (status === "skipped") return t("config.import.itemSkipped");
	return t("config.import.itemFailed");
}

export function ResourceImportDialog(props: {
	kind: ResourceImportKind;
	sourceProjectId?: string;
	projects: Project[];
	triggerLabel: string;
	open?: boolean;
	onImported?: () => void;
}) {
	const [open, setOpen] = useState(Boolean(props.open));
	const [target, setTarget] = useState<ResourceImportTarget>(
		props.kind === "mcp"
			? { scope: "global", locationId: "pi-global" }
			: { scope: "global", locationId: "pi-global" },
	);
	const [scan, setScan] = useState<ResourceImportScanResult | null>(null);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState(false);
	const [applying, setApplying] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [report, setReport] = useState<ResourceImportReport | null>(null);
	const requestGeneration = useRef(0);

	const availableProjects = useMemo(
		() => props.projects.filter((project) => project.kind !== "chat"),
		[props.projects],
	);
	const targetOptionEntries = useMemo(() => {
		const options: Array<{ value: string; label: string; target: ResourceImportTarget }> = props.kind === "mcp"
			? [{
				value: "global:pi-global",
				label: t("config.import.targetGlobalMcp"),
				target: { scope: "global", locationId: "pi-global" },
			}]
			: [
				{
					value: "global:pi-global",
					label: t("config.import.targetPiSkills"),
					target: { scope: "global", locationId: "pi-global" },
				},
				{
					value: "global:agents-global",
					label: t("config.import.targetAgentsSkills"),
					target: { scope: "global", locationId: "agents-global" },
				},
			];
		for (const project of availableProjects) {
			if (props.kind === "mcp") {
				options.push({
					value: `project:${project.id}:project-pi`,
					label: `${project.name} · ${t("config.import.targetProjectMcp")}`,
					target: { scope: "project", projectId: project.id, locationId: "project-pi" },
				});
				continue;
			}
			options.push(
				{
					value: `project:${project.id}:project-pi`,
					label: `${project.name} · ${t("config.import.targetProjectPiSkills")}`,
					target: { scope: "project", projectId: project.id, locationId: "project-pi" },
				},
				{
					value: `project:${project.id}:project-agents`,
					label: `${project.name} · ${t("config.import.targetProjectAgentsSkills")}`,
					target: { scope: "project", projectId: project.id, locationId: "project-agents" },
				},
			);
		}
		return options;
	}, [availableProjects, props.kind]);
 
	const targetOptions = useMemo(
		() => targetOptionEntries.map(({ value, label }) => ({ value, label })),
		[targetOptionEntries],
	);
	const selectedTargetValue = targetOptionEntries.find((entry) => targetMatches(entry.target, target))?.value
		?? targetOptions[0]?.value
		?? "";

	const runScan = useCallback(async (nextTarget: ResourceImportTarget) => {
		const generation = ++requestGeneration.current;
		setLoading(true);
		setError(null);
		setSelected(new Set());
		setReport(null);
		try {
			const result = await api.resourceImport.scan({
				kind: props.kind,
				sourceProjectId: props.sourceProjectId,
				target: nextTarget,
			});
			if (generation !== requestGeneration.current) return;
			setScan(result);
		} catch (caught) {
			if (generation !== requestGeneration.current) return;
			setScan(null);
			setError(formatImportMessage(caught instanceof Error ? caught.message : String(caught)));
		} finally {
			if (generation === requestGeneration.current) setLoading(false);
		}
	}, [props.kind, props.sourceProjectId]);

	useEffect(() => {
		if (props.open !== undefined) setOpen(props.open);
	}, [props.open]);

	useEffect(() => {
		const firstTarget = targetOptionEntries[0]?.target;
		if (firstTarget && !targetOptionEntries.some((entry) => targetMatches(entry.target, target))) {
			setTarget(firstTarget);
		}
	}, [target, targetOptionEntries]);

	useEffect(() => {
		if (!open) return;
		setScan(null);
		setReport(null);
		setError(null);
		setSelected(new Set());
		void runScan(target);
	}, [open, runScan]);

	const toggleAll = (checked: boolean) => {
		if (!scan) return;
		setSelected(checked
			? new Set(scan.candidates.filter(candidateCanImport).map((candidate) => candidate.candidateId))
			: new Set());
	};

	const apply = async () => {
		if (!scan || selected.size === 0 || applying) return;
		setApplying(true);
		setError(null);
		try {
			const result = await api.resourceImport.apply({
				scanId: scan.scanId,
				target,
				candidateIds: [...selected],
			});
			setReport(result);
			setSelected(new Set());
			props.onImported?.();
		} catch (caught) {
			setError(formatImportMessage(caught instanceof Error ? caught.message : String(caught)));
		} finally {
			setApplying(false);
		}
	};

	const handleOpenChange = (nextOpen: boolean) => {
		if (applying) return;
		if (!nextOpen) requestGeneration.current += 1;
		setOpen(nextOpen);
	};

	return (
		<>
			<Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={loading || applying}>
				<Download size={14} />
				{props.triggerLabel}
			</Button>
			<Dialog open={open} onOpenChange={handleOpenChange}>
				<DialogContent className="flex max-h-[80vh] flex-col gap-0 overflow-hidden sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>{props.kind === "mcp" ? t("config.import.mcpTitle") : t("config.import.skillTitle")}</DialogTitle>
					</DialogHeader>
					<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden py-3">
						<div className="flex items-center gap-2">
							<span className="text-control text-muted-foreground">{t("config.import.target")}</span>
							<ConfigSelect
								value={selectedTargetValue}
								options={targetOptions}
								onChange={(value) => {
									const next = targetOptionEntries.find((entry) => entry.value === value)?.target;
									if (next) {
										setTarget(next);
										if (open) void runScan(next);
									}
								}}
							/>
						</div>
						{error ? (
							<div className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-control text-danger">
								{error}
							</div>
						) : null}
						{report ? (
							<div className="space-y-2 rounded border border-border-subtle bg-bg-hover px-3 py-2 text-control">
								<div className="flex flex-wrap items-center gap-3">
									<span className="text-success">{t("config.import.resultImported", { count: report.imported })}</span>
									<span className="text-warning">{t("config.import.resultSkipped", { count: report.skipped })}</span>
									<span className="text-danger">{t("config.import.resultFailed", { count: report.failed })}</span>
								</div>
								<div className="space-y-1 border-t border-border-subtle pt-2">
									{report.results.map((item) => (
										<div key={item.candidateId} className="flex items-start gap-2 text-caption">
											<span className={item.status === "imported" ? "text-success" : item.status === "skipped" ? "text-warning" : "text-danger"}>
												{resultStatusLabel(item.status)}
											</span>
											<span className="min-w-0 break-words">{item.name}{item.reason ? ` · ${formatImportMessage(item.reason)}` : ""}</span>
										</div>
									))}
								</div>
							</div>
						) : null}
						{loading ? (
							<div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
								<Loader2 className="animate-pideck-spin" size={16} />
								{t("config.import.scanning")}
							</div>
						) : scan ? (
							<>
								<div className="flex items-center justify-between text-caption text-muted-foreground">
									<span>{t("config.import.candidateCount", { count: scan.candidates.length })}</span>
									<Button variant="ghost" size="sm" onClick={() => toggleAll(selected.size === 0)} disabled={applying}>
										{selected.size === 0 ? t("config.import.selectAll") : t("config.import.clearAll")}
									</Button>
								</div>
								<div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
									{scan.sources.map((source) => (
										<div key={`${source.source}:${source.pathLabel}`} className="text-micro text-muted-foreground">
											{sourceLabelFor(source.source)} · {source.pathLabel} · {source.exists ? t("config.import.sourceFound") : t("config.import.sourceMissing")}
											{source.error ? ` · ${formatImportMessage(source.error)}` : ""}
										</div>
									))}
									{scan.candidates.length === 0 ? (
										<div className="py-8 text-center text-control text-muted-foreground">{t("config.import.empty")}</div>
									) : scan.candidates.map((candidate) => {
										const disabled = !candidateCanImport(candidate);
										return (
											<div key={candidate.candidateId} className="rounded border border-border-subtle px-3 py-2">
												<div className="flex items-start gap-2">
													<Checkbox
														aria-label={candidate.targetName}
														checked={selected.has(candidate.candidateId)}
														disabled={disabled || applying}
														onCheckedChange={(checked) => setSelected((current) => {
															const next = new Set(current);
															if (checked === true) next.add(candidate.candidateId);
															else next.delete(candidate.candidateId);
															return next;
														})}
													/>
													<div className="min-w-0 flex-1">
														<div className="flex items-center gap-2">
															<strong className="truncate text-control">{candidate.targetName || candidate.name}</strong>
															{candidateCanImport(candidate) ? <CheckCircle2 className="text-success" size={14} /> : <XCircle className="text-danger" size={14} />}
														</div>
													<div className="text-micro text-muted-foreground">{sourceLabelFor(candidate.source)} · {candidate.sourcePathLabel}</div>
														{candidate.description ? <div className="text-caption text-muted-foreground">{candidate.description}</div> : null}
														{candidate.conflict ? <div className="text-micro text-warning">{t("config.import.conflict")}</div> : null}
														{candidate.blockers.map((item) => <div key={item} className="text-micro text-danger">{formatImportMessage(item)}</div>)}
														{candidate.warnings.map((item) => <div key={item} className="flex items-center gap-1 text-micro text-warning"><AlertTriangle size={12} />{formatImportMessage(item)}</div>)}
														{candidate.preview?.url ? <div className="truncate font-mono text-micro text-muted-foreground">{candidate.preview.url}</div> : candidate.preview?.command ? <div className="truncate font-mono text-micro text-muted-foreground">{candidate.preview.command} {(candidate.preview.args ?? []).join(" ")}</div> : null}
													</div>
												</div>
											</div>
										);
									})}
								</div>
							</>
						) : null}
					</div>
					<DialogFooter>
						<Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={applying}>
							{report ? t("common.close") : t("common.cancel")}
						</Button>
						<Button onClick={() => void apply()} disabled={report !== null || applying || loading || selected.size === 0}>
							{applying ? t("config.import.importing") : t("config.import.confirm", { count: selected.size })}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
