import fs from "node:fs";
const seeds = JSON.parse(fs.readFileSync("builtin_manifest.json", "utf8"));
const meta = JSON.parse(fs.readFileSync("pool_meta.json", "utf8")).unique;
const m = new Map(meta.map((r) => [r.id, r]));
const mature = [];
for (const s of seeds) {
  const src = fs.readFileSync("HGhub-0.0.5/builtin/" + s.dir + "/plugin.js", "utf8");
  if (/mature:\s*true/.test(src)) mature.push(s.id);
}
const on = seeds.filter((s) => s.enabled);
const off = seeds.filter((s) => !s.enabled);
console.log(`启用 ${on.length} / 停用 ${off.length} / 成人 ${mature.length}`);
const line = (s) => {
  const r = m.get(s.id) || {};
  return `${s.id}\t${r.name || ""}\t${r.version || ""}\t${mature.includes(s.id) ? "成人" : ""}`;
};
console.log("\n--- 启用 ---");
for (const s of on) console.log(line(s));
console.log("\n--- 停用 ---");
for (const s of off) console.log(line(s));
