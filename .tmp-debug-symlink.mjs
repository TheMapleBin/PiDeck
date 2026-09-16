import { mkdtempSync, rmSync, writeFileSync, symlinkSync, lstatSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pideck-symtest-"));
const target = join(dir, "target.txt");
writeFileSync(target, "x\n");
const link = join(dir, "link.txt");
try {
	symlinkSync(target, link, "file");
	console.log("symlinkSync ok");
} catch (error) {
	console.log("symlinkSync threw:", error.code, error.message);
}
try {
	console.log("lstat isSymbolicLink:", lstatSync(link).isSymbolicLink());
} catch (error) {
	console.log("lstat threw:", error.code);
}
try {
	console.log("readlink:", readlinkSync(link));
} catch (error) {
	console.log("readlink threw:", error.code);
}
const link2 = join(dir, "link2.txt");
try {
	symlinkSync(target, link2);
	console.log("symlinkSync(no type) ok, lstat sym:", lstatSync(link2).isSymbolicLink());
} catch (error) {
	console.log("symlinkSync(no type) threw:", error.code, error.message);
}
rmSync(dir, { recursive: true, force: true });
