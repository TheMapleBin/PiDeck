import { ipcMain } from "electron";
import { ipcChannels } from "../../shared/ipc";
import type { ResourceImportApplyInput, ResourceImportScanInput, ResourceImportTarget } from "../../shared/types/resourceImport";
import type { ResourceImportManager } from "../resourceImport/ResourceImportManager";

function isTarget(value: unknown): value is ResourceImportTarget {
	if (!isRecord(value)) return false;
	const record = value;
	if (!("scope" in record) || !("locationId" in record)) return false;
	if (record.scope === "global") {
		return Object.keys(record).every((key) => key === "scope" || key === "locationId")
			&& (record.locationId === "pi-global" || record.locationId === "agents-global");
	}
	return Object.keys(record).every((key) => key === "scope" || key === "locationId" || key === "projectId")
		&& record.scope === "project"
		&& typeof record.projectId === "string"
		&& record.projectId.trim().length > 0
		&& record.projectId.length <= 256
		&& (record.locationId === "project-pi" || record.locationId === "project-agents");
}

function isScanInput(value: unknown): value is ResourceImportScanInput {
	if (!isRecord(value)) return false;
	const record = value;
	if (Object.keys(record).some((key) => key !== "kind" && key !== "target" && key !== "sourceProjectId")) return false;
	if (!("kind" in record) || (record.kind !== "mcp" && record.kind !== "skill") || !("target" in record) || !isTarget(record.target)) return false;
	return record.sourceProjectId === undefined || (typeof record.sourceProjectId === "string" && record.sourceProjectId.trim().length > 0 && record.sourceProjectId.length <= 256);
}

function isApplyInput(value: unknown): value is ResourceImportApplyInput {
	if (!isRecord(value)) return false;
	const record = value;
	if (Object.keys(record).some((key) => key !== "scanId" && key !== "target" && key !== "candidateIds")) return false;
	if (!("scanId" in record) || typeof record.scanId !== "string" || record.scanId.length < 8 || record.scanId.length > 128 || !("target" in record) || !isTarget(record.target) || !("candidateIds" in record) || !Array.isArray(record.candidateIds) || record.candidateIds.length > 1000) return false;
	return record.candidateIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function registerResourceImportIpc(manager: ResourceImportManager): void {
	ipcMain.handle(ipcChannels.resourceImportScan, async (_event, input: unknown) => {
		if (!isScanInput(input)) throw new Error("Invalid resource import scan input.");
		return manager.scan(input);
	});
	ipcMain.handle(ipcChannels.resourceImportApply, async (_event, input: unknown) => {
		if (!isApplyInput(input)) throw new Error("Invalid resource import apply input.");
		return manager.apply(input);
	});
}
