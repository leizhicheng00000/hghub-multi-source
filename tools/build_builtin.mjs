// 把池子里的插件铺进 builtin/，并生成 Rust 种子表 + 构建期 meta
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const meta = JSON.parse(fs.readFileSync("pool_meta.json", "utf8"));
const probe = JSON.parse(fs.readFileSync("probe_result.json", "utf8"));
const probeById = new Map(probe.map((p) => [p.id, p]));

const ROOT = "HGhub-0.0.5";
const BUILTIN = path.join(ROOT, "builtin");

// 1. 保留我们自己的黄果 v4.1，其余同名 id 全部跳过
const OWN = "huangguo";
// local.kanju：kind 为空，不是常规点播源
// tangxin.vlog：与 leohenshuai 的 tangxin 同站同名，留修复版
const skip = new Set([OWN, "local.kanju", "tangxin.vlog"]);

const seeds = [
  { id: OWN, dir: "huangguo", enabled: true, name: "黄果短剧", note: "自建 v4.1，已修封面解密" },
];

const rows = [];
for (const r of meta.unique) {
  if (skip.has(r.id)) continue;
  const dir = r.id.replace(/[^a-zA-Z0-9._-]/g, "_");
  const dstDir = path.join(BUILTIN, dir);
  fs.mkdirSync(dstDir, { recursive: true });
  const dst = path.join(dstDir, "plugin.js");
  fs.copyFileSync(r.path, dst);

  // 启停判定：首页 200 且真返回内容算活；403 是反爬拦了首页但站点在，也算活
  // （插件请求的是 API，不走首页）。
  const p = probeById.get(r.id);
  const alive = !!p && ((p.code === 200 && (p.bytes || 0) > 400) || p.code === 403);
  seeds.push({ id: r.id, dir, enabled: alive, name: r.name, note: p ? `probe ${p.code}/${p.bytes || 0}B` : "无探活" });
  rows.push({ id: r.id, dir, alive });
}

// 2. 构建期把每个插件的 meta 求值出来，落成 JSON。
//    宿主启动时只解析这份 JSON，不再为每个插件起 QuickJS 去 eval——
//    那一步会执行插件顶层代码，64 个累加足以把启动拖死。
const metas = [];
for (const s of seeds) {
  const src = path.join(BUILTIN, s.dir, "plugin.js");
  let obj = null;
  try {
    const mod = await import(pathToFileURL(path.resolve(src)).href + "?v=" + Date.now());
    obj = mod.meta;
  } catch (e) {
    console.error(`  ! ${s.id} 无法 import 取 meta：${e.message.split("\n")[0]}`);
  }
  if (!obj) throw new Error(`插件 ${s.id} 没有 meta，无法生成清单`);

  // 只留 Meta 认识的字段，camelCase 与 #[serde(rename_all = "camelCase")] 对齐
  const pick = ["id", "name", "version", "protocol", "kind", "description", "author",
    "homepage", "updateUrl", "matches", "linkDomains", "defaultHeaders", "timeouts",
    "features", "requires", "allowInsecureHttp", "mature", "settings"];
  const out = {};
  for (const k of pick) if (obj[k] !== undefined) out[k] = obj[k];
  if (!out.kind) out.kind = "source";
  if (!out.protocol) out.protocol = 1;
  if (out.id !== s.id) throw new Error(`meta.id(${out.id}) 与目录(${s.id}) 不一致`);
  metas.push(out);
}
fs.writeFileSync(path.join(BUILTIN, "builtin_meta.json"), JSON.stringify(metas));

// 3. 生成 Rust 种子表
const lines = [];
lines.push("//! 由脚本生成的随包插件清单，勿手改。");
lines.push("//!");
lines.push("//! 每项对应 `builtin/<dir>/plugin.js`；`enabled` 只是首次种入时的默认启停，");
lines.push("//! 之后以用户自己的 index.json 为准。");
lines.push("");
lines.push("pub struct Seed {");
lines.push("    pub id: &'static str,");
lines.push("    pub code: &'static str,");
lines.push("    pub enabled: bool,");
lines.push("}");
lines.push("");
lines.push(`/// 随包插件：${seeds.length} 个（默认启用 ${seeds.filter((s) => s.enabled).length} 个）`);
lines.push("pub const SEEDS: &[Seed] = &[");
for (const s of seeds) {
  lines.push(`    Seed { id: ${JSON.stringify(s.id)}, code: include_str!("../../builtin/${s.dir}/plugin.js"), enabled: ${s.enabled} },`);
}
lines.push("];");
lines.push("");
fs.writeFileSync(path.join(ROOT, "src-tauri/src/builtin_seeds.rs"), lines.join("\n"));

// 3. 清单
fs.writeFileSync("builtin_manifest.json", JSON.stringify(seeds, null, 2));

console.log(`铺入 ${seeds.length - 1} 个外部插件 + 黄果 = ${seeds.length}`);
console.log(`默认启用 ${seeds.filter((s) => s.enabled).length} 个：`);
for (const s of seeds.filter((x) => x.enabled)) console.log(`  ✓ ${s.id.padEnd(20)} ${s.name}  ${s.note}`);
console.log(`默认停用 ${seeds.filter((s) => !s.enabled).length} 个：`);
for (const s of seeds.filter((x) => !x.enabled)) console.log(`  · ${s.id.padEnd(20)} ${s.name}  ${s.note}`);
