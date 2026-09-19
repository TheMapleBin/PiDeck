/**
 * PiDeck file-reference guidance.
 *
 * The renderer already knows how to resolve a workspace path, enforce the
 * session project boundary, and open the file. This extension only teaches the
 * model the presentation contract: emit real workspace paths with locations,
 * not Electron/editor URI schemes.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const FILE_REFERENCE_MARKER = "<!-- pideck-file-reference-rules -->";

export const FILE_REFERENCE_SYSTEM_PROMPT = `${FILE_REFERENCE_MARKER}
File references in PiDeck:
- When mentioning a project file, use the actual workspace-relative path whenever possible and wrap it in inline code.
- When discussing a specific location, append a 1-based line number: \`src/main/index.ts:42\`.
- You may use an explicit Markdown link when inviting the user to open a file: [open src/main/index.ts](src/main/index.ts:42).
- Use paths returned by tools; do not invent paths or prefer an unrelated absolute path when a workspace-relative path is available.
- Do not emit \`file://\`, \`vscode://\`, or other editor/file URI links. PiDeck turns ordinary paths and Markdown file links into safe in-app file actions.
- In a change summary, include the relevant file path and the most useful line number.
`;

/** Append the contract once while preserving all previously installed prompt sections. */
export function appendFileReferenceInstructions(systemPrompt: string): string {
	if (systemPrompt.includes(FILE_REFERENCE_MARKER)) return systemPrompt;
	const base = systemPrompt.trimEnd();
	return base ? `${base}\n\n${FILE_REFERENCE_SYSTEM_PROMPT}` : FILE_REFERENCE_SYSTEM_PROMPT;
}

export default function piDeckFileLinksExtension(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event, ctx: ExtensionContext) => ({
		systemPrompt: appendFileReferenceInstructions(
			ctx.getSystemPrompt?.() ?? event.systemPrompt ?? "",
		),
	}));
}
