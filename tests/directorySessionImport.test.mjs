import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const core = loadTsCommonJs("src/main/sessions/directorySessionImport.ts");
const { DirectorySessionImporter } = loadTsCommonJs("src/main/sessions/DirectorySessionImporter.ts");

const CONTAINER_DIR = "C:/Users/me/.pi/agent/sessions";
const GROUP_DIR = `${CONTAINER_DIR}/--d--work-old--`;
const PROJECT_DIR = "D:/work/old";
const SESSION_FILE = `${GROUP_DIR}/2026-01-01T10-00-00-000Z_abc.jsonl`;

function scanSummary(filePath, overrides = {}) {
	return {
		id: filePath,
		filePath,
		preview: "",
		updatedAt: 1_700_000_000_000,
		messageCount: 4,
		...overrides,
	};
}

/**
 * VM 里创建的对象/数组与测试上下文不同源，strict 模式的 deepEqual 会因原型不同而失败。
 * 比较结构化结果前先过一遍 JSON 序列化，只比数据本身。
 */
function plain(value) {
	return JSON.parse(JSON.stringify(value));
}

/** 目录导入测试台：全量会话清单 / 目录形态 / catalog 已知路径 / 合并写入全部可控。 */
function createImporter() {
	const state = {
		sessions: [],
		shape: { hasJsonl: false, hasEncodedGroups: false },
		known: new Set(),
		names: new Map(),
		existing: new Set(),
		existsCalls: [],
		merged: [],
		mergeCalls: [],
		mergeError: null,
		errors: [],
	};
	const importer = new DirectorySessionImporter({
		listSessions: async () => state.sessions,
		readSessionName: async (filePath) => state.names.get(filePath),
		readDirectoryShape: async () => state.shape,
		listKnownFilePaths: () => state.known,
		mergeScanned: async (projectId, summaries, options) => {
			state.mergeCalls.push({ projectId, summaries, options });
			if (state.mergeError) throw state.mergeError;
			state.merged.push(...summaries.map((summary) => summary.filePath));
		},
		pathExists: async (path) => {
			state.existsCalls.push(path);
			return state.existing.has(path.toLowerCase());
		},
		onError: (sourcePath, error) => state.errors.push({ sourcePath, error }),
	});
	return { importer, state };
}

test("normalizeSessionPathKey 统一分隔符与大小写", () => {
	assert.equal(core.normalizeSessionPathKey("C:\\Users\\Me\\Proj\\"), "c:/users/me/proj");
});

test("isPathInsideRoots 判定包含关系且不受大小写/分隔符影响", () => {
	assert.equal(core.isPathInsideRoots("c:\\Users\\me\\.pi\\agent\\sessions\\a.jsonl", [CONTAINER_DIR]), true);
	assert.equal(core.isPathInsideRoots("C:\\Windows\\system32\\a.jsonl", [CONTAINER_DIR]), false);
	// 前缀相近但不是子目录（root 为 .../proj 时 .../proj2 不算命中）
	assert.equal(core.isPathInsideRoots("D:/work/proj2/a.jsonl", ["D:/work/proj"]), false);
});

test("isSessionContainerProbe 认 sessions 根与分组目录", () => {
	assert.equal(core.isSessionContainerProbe({ hasEncodedGroups: true, hasJsonl: false }), true);
	assert.equal(core.isSessionContainerProbe({ hasEncodedGroups: false, hasJsonl: true }), true);
	assert.equal(core.isSessionContainerProbe({ hasEncodedGroups: false, hasJsonl: false }), false);
});

test("isSameDirectory 只比较同一目录（大小写/分隔符归一）", () => {
	assert.equal(core.isSameDirectory("D:\\work\\old", "d:/work/old/"), true);
	assert.equal(core.isSameDirectory("D:/work/old", "D:/work/other"), false);
	assert.equal(core.isSameDirectory(undefined, "D:/work/old"), false);
});

test("isDirectoryImportCandidate：选定会话容器时只收目录内的会话文件", () => {
	const inside = scanSummary(SESSION_FILE, { projectPath: "D:\\work\\old" });
	const outside = scanSummary(`${CONTAINER_DIR}/--d--work-other--/x.jsonl`, {
		projectPath: "D:\\work\\other",
	});
	// 选定目录是分组目录：原目录就算同名，只要文件不在目录内也不算候选
	const sameCwdOutside = scanSummary(`${CONTAINER_DIR}/--d--work-old--2/x.jsonl`, {
		projectPath: "D:\\work\\old",
	});
	assert.equal(
		core.isDirectoryImportCandidate({ summary: inside, dir: GROUP_DIR, pickedIsContainer: true }),
		true,
	);
	assert.equal(
		core.isDirectoryImportCandidate({ summary: outside, dir: GROUP_DIR, pickedIsContainer: true }),
		false,
	);
	assert.equal(
		core.isDirectoryImportCandidate({
			summary: sameCwdOutside,
			dir: GROUP_DIR,
			pickedIsContainer: true,
		}),
		false,
	);
});

test("isDirectoryImportCandidate：选定项目目录时按会话记录里的原工作目录匹配", () => {
	const moved = scanSummary(SESSION_FILE, { projectPath: "D:\\work\\old" });
	const other = scanSummary(`${CONTAINER_DIR}/--d--work-other--/y.jsonl`, {
		projectPath: "D:\\work\\other",
	});
	assert.equal(
		core.isDirectoryImportCandidate({ summary: moved, dir: PROJECT_DIR, pickedIsContainer: false }),
		true,
	);
	assert.equal(
		core.isDirectoryImportCandidate({ summary: other, dir: PROJECT_DIR, pickedIsContainer: false }),
		false,
	);
	// 没有原目录信息的会话不能靠项目目录匹配进来
	assert.equal(
		core.isDirectoryImportCandidate({
			summary: scanSummary(SESSION_FILE),
			dir: PROJECT_DIR,
			pickedIsContainer: false,
		}),
		false,
	);
});

test("toDirectorySessionSummary 映射标题回退与入册状态", () => {
	const fresh = plain(
		core.toDirectorySessionSummary({
			summary: scanSummary(SESSION_FILE),
			projectPath: "D:\\work\\old",
			projectPathExists: false,
			alreadyImported: false,
		}),
	);
	assert.equal(fresh.title, "2026-01-01T10-00-00-000Z_abc");
	assert.equal(fresh.status, "new");
	assert.equal(fresh.projectPath, "D:\\work\\old");
	assert.equal(fresh.projectPathExists, false);

	const known = plain(
		core.toDirectorySessionSummary({
			summary: scanSummary(SESSION_FILE, { name: "  重构计划  " }),
			projectPathExists: true,
			alreadyImported: true,
		}),
	);
	assert.equal(known.title, "重构计划");
	assert.equal(known.status, "current");
	assert.equal(known.projectPath, undefined);
});

test("scan 只收选定目录的会话、回读标题、标注原目录存在性与入册状态", async () => {
	const { importer, state } = createImporter();
	state.shape = { hasJsonl: true, hasEncodedGroups: false };
	state.sessions = [
		scanSummary(`${GROUP_DIR}/old-1.jsonl`, {
			projectPath: "D:\\work\\old",
			updatedAt: 10,
		}),
		scanSummary(`${GROUP_DIR}/old-2.jsonl`, {
			projectPath: "D:\\work\\old",
			updatedAt: 30,
		}),
		scanSummary(`${CONTAINER_DIR}/--d--other--/x.jsonl`, {
			projectPath: "D:\\work\\other",
			updatedAt: 20,
		}),
	];
	state.names.set(`${GROUP_DIR}/old-1.jsonl`, "旧会话一");
	state.known = new Set([core.normalizeSessionPathKey(`${GROUP_DIR}/old-2.jsonl`)]);
	state.existing = new Set(["d:\\work\\old"]);

	const rows = plain(await importer.scan(GROUP_DIR));
	assert.deepEqual(
		rows.map((row) => [row.sourcePath.endsWith("old-2.jsonl") ? "old-2" : "old-1", row.title, row.status, row.projectPathExists]),
		[
			["old-2", "old-2", "current", true],
			["old-1", "旧会话一", "new", true],
		],
	);
	// 同一原目录只探测一次存在性
	assert.equal(state.existsCalls.length, 1);
});

test("scan 在选定项目目录时按原工作目录找回历史", async () => {
	const { importer, state } = createImporter();
	state.shape = { hasJsonl: false, hasEncodedGroups: false };
	state.sessions = [
		scanSummary(SESSION_FILE, { projectPath: "D:\\work\\old", name: "移动前的会话" }),
		scanSummary(`${CONTAINER_DIR}/--d--work-other--/y.jsonl`, { projectPath: "D:\\work\\other" }),
	];
	// 原目录已不存在（典型「目录被移动/改名」）
	const rows = plain(await importer.scan(PROJECT_DIR));
	assert.deepEqual(
		rows.map((row) => [row.title, row.projectPathExists]),
		[["移动前的会话", false]],
	);
});

test("scan 截断到上限条数（按时间倒序保留最新的）", async () => {
	const { importer, state } = createImporter();
	state.shape = { hasJsonl: true, hasEncodedGroups: false };
	state.sessions = Array.from({ length: core.DIRECTORY_IMPORT_MAX_SUMMARIES + 20 }, (_, index) =>
		scanSummary(`${GROUP_DIR}/s-${index}.jsonl`, { updatedAt: index }),
	);
	const rows = await importer.scan(GROUP_DIR);
	assert.equal(rows.length, core.DIRECTORY_IMPORT_MAX_SUMMARIES);
	// 最新的一条（updatedAt 最大）必须留下
	assert.equal(rows[0].sourcePath, `${GROUP_DIR}/s-${core.DIRECTORY_IMPORT_MAX_SUMMARIES + 19}.jsonl`);
});

test("import 把候选摘要并入目标项目（一次 mergeScanned，幂等）", async () => {
	const { importer, state } = createImporter();
	state.shape = { hasJsonl: true, hasEncodedGroups: false };
	state.sessions = [
		scanSummary(`${GROUP_DIR}/a.jsonl`, { name: "会话 A" }),
		scanSummary(`${GROUP_DIR}/b.jsonl`, { name: "会话 B" }),
	];

	const report = await importer.import("project-1", GROUP_DIR, [
		`${GROUP_DIR}/a.jsonl`,
		`${GROUP_DIR}/b.jsonl`,
	]);
	assert.equal(report.imported, 2);
	assert.equal(report.failed, 0);
	assert.equal(state.mergeCalls.length, 1);
	assert.equal(state.mergeCalls[0].projectId, "project-1");
	assert.deepEqual(state.merged, [`${GROUP_DIR}/a.jsonl`, `${GROUP_DIR}/b.jsonl`]);
	assert.deepEqual(
		plain(report.results).map((result) => result.title),
		["会话 A", "会话 B"],
	);
	// 手动导入必须钉住归属，否则旧目录对应的项目刷新时会把会话抢回去。
	assert.equal(state.mergeCalls[0].options?.manualAssignment, true);
});

test("import 拒绝伪造/越界路径（不在候选清单里）", async () => {
	const { importer, state } = createImporter();
	state.shape = { hasJsonl: true, hasEncodedGroups: false };
	state.sessions = [
		scanSummary(`${GROUP_DIR}/real.jsonl`),
		// 会话清单里的越权路径：不在选定目录内，必须被候选判定挡住
		scanSummary("C:/Windows/system32/evil.jsonl", { projectPath: "D:\\work\\other" }),
	];

	const report = await importer.import("project-1", GROUP_DIR, [
		`${GROUP_DIR}/real.jsonl`,
		"C:/Windows/system32/evil.jsonl",
		`${GROUP_DIR}/never-scanned.jsonl`,
	]);
	assert.equal(report.imported, 1);
	assert.equal(report.failed, 2);
	assert.deepEqual(state.merged, [`${GROUP_DIR}/real.jsonl`]);
	assert.equal(
		plain(report.results).filter((result) => result.error === "SESSION_NOT_IN_DIRECTORY").length,
		2,
	);
});

test("import 在 catalog 写入失败时全部记为失败并回调上报", async () => {
	const { importer, state } = createImporter();
	state.shape = { hasJsonl: true, hasEncodedGroups: false };
	state.sessions = [scanSummary(`${GROUP_DIR}/a.jsonl`), scanSummary(`${GROUP_DIR}/b.jsonl`)];
	state.mergeError = new Error("catalog write failed");

	const report = await importer.import("project-1", GROUP_DIR, [
		`${GROUP_DIR}/a.jsonl`,
		`${GROUP_DIR}/b.jsonl`,
	]);
	assert.equal(report.imported, 0);
	assert.equal(report.failed, 2);
	assert.equal(state.errors.length, 1);
	// 跨 VM 的 Error 不是同一 realm 的实例，只断言消息内容被带回。
	assert.match(plain(report.results)[0].error, /catalog write failed/);
});

test("import 空选择不做任何清单读取与写入", async () => {
	const { importer, state } = createImporter();
	const report = await importer.import("project-1", GROUP_DIR, []);
	assert.equal(report.imported, 0);
	assert.equal(report.failed, 0);
	assert.deepEqual(plain(report.results), []);
	assert.equal(state.mergeCalls.length, 0);
	assert.equal(state.existsCalls.length, 0);
});
