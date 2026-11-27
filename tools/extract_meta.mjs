// 批量提取插件 meta，并按 id 去重
// 用法：node extract_meta.mjs
import fs from "node:fs";
import path from "node:path";

const POOL = "pool";

// 从源码里截出 `export const meta = { ... };` 那一段（按花括号配平）
function sliceMeta(src) {
  const m = src.match(/export\s+const\s+meta\s*=\s*\{/);
  if (!m) return null;
  let i = m.index + m[0].length - 1; // 指向 '{'
  let depth = 0;
  let inStr = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (inStr) {
      if (c === "\\") { j++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  return null;
}

// 只取顶层标量字段，避免误抓嵌套里的同名键
function pick(block, key) {
  const re = new RegExp(`(?:^|[,{\\s])${key}\\s*:\\s*(['"\`])([^'"\`]*)\\1`, "m");
  const r = block.match(re);
  return r ? r[2] : "";
}
function pickNum(block, key) {
  const re = new RegExp(`(?:^|[,{\\s])${key}\\s*:\\s*(\\d+)`, "m");
  const r = block.match(re);
  return r ? Number(r[1]) : 0;
}

const rows = [];
for (const repo of fs.readdirSync(POOL)) {
  const dir = path.join(POOL, repo);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const p = path.join(dir, f);
    const src = fs.readFileSync(p, "utf8");
    const block = sliceMeta(src);
    if (!block) { rows.push({ repo, file: f, id: "", err: "无 meta" }); continue; }
    rows.push({
      repo, file: f,
      id: pick(block, "id"),
      name: pick(block, "name"),
      version: pick(block, "version"),
      kind: pick(block, "kind"),
      protocol: pickNum(block, "protocol"),
      bytes: src.length,
      path: p,
    });
  }
}

rows.sort((a, b) => (a.id || "zz").localeCompare(b.id || "zz"));

// 去重：同 id 按「我自建 > 修复版 > 体积」优先，最后才比字节数
const REPO_RANK = { leohenshuai: 2, coderl98: 1, poisonhs: 1, skfunghk: 1, beihaisir: 1 };
const byId = new Map();
for (const r of rows) {
  if (!r.id) continue;
  if (r.id === "huangguo") continue; // 自建 v4.1 单独处理，不参与比较
  const prev = byId.get(r.id);
  if (!prev) { byId.set(r.id, r); continue; }
  const a = REPO_RANK[r.repo] || 0;
  const b = REPO_RANK[prev.repo] || 0;
  if (a > b || (a === b && r.bytes > prev.bytes)) byId.set(r.id, r);
}

console.log("== 全部条目 ==");
for (const r of rows) {
  console.log([r.id || "(无)", r.name || "-", r.version || "-", r.kind || "-", `p${r.protocol}`, `${r.bytes}B`, `${r.repo}/${r.file}`].join("\t"));
}
console.log("\n== 去重后 ==");
console.log(`原始 ${rows.length} 个，有效 meta ${rows.filter(r => r.id).length} 个，唯一 id ${byId.size} 个`);

fs.writeFileSync("pool_meta.json", JSON.stringify({ all: rows, unique: [...byId.values()] }, null, 2));
console.log("已写 pool_meta.json");
