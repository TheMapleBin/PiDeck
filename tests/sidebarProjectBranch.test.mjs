import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(p, "utf8");

test("i18n defines app.currentBranch in zh-CN and en-US", () => {
	const zh = read("src/renderer/src/i18n/rendererCopy.zh-CN.ts");
	const en = read("src/renderer/src/i18n/rendererCopy.en-US.ts");
	assert.match(zh, /"app\.currentBranch":\s*"当前分支：\{branch\}"/);
	assert.match(en, /"app\.currentBranch":\s*"Current branch: \{branch\}"/);
});

test("ProjectTree renders git branch badge next to project directory name", () => {
	const src = read("src/renderer/src/components/sidebar/ProjectTree.tsx");
	// 导入 GitBranch 图标
	assert.match(src, /import\s*\{[^}]*GitBranch[^}]*\}\s*from\s*"lucide-react"/);
	// 读取 branch = props.branchByProject?.[project.id]
	assert.match(src, /const\s+branch\s*=\s*props\.branchByProject\?\.\[project\.id\]/);
	// 分支标签渲染契约：仅在非 missing 且 branch 存在时渲染
	assert.match(src, /\{branch\s*&&\s*!project\.missing\s*&&\s*\(/);
	// 包含 GitBranch 图标与 truncate 类以防长分支名溢出
	assert.match(src, /<GitBranch\s+size=\{10\}/);
	assert.match(src, /<span\s+className="truncate font-mono">\{branch\}<\/span>/);
	// 包含悬停提示 title
	assert.match(src, /title=\{t\("app\.currentBranch",\s*\{\s*branch\s*\}\)\}/);
});

test("useProjectSync fetches branch for non-worktree projects and exposes setBranchByProject", () => {
	const src = read("src/renderer/src/hooks/useProjectSync.ts");
	// 导出 setBranchByProject 供 App.tsx 联动回写
	assert.match(src, /return\s*\{[^}]*setBranchByProject/);
	// 包含 refreshProjectBranch 函数
	assert.match(src, /async function refreshProjectBranch\(projectId:\s*string\)/);
	// refreshProjects 遍历项目拉取普通项目分支
	assert.match(src, /void refreshProjectBranch\(p\.id\)/);
	// refreshProjectTree 在普通项目刷新时更新分支
	assert.match(src, /await refreshProjectBranch\(latestProject\.id\)/);
});

test("App.tsx synchronizes branch changes to branchByProject", () => {
	const src = read("src/renderer/src/App.tsx");
	// 解构 setBranchByProject
	assert.match(src, /const\s*\{[^}]*setBranchByProject[^}]*\}\s*=\s*useProjectSync/);
	// handleProjectGitChanged 回写 setBranchByProject
	assert.match(
		src,
		/setBranchByProject\(\(prev\)\s*=>\s*\(prev\[projectId\]\s*===\s*info\.current\s*\?\s*prev\s*:\s*\{\s*\.\.\.prev,\s*\[projectId\]:\s*info\.current\s*\}\)\)/,
	);
});
