import { createRequire } from "node:module";

/**
 * 沙箱 runner 进程内的控制台治理（win32）。
 *
 * 背景：windows-acl 沙箱 runner 由 DSH host 以 GUI 二进制（electron.exe）拉起，
 * GUI 进程不继承 host 控制台；runner 再用 koffi 直接调 CreateProcessAsUserW
 * (dwCreationFlags=0) 拉起命令进程时，父进程无控制台会让 Windows 为命令进程
 * 新建一个可见控制台窗口（黑窗口）。runner 源码注释说明受限 token 下子进程
 * 自行创建控制台会 STATUS_DLL_INIT_FAILED(0xC0000142) 崩溃，因此不能靠
 * CREATE_NO_WINDOW——正确做法是让 runner 自身持有隐藏控制台，子进程继承
 * （继承≠创建，实测受限 token 下继承控制台正常运行）。
 *
 * 本文件由 host 补丁（hideChildConsoles.ts）通过 NODE_OPTIONS=--require 注入
 * runner 启动流程，在 runner 业务代码加载前分配并隐藏控制台。所有失败路径
 * 静默：koffi 缺失或调用失败时保持 runner 原有行为（至少不影响沙箱功能）。
 */
/** koffi 运行时 FFI 接口子集（与 hideChildConsoles.Win32Ffi 同形，preload 独立无共享代码）。 */
interface KoffiLike {
	load(name: string): {
		func(signature: string): (...args: unknown[]) => unknown;
	};
}

/**
 * 解析 koffi（两级兜底）：
 * 1) PIDECK_KOFFI_MODULE——hostEntry 从 runtime node_modules 解析后写进环境的 koffi
 *    入口绝对路径（最可靠：runtime 必带 koffi；打包版 app.asar 未必带——2026-09-14
 *    黑窗口根因正是 asar 缺 koffi、本 preload koffi 加载失败后静默退出）。
 * 2) createRequire(__filename) 常规解析——koffi 已进应用 dependencies，打包版从
 *    asar 内解析（native 落 asar.unpacked），dev 从仓库 node_modules。
 */
function resolveKoffi(): KoffiLike | undefined {
	const envModulePath = process.env.PIDECK_KOFFI_MODULE;
	if (envModulePath) {
		try {
			return createRequire(__filename)(envModulePath) as KoffiLike;
		} catch {
			// env 指向的模块不可用（runtime 被卸载/升级窗口期）：继续常规解析
		}
	}
	try {
		return createRequire(__filename)("koffi") as KoffiLike;
	} catch {
		return undefined;
	}
}

function installRunnerHiddenConsole(): void {
	if (process.platform !== "win32") return;
	try {
		const koffi = resolveKoffi();
		if (!koffi) return; // koffi 完全不可达：静默退出，保持 runner 原有行为
		const kernel32 = koffi.load("kernel32.dll");
		const user32 = koffi.load("user32.dll");
		const getConsoleWindow = kernel32.func("void* GetConsoleWindow(void)") as () => unknown;
		const allocConsole = kernel32.func("int AllocConsole(void)") as () => number;
		const showWindow = user32.func("int ShowWindow(void* hWnd, int nCmdShow)") as (
			hWnd: unknown,
			nCmdShow: number,
		) => number;
		if (getConsoleWindow()) return; // 已有控制台（终端拉起等场景）：无需处理
		if (allocConsole() === 0) return;
		// AllocConsole 返回时窗口句柄经常还是 0；必须轮询 GetConsoleWindow，
		// 不能只在首帧有句柄时才 Hide，否则 conhost 稍后弹出「一闪而过」。
		const hideConsole = () => {
			const hwnd = getConsoleWindow();
			if (hwnd) showWindow(hwnd, 0);
		};
		hideConsole();
		const hideTimer = setInterval(hideConsole, 16);
		setTimeout(() => clearInterval(hideTimer), 1000);
		hideTimer.unref?.();
	} catch {
		// 尽力而为：失败时退回 runner 原有行为
	}
}

installRunnerHiddenConsole();
