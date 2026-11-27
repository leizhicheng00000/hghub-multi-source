// 复刻 Rust 侧 Meta::parse 的全部校验，提前找出会被拒的条目
import fs from "node:fs";

const metas = JSON.parse(fs.readFileSync("HGhub-0.0.5/builtin/builtin_meta.json", "utf8"));

const RESERVED = new Set(["CON", "PRN", "AUX", "NUL"]);
const SETTING_TYPES = new Set(["text", "password", "switch", "number", "select"]);
const problems = [];

function checkVersion(v) {
  const p = String(v).split(".");
  if (p.length !== 3) return `版本号不是三段：${v}`;
  for (const s of p) {
    if (!s || (s.length > 1 && s.startsWith("0")) || !/^\d+$/.test(s)) return `版本段非法：${v}`;
    if (Number(s) > Number.MAX_SAFE_INTEGER) return `版本段过大：${v}`;
  }
  return null;
}

for (const m of metas) {
  const errs = [];
  const id = m.id ?? "";
  const b = Buffer.from(id, "utf8");
  if (!b.length || b.length > 64) errs.push("id 长度非法");
  else if (!/^[a-z0-9]/.test(id)) errs.push("id 首字符必须小写字母或数字");
  else if (!/^[a-z0-9._-]+$/.test(id)) errs.push("id 含非法字符");
  const stem = id.split(".")[0].toUpperCase();
  if (RESERVED.has(stem) || (stem.length === 4 && /^(COM|LPT)\d$/.test(stem))) errs.push("id 用了 Windows 保留名");
  if (id.endsWith(".")) errs.push("id 以点结尾");

  if (!String(m.name ?? "").trim()) errs.push("name 为空");
  if ([...(m.name ?? "")].length > 60) errs.push(`name 超过 60 字符（${[...m.name].length}）`);
  if ([...(m.description ?? "")].length > 500) errs.push(`description 超过 500 字符（${[...m.description].length}）`);

  const ve = checkVersion(m.version);
  if (ve) errs.push(ve);

  if (m.protocol !== 1) errs.push(`protocol 必须为 1，实际 ${m.protocol}`);
  if (m.kind !== "source" && m.kind !== "resolver") errs.push(`kind 非法：${m.kind}`);
  if (m.kind === "resolver" && !(m.matches || []).length) errs.push("resolver 缺 matches");

  const keys = new Set();
  for (const s of m.settings || []) {
    const k = s?.key;
    if (typeof k !== "string" || !k) { errs.push("设置项缺 key"); break; }
    if (keys.has(k)) { errs.push(`设置项 key 重复：${k}`); break; }
    keys.add(k);
    if (typeof s.label !== "string") { errs.push(`设置项 ${k} 缺 label`); break; }
    if (!SETTING_TYPES.has(s.type)) { errs.push(`设置项 ${k} 类型非法：${s.type}`); break; }
  }

  for (const [k, v] of Object.entries(m.timeouts || {})) {
    if (typeof v !== "number" || !Number.isFinite(v)) errs.push(`timeouts.${k} 非有限数`);
  }

  // defaultHeaders 必须是 string→string
  for (const [k, v] of Object.entries(m.defaultHeaders || {})) {
    if (typeof v !== "string") errs.push(`defaultHeaders.${k} 不是字符串`);
  }

  if (errs.length) problems.push({ id, errs });
}

if (!problems.length) console.log(`✓ ${metas.length} 条 meta 全部通过 Meta::parse 的校验规则`);
else {
  console.log(`✗ ${problems.length} 条有问题：`);
  for (const p of problems) console.log(`  ${p.id}: ${p.errs.join(" / ")}`);
}
