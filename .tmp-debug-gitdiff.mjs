import { mkdtempSync, rmSync, writeFileSync, symlinkSync, existsSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadTsCommonJs } = await import("./tests/helpers/loadTsCommonJs.mjs").catch(() => ({}));
// GitService 是 TS 源码，用项目测试 helper 加载
const { GitService } = loadTsCommonJs("src/main/git/GitService.ts");

const dir = mkdtempSync(join(tmpdir(), "pideck-debug-git-"));
const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
git("init");
git("config", "user.email", "t@t");
git("config", "user.name", "t");
writeFileSync(join(dir, "a.txt"), "hello\n");
git("add", ".");
git("commit", "-m", "init");

const externalDir = mkdtempSync(join(tmpdir(), "pideck-external-"));
const externalPath = join(externalDir, "secret.txt");
writeFileSync(externalPath, "must not be read\n");
const linkPath = join(dir, "external-link");
try {
	symlinkSync(externalPath, linkPath, "file");
} catch (error) {
	console.log("SYMLINK FAILED:", error.message);
	process.exit(0);
}
console.log("lstat isSymbolicLink:", lstatSync(linkPath).isSymbolicLink());
console.log("git status --porcelain:\n" + git("status", "--porcelain"));

const service = new GitService();
const status = await service.getStatus(dir);
console.log("untracked group:", JSON.stringify(status.untracked));
const diff = await service.getWorkspaceFileDiff(dir, "untracked", linkPath, 4096);
console.log("diff:", JSON.stringify(diff));

rmSync(linkPath, { force: true });
rmSync(externalDir, { recursive: true, force: true });
rmSync(dir, { recursive: true, force: true });
