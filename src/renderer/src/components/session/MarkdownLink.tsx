import { useState } from "react";
import type React from "react";
import { isLocalPathRef, remarkLinkifyPaths } from "./MarkdownLinkCore";
import { useFileLinkContext, useFilePathExists } from "./FileLinkBase";
import { extractFileLinkLocation, relativeFilePathWithinRoot, resolveFileLinkPath } from "../../utils/filePathLinks";
import { t } from "../../i18n";
import { showNotice } from "../../utils/notice";
import { writeClipboardText } from "../ui-shadcn/notice-toast";
import { desktopApi } from "../../desktopApi";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui-shadcn/dropdown-menu";
export {
	isLocalPathRef,
	markdownUrlTransform,
	remarkLinkifyPaths,
} from "./MarkdownLinkCore";

/**
 * 链接渲染：file:// 前缀为 remarkLinkifyPaths 生成的文件路径链接，其余为普通外链。
 * 无协议 href（[text](path) 形式）识别为本地路径引用，点击走 onOpenFile。
 */
export function MarkdownLink(
	props: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
		onOpenExternal: (url: string, forceSystem?: boolean) => void;
		onOpenFile?: (path: string, line?: number) => void;
	},
) {
	const { onOpenExternal, onOpenFile, children, className, title, ...anchorProps } = props;
	const [menu, setMenu] = useState<{ x: number; y: number } | undefined>(undefined);
	// remarkLinkifyPaths 生成的文件路径链接走 file:// 协议，与普通外链区分展示；
	// 无协议 href（[text](path) 形式）也是本地路径引用，同样走 onOpenFile
	const isFileLink = props.href?.startsWith("file://") ?? false;
	const isLocalRef = !isFileLink && isLocalPathRef(props.href ?? "");
	// 显式 Markdown 链接可能写成 /C:/path/file.ts:42：先还原 Windows 盘符，
	// 再把行号从路径里拆出来。校验用纯路径，点击带上行号（打开后滚动定位）。
	const fileLinkRawPath = isFileLink ? props.href!.slice(7) : isLocalRef ? props.href : undefined;
	const fileLinkLocation = fileLinkRawPath === undefined ? undefined : extractFileLinkLocation(fileLinkRawPath);
	const fileLinkPath = fileLinkLocation?.path;
	const fileLinkLine = fileLinkLocation?.line;
	const pathExists = useFilePathExists(fileLinkPath);
	// 右键菜单用：与存在性校验/点击打开同一份基准解析，保证三个入口拿到同一绝对路径
	const { baseDir, projectRoot, scope } = useFileLinkContext();
	const resolvedPath = fileLinkPath === undefined ? null : resolveFileLinkPath(fileLinkPath, baseDir, projectRoot);
	const relativePath = resolvedPath && projectRoot ? relativeFilePathWithinRoot(resolvedPath, projectRoot) : null;
	const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
		e.preventDefault();
		if (!props.href) return;

		// 处理文件路径链接（file:// 协议 + 无协议的本地路径引用）
		if (isFileLink || isLocalRef) {
			if (onOpenFile && fileLinkPath) {
				void onOpenFile(fileLinkPath, fileLinkLine);
			}
		} else {
			// 普通 URL 链接：修饰键点击（Ctrl/Cmd）强制走系统浏览器。
			// 全局设置「内置浏览器」时，用户可临时用默认浏览器打开，无需改设置；
			// external 模式下 forceSystem 与默认行为一致，结果不变。
			void onOpenExternal(props.href, e.ctrlKey || e.metaKey || undefined);
		}
	};
	const handleContextMenu = (e: React.MouseEvent<HTMLAnchorElement>) => {
		if (!resolvedPath) return;
		e.preventDefault();
		setMenu({ x: e.clientX, y: e.clientY });
	};
	// 「在资源管理器打开」：stat 分流——目录直接打开该目录（shell.openPath），
	// 文件定位到父目录并选中（showInFolder）；不存在时与左键点击同一份提示。
	const openInExplorer = () => {
		if (!resolvedPath) return;
		void desktopApi.files
			.stat(resolvedPath, scope)
			.then((stat) => {
				if (!stat.exists) {
					showNotice(t("app.fileLinkNotFound", { path: resolvedPath }), undefined, "error");
					return undefined;
				}
				return stat.isDirectory ? desktopApi.files.open(resolvedPath, scope) : desktopApi.files.showInFolder(resolvedPath, scope);
			})
			.catch((error) =>
				showNotice(
					t("app.openFileFailed", {
						error: error instanceof Error ? error.message : String(error),
					}),
					undefined,
					"error",
				),
			);
	};
	const copyAbsolutePath = () => {
		if (!resolvedPath) return;
		void writeClipboardText(resolvedPath).then((ok) => {
			if (ok) showNotice(t("app.pathCopied"));
		});
	};
	const copyRelativePath = () => {
		if (!relativePath) return;
		void writeClipboardText(relativePath).then((ok) => {
			if (ok) showNotice(t("app.pathCopied"));
		});
	};
	// false=已确认不存在：渲染纯文本；undefined=未知或校验中：维持普通文本链接，
	// 等存在性结果回来后只改变是否可点击，不引入胶囊式视觉跳变。
	if (isFileLink || isLocalRef) {
		if (pathExists === false) {
			return <span className="text-text-tertiary">{children}</span>;
		}
	}
	const linkClass = [className, isFileLink || isLocalRef ? "cursor-pointer font-mono text-[var(--color-accent)] underline decoration-[var(--color-accent)]/50 underline-offset-2 hover:decoration-[var(--color-accent)]" : undefined].filter(Boolean).join(" ") || undefined;
	return (
		<>
			<a
				{...anchorProps}
				className={linkClass}
				onClick={handleClick}
				onContextMenu={isFileLink || isLocalRef ? handleContextMenu : undefined}
				// 文件链接 hover 展示解码后的完整路径，便于确认目标文件；
				// 普通链接不传 title，保留 markdown 自带 title 语法的原行为
				title={isFileLink ? fileLinkPath : title}
			>
				{children}
			</a>
			{menu && resolvedPath && (
				<DropdownMenu
					open
					onOpenChange={(open) => {
						if (!open) setMenu(undefined);
					}}
				>
					{/* 不可见 Trigger 钉在右键坐标上（同 FileContextMenu 的坐标菜单模式）：
					    Radix 负责视口碰撞翻转/焦点圈定/ESC 关闭。 */}
					<DropdownMenuTrigger
						aria-hidden
						tabIndex={-1}
						style={{
							position: "fixed",
							left: menu.x,
							top: menu.y,
							width: 0,
							height: 0,
							padding: 0,
							border: 0,
							background: "transparent",
							pointerEvents: "none",
						}}
					/>
					<DropdownMenuContent align="start" side="bottom" className="min-w-40" onCloseAutoFocus={(e) => e.preventDefault()}>
						<DropdownMenuItem onSelect={openInExplorer}>{t("fileLink.openInExplorer")}</DropdownMenuItem>
						<DropdownMenuItem onSelect={copyRelativePath} disabled={!relativePath}>
							{t("fileLink.copyRelativePath")}
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={copyAbsolutePath}>{t("fileLink.copyAbsolutePath")}</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</>
	);
}
