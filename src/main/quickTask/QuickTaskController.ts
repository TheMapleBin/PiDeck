import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, normalize } from "node:path";
import type { BrowserWindow, Rectangle } from "electron";
import type { QuickTaskState } from "../../shared/types/quickTask";

/** Reject malformed launch paths before project lookup or creation. Never invokes a shell. */
export async function validateQuickTaskPath(value: unknown): Promise<string> {
	if (typeof value !== "string" || !value || value.length > 32767 || /[\u0000-\u001f"]/u.test(value) || !isAbsolute(value)) throw new Error("QUICK_TASK_INVALID_PATH");
	const path = normalize(value);
	if (!(await stat(path)).isDirectory()) throw new Error("QUICK_TASK_NOT_DIRECTORY");
	await access(path, constants.R_OK);
	return path;
}

/** Fits the task surface in the current display without changing saved workbench bounds. */
export function compactTaskBounds(bounds: Rectangle, workArea: Rectangle): Rectangle {
	const width = Math.min(720, workArea.width);
	const height = Math.min(760, workArea.height);
	return { width, height, x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width)), y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height)) };
}

/** Owns native geometry and a replayable launch intent, not sessions or model execution. */
export class QuickTaskController {
	private state: QuickTaskState = { active: false, requestId: 0 };
	private saved: { bounds: Rectangle; minimum: number[]; maximized: boolean; fullscreen: boolean } | null = null;
	private window: BrowserWindow | null = null;
	private cancelFullscreenTransition: (() => void) | null = null;
	constructor(private readonly deps: { getWindow: () => BrowserWindow | null; workArea: (bounds: Rectangle) => Rectangle; publish: (state: QuickTaskState) => void; validatePath?: (path: unknown) => Promise<string> }) {}
	getState(): QuickTaskState {
		return { ...this.state };
	}
	isActive(): boolean {
		return this.state.active;
	}
	getWorkbenchBounds(): Rectangle | undefined {
		return this.saved?.bounds;
	}
	async open(path: string): Promise<void> {
		const requestId = this.state.requestId + 1;
		// A renderer fetching state during validation must not create a draft from an unchecked path.
		this.state = { active: true, requestId };
		this.enterCompact();
		try {
			const validated = await (this.deps.validatePath ?? validateQuickTaskPath)(path);
			if (this.state.requestId !== requestId || !this.state.active) return;
			this.state = { active: true, requestId, path: validated };
		} catch (error) {
			if (this.state.requestId !== requestId || !this.state.active) return;
			this.state = { active: true, requestId, path, error: error instanceof Error ? error.message : String(error) };
		}
		this.deps.publish(this.getState());
	}
	private enterCompact(): void {
		const window = this.deps.getWindow();
		if (!window || window.isDestroyed()) return;
		if (this.window !== window) {
			this.cancelFullscreenTransition?.();
			this.cancelFullscreenTransition = null;
			this.saved = null;
			this.window = window;
		}
		// Restore before capturing geometry: restoring a minimized maximized window after setBounds
		// would otherwise replace the newly applied compact dimensions.
		if (window.isMinimized()) window.restore();
		if (!this.saved) {
			this.saved = { bounds: window.getNormalBounds(), minimum: window.getMinimumSize(), maximized: window.isMaximized(), fullscreen: window.isFullScreen() };
			const saved = this.saved;
			const applyCompact = () => {
				this.cancelFullscreenTransition = null;
				if (!this.state.active || window.isDestroyed()) return;
				if (window.isMaximized()) window.unmaximize();
				const workArea = this.deps.workArea(saved.bounds);
				window.setMinimumSize(Math.min(480, workArea.width), Math.min(480, workArea.height));
				window.setBounds(compactTaskBounds(saved.bounds, workArea));
			};
			// Electron's fullscreen transition can be asynchronous. Apply geometry only afterwards.
			if (saved.fullscreen) {
				window.once("leave-full-screen", applyCompact);
				this.cancelFullscreenTransition = () => window.removeListener("leave-full-screen", applyCompact);
				window.setFullScreen(false);
			} else applyCompact();
		}
		window.show();
		window.focus();
	}
	/** Closing compact mode returns to the workbench; running tasks continue unchanged. */
	exit(): void {
		this.cancelFullscreenTransition?.();
		this.cancelFullscreenTransition = null;
		const window = this.deps.getWindow();
		if (window && !window.isDestroyed() && this.saved) {
			window.setMinimumSize(this.saved.minimum[0] ?? 880, this.saved.minimum[1] ?? 600);
			window.setBounds(this.saved.bounds);
			if (this.saved.maximized) window.maximize();
			if (this.saved.fullscreen) window.setFullScreen(true);
		}
		this.saved = null;
		this.state = { ...this.state, active: false };
		this.deps.publish(this.getState());
	}
}
