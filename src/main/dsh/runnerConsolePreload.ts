import { createRequire } from "node:module";

/**
 * 沙箱 runner 进程内的控制台治理（win32）。
 *
 * 两条路径：
 * 1) CUI node sidecar（B 方案）：runner 已是 node.exe，继承 host 隐藏控制台。
 *    此 preload 不再 AllocConsole（会闪窗），只把后续 runner spawn 的
 *    windowsHide 打成 false——dsh-subprocess-local 默认 windowsHide:true，
 *    会 CREATE_NO_WINDOW 切断继承，第二级 ACL runner 再拉 pwsh 又弹黑窗口。
 * 2) 旧路径（electron.exe + ELECTRON_RUN_AS_NODE）：GUI 进程不继承控制台，
 *    仍须 AllocConsole + SW_HIDE，子进程继承隐藏控制台。
 *
 * 由 host 补丁通过 NODE_OPTIONS=--require 注入。失败路径静默。
 */
interface KoffiLike {
	load(name: string): {
		func(signature: string): (...args: unknown[]) => unknown;
	};
}

const RUNNER_SCRIPT_RE = /runner\.(js|ts)$/i;

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

function isElectronExec(): boolean {
	return /(^|[\\/])electron(\.exe)?$/i.test(process.execPath);
}

function isRunnerArgs(args: unknown): args is readonly string[] {
	return Array.isArray(args) && args.some((arg) => typeof arg === "string" && RUNNER_SCRIPT_RE.test(arg));
}

/**
 * 第一级 runner 再 spawn 第二级 ACL runner 时，dsh-subprocess-local 写死
 * windowsHide: true。CUI sidecar 必须关掉它，否则第二级没有可继承控制台。
 */
function patchNestedRunnerWindowsHide(): void {
	if (process.platform !== "win32") return;
	try {
		const childProcess = createRequire(__filename)("node:child_process") as {
			spawn: (...args: unknown[]) => unknown;
			spawnSync: (...args: unknown[]) => unknown;
		};
		const originals = {
			spawn: childProcess.spawn,
			spawnSync: childProcess.spawnSync,
		};
		const wrap = (orig: (...args: unknown[]) => unknown) =>
			(command: unknown, argsOrOptions?: unknown, maybeOptions?: unknown) => {
				if (isRunnerArgs(argsOrOptions)) {
					const nextOptions = {
						...((maybeOptions && typeof maybeOptions === "object" ? maybeOptions : {}) as object),
						windowsHide: false,
					};
					return orig(command, argsOrOptions, nextOptions);
				}
				return orig(command, argsOrOptions, maybeOptions);
			};
		Object.defineProperty(childProcess, "spawn", {
			value: wrap(originals.spawn),
			writable: true,
			configurable: true,
		});
		Object.defineProperty(childProcess, "spawnSync", {
			value: wrap(originals.spawnSync),
			writable: true,
			configurable: true,
		});
	} catch {
		// 补丁失败时保持 runner 原有行为
	}
}

function installRunnerHiddenConsole(): void {
	if (process.platform !== "win32") return;
	// sidecar / 已是 node.exe：继承 host 控制台即可，AllocConsole 会再闪一帧。
	if (!isElectronExec()) return;
	try {
		const koffi = resolveKoffi();
		if (!koffi) return;
		const kernel32 = koffi.load("kernel32.dll");
		const user32 = koffi.load("user32.dll");
		const getConsoleWindow = kernel32.func("void* GetConsoleWindow(void)") as () => unknown;
		const allocConsole = kernel32.func("int AllocConsole(void)") as () => number;
		const showWindow = user32.func("int ShowWindow(void* hWnd, int nCmdShow)") as (
			hWnd: unknown,
			nCmdShow: number,
		) => number;
		if (getConsoleWindow()) return;
		if (allocConsole() === 0) return;
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

patchNestedRunnerWindowsHide();
installRunnerHiddenConsole();
