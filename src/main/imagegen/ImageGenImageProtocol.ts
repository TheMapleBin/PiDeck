import { protocol } from "electron";
import { readFile } from "node:fs/promises";
import { IMAGE_BLOB_PROTOCOL } from "../../shared/imageContentSrc";
import { imageBlobMimeType, type ImageBlobStore } from "./ImageBlobStore";

/**
 * pideck-img:// 协议：把落盘的生图图片交给渲染层 `<img>` 直接加载。
 *
 * 为什么需要它：历史生图消息只带 `{ref}` 引用（见 ImageSessionStore）。如果把
 * ref 回读成 base64 再塞进消息对象，就等于把 200 MB 的字符串搬回渲染进程堆——
 * 那正是这次 OOM 事故的成因。交给协议后，Chromium 自己按需拉取、解码、淘汰，
 * 渲染层只持有几十字节的 URL 字符串。
 *
 * 只服务 `pideck-img://blob/<sha256>.<ext>`：引用名经 IMAGE_BLOB_REF_RE 白名单
 * 校验且必须落回 blobs 目录内，杜绝 ../ 逃逸与任意文件读取。
 * 内容寻址 ⇒ ref 与内容一一对应且永不变更，因此可以长缓存。
 */
function parseBlobRef(url: string): string | null {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== "blob") return null;
		const ref = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
		return ref || null;
	} catch {
		return null;
	}
}

export function registerImageGenImageProtocol(blobs: ImageBlobStore): void {
	protocol.handle(IMAGE_BLOB_PROTOCOL, async (request) => {
		const ref = parseBlobRef(request.url);
		if (!ref) return new Response("forbidden", { status: 403 });
		const file = blobs.resolvePath(ref);
		if (!file) return new Response("forbidden", { status: 403 });
		try {
			const data = await readFile(file);
			return new Response(data, {
				headers: {
					"Content-Type": imageBlobMimeType(ref),
					"Cache-Control": "public, max-age=31536000, immutable",
				},
			});
		} catch {
			return new Response("not found", { status: 404 });
		}
	});
}
