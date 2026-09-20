/** Compact mode changes presentation only; execution stays in the normal session runtime. */
export interface QuickTaskState {
	active: boolean;
	requestId: number;
	path?: string;
	error?: string;
}
