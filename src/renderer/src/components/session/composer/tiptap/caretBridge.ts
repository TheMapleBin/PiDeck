/**
 * TipTap Composer 编辑器实例注册：建议菜单坐标可从 ProseMirror coordsAtPos 取值，
 * 同时兼容旧 getRichInputCaretCoords(root, offset) 调用约定。
 */

import type { Editor } from "@tiptap/core";

const editorByDom = new WeakMap<HTMLElement, Editor>();

export function registerComposerTipTapEditor(dom: HTMLElement, editor: Editor | null): void {
	if (editor) editorByDom.set(dom, editor);
	else editorByDom.delete(dom);
}

export function resolveComposerTipTapEditor(root: HTMLElement | null): Editor | null {
	if (!root) return null;
	const direct = editorByDom.get(root);
	if (direct) return direct;
	const pm = root.classList.contains("ProseMirror") ? root : root.querySelector<HTMLElement>(".ProseMirror");
	if (pm) {
		const fromPm = editorByDom.get(pm);
		if (fromPm) return fromPm;
	}
	return null;
}

/** plain-text 偏移 → ProseMirror 文档位置（与 plainTextCodec 单段+hardBreak 约定一致）。 */
export function plainOffsetToPos(editor: Editor, plainOffset: number): number {
	const doc = editor.state.doc;
	let remaining = Math.max(0, plainOffset);
	let pos = 0;
	let found = false;
	doc.descendants((node, nodePos) => {
		if (found) return false;
		if (node.isText) {
			const len = node.text?.length ?? 0;
			if (remaining <= len) {
				pos = nodePos + remaining;
				found = true;
				return false;
			}
			remaining -= len;
			return true;
		}
		if (node.type.name === "hardBreak") {
			if (remaining === 0) {
				pos = nodePos;
				found = true;
				return false;
			}
			remaining -= 1;
			return true;
		}
		if (node.type.name === "mentionChip") {
			const rawLen = String(node.attrs.raw ?? "").length;
			if (remaining < rawLen) {
				// 落在 chip 内：贴到 chip 前
				pos = nodePos;
				found = true;
				return false;
			}
			if (remaining === rawLen) {
				pos = nodePos + node.nodeSize;
				found = true;
				return false;
			}
			remaining -= rawLen;
			return true;
		}
		return true;
	});
	if (!found) pos = doc.content.size;
	return pos;
}

export function posToPlainOffset(editor: Editor, pos: number): number {
	const doc = editor.state.doc;
	let offset = 0;
	let done = false;
	doc.descendants((node, nodePos) => {
		if (done) return false;
		if (nodePos >= pos) {
			done = true;
			return false;
		}
		if (node.isText) {
			const len = node.text?.length ?? 0;
			const end = nodePos + len;
			if (pos <= end) {
				offset += pos - nodePos;
				done = true;
				return false;
			}
			offset += len;
			return true;
		}
		if (node.type.name === "hardBreak") {
			if (pos <= nodePos) {
				done = true;
				return false;
			}
			offset += 1;
			return true;
		}
		if (node.type.name === "mentionChip") {
			const rawLen = String(node.attrs.raw ?? "").length;
			const end = nodePos + node.nodeSize;
			if (pos < end) {
				done = true;
				return false;
			}
			offset += rawLen;
			return true;
		}
		return true;
	});
	return offset;
}

export function getTipTapComposerCaretCoords(editor: Editor, plainOffset: number): { top: number; left: number; bottom: number } | null {
	try {
		const pos = plainOffsetToPos(editor, plainOffset);
		const coords = editor.view.coordsAtPos(pos);
		return { top: coords.top, left: coords.left, bottom: coords.bottom };
	} catch {
		return null;
	}
}
