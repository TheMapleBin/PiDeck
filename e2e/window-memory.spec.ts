import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

/**
 * 窗口大小记忆回归（startupWindowMode="last"）：
 * 主进程 close 接线——正常退出应用时把当前窗口尺寸写入
 * userData/last-window-bounds.json；读取/顺延逻辑由 windowState 单测覆盖。
 */
test("window size memory: close writes last bounds to userData", async ({ app, window }) => {
	let userDataPath = "";
	// 阶段 1：设置 last 模式（默认已是「上次窗口大小」）+ 调整窗口大小 + 正常退出
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	await window.locator(".settings-icon").click();
	const modal = window.locator(".settings-modal");
	await expect(modal).toBeVisible();
	await modal.getByText("外观设置").click();
	// 启动窗口预设下拉：先切到「窗口 · 大」再切回「上次窗口大小」制造脏字段，
	// 保存后确认 last 模式生效（默认即 last，直接保存无脏字段不会出现保存按钮）
	const combo = modal.getByRole("combobox").filter({ hasText: /上次窗口大小|窗口 · 大|Window · Large/ });
	await combo.click();
	await window
		.getByRole("option", { name: /窗口 · 大|Window · Large/ })
		.first()
		.click();
	await combo.click();
	await window.getByRole("option", { name: "上次窗口大小" }).click();
	await modal.getByRole("button", { name: "保存" }).click();
	// 保存不自动关闭：显式关闭弹窗（无未保存变更时不弹确认）
	await modal.getByRole("button", { name: "关闭" }).first().click();
	await expect(modal).toHaveCount(0);

	// 调整窗口大小（主进程侧），等待落定后关闭应用（触发 close 记录）
	userDataPath = await app.evaluate(({ app: e }) => e.getPath("userData"));
	await app.evaluate(({ BrowserWindow }) => {
		const w = BrowserWindow.getAllWindows()[0];
		// 首启无 last 记录会顺延最大化：先还原再设尺寸，否则 setBounds 不生效
		w?.unmaximize();
		w?.setBounds({ width: 1200, height: 760 });
	});
	await expect
		.poll(() =>
			app.evaluate(({ BrowserWindow }) => {
				const w = BrowserWindow.getAllWindows()[0];
				return w ? [w.getBounds().width, w.getBounds().height] : null;
			}),
		)
		.toEqual([1200, 760]);
	await app.close();

	// 记录文件已写入且尺寸正确（close 接线：关闭前保存 normal bounds）
	const file = join(userDataPath, "last-window-bounds.json");
	expect(existsSync(file)).toBe(true);
	const saved = JSON.parse(readFileSync(file, "utf8"));
	expect(saved.width).toBe(1200);
	expect(saved.height).toBe(760);
});
