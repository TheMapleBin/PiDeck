import { atom } from "jotai";
import {
	openAutomationWorkspace,
	showSessionWorkspace,
	type WorkspaceSurface,
} from "../utils/workspaceSurface";

/**
 * Middle-workbench presentation state. This is intentionally separate from session
 * selection and sessionTabIdsAtom so utility pages never inherit session-tab semantics.
 */
export const workspaceSurfaceAtom = atom<WorkspaceSurface>(showSessionWorkspace());

/** Opens the singleton automation utility page, optionally scoped to one project. */
export const openAutomationWorkspaceAtom = atom(
	null,
	(_get, set, projectId?: string) => {
		set(workspaceSurfaceAtom, openAutomationWorkspace({ projectId }));
	},
);
