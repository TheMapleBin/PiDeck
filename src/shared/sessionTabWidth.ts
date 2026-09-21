/** Shared bounds for the configurable session/file tab width. */
export const SESSION_TAB_MAX_WIDTH_MIN = 80;
export const SESSION_TAB_MAX_WIDTH_MAX = 400;
export const SESSION_TAB_MAX_WIDTH_DEFAULT = 104;

/** Additional width reserved by a leading backend/mode badge. */
export const SESSION_TAB_BADGE_EXTRA_WIDTH = 28;

/**
 * Normalize persisted or IPC-provided tab width values.
 * Invalid values use the historical default; valid values stay within the
 * supported range and are rounded to whole CSS pixels.
 */
export function clampSessionTabMaxWidth(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return SESSION_TAB_MAX_WIDTH_DEFAULT;
	return Math.min(SESSION_TAB_MAX_WIDTH_MAX, Math.max(SESSION_TAB_MAX_WIDTH_MIN, Math.round(value)));
}
