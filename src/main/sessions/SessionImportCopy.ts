import type { MainProcessTranslationKey } from "../../shared/i18n/mainProcessCopy";

export type SessionImportCopyKey = Extract<MainProcessTranslationKey, "session.importedTitle" | "session.importedPreview">;

export type SessionImportCopy = (key: SessionImportCopyKey, params?: Record<string, string | number>) => string;

const defaultCopy: Record<SessionImportCopyKey, string> = {
	"session.importedTitle": "{source} 会话",
	"session.importedPreview": "{source} imported session",
};

export function defaultSessionImportCopy(key: SessionImportCopyKey, params: Record<string, string | number> = {}): string {
	return defaultCopy[key].replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match));
}
