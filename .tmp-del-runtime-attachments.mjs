// 一次性脚本：仅删除 AtomGit v0.7.5 Release 上的 dsh-runtime-* 旧附件，
// 保留安装包等其他附件（配合 sync-release-to-atomgit.mjs 增量同步做「定向替换」）。
const base = "https://api.atomgit.com/api/v5";
const repo = "ayuayue/PiDeck";
const tag = "v0.7.5";
const token = process.env.ATOMGIT_TOKEN;
if (!token) {
  console.error("缺少 ATOMGIT_TOKEN 环境变量");
  process.exit(1);
}
const withToken = (url) => `${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;

const listRes = await fetch(
  withToken(`${base}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`),
  { signal: AbortSignal.timeout(60_000) },
);
if (!listRes.ok) {
  console.error(`读取 Release 失败: HTTP ${listRes.status}`);
  process.exit(1);
}
const rel = await listRes.json();
const runtimeAssets = (rel.assets || []).filter((a) => a.type === "attach" && a.name.startsWith("dsh-runtime-"));
console.log(`AtomGit 上 dsh-runtime-* 附件: ${runtimeAssets.length} 个，全部删除（稍后增量重传新包）`);
let ok = 0;
for (const a of runtimeAssets) {
  if (!a.id) {
    console.error(`⚠️ ${a.name} 无 id，无法删除`);
    continue;
  }
  const delRes = await fetch(
    withToken(`${base}/repos/${repo}/releases/${encodeURIComponent(tag)}/attach_files/${a.id}`),
    { method: "DELETE", signal: AbortSignal.timeout(60_000) },
  );
  if (delRes.ok) {
    console.log(`deleted: ${a.name} (id=${a.id})`);
    ok++;
  } else {
    console.error(`DELETE FAIL: ${a.name} HTTP ${delRes.status}`);
  }
}
console.log(`删除完成: ${ok}/${runtimeAssets.length}`);
