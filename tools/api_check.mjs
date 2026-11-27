// 静态检查：插件调用的 hg.* 方法是否都在宿主支持列表内
import fs from "node:fs";

// 宿主 v0.0.5 实际暴露的方法（来自 docs/plugin-protocol/04-host-api.md）
const SUPPORTED = {
  http: new Set(["fetch"]),
  crypto: new Set(["digest", "hmac", "aesEncrypt", "aesDecrypt", "rsaEncrypt", "randomBytes", "randomUUID"]),
  codec: new Set(["base64Encode", "base64Decode", "hexEncode", "hexDecode", "utf8Encode", "utf8Decode", "decodeText"]),
  html: new Set(["parse"]),
  settings: new Set(["get", "getAll"]),
  storage: new Set(["get", "set", "delete", "keys", "clear"]),
  cookies: new Set(["get", "set", "clear"]),
  log: new Set(["debug", "info", "warn", "error"]),
  webview: new Set(["open", "close"]),
  media: new Set([]),
  endpoint: new Set(["url"]),
  env: new Set([]),
};
// HtmlNode 上的方法（hg.html.parse 的返回值）
const NODE_METHODS = new Set(["select", "first", "text", "ownText", "attr", "attrs", "html", "outerHtml", "parent", "children", "next", "prev", "exists", "length"]);

const meta = JSON.parse(fs.readFileSync("pool_meta.json", "utf8"));
const problems = [];

for (const r of meta.unique) {
  const src = fs.readFileSync(r.path, "utf8");
  const bad = new Set();
  // 匹配 hg.<mod>.<method>( 形式
  for (const m of src.matchAll(/\bhg\.([a-zA-Z]+)\.([a-zA-Z_$][\w$]*)\s*\(/g)) {
    const [, mod, fn] = m;
    if (mod === "PluginError") continue;
    const set = SUPPORTED[mod];
    if (!set) { bad.add(`hg.${mod}.* (未知模块)`); continue; }
    if (!set.has(fn)) bad.add(`hg.${mod}.${fn}`);
  }
  if (bad.size) problems.push({ id: r.id, bad: [...bad] });
}

if (!problems.length) console.log("✓ 全部插件只调用了宿主已支持的方法");
else {
  console.log("以下调用可能不被宿主支持：");
  for (const p of problems) console.log(`  ${p.id.padEnd(20)} ${p.bad.join(", ")}`);
}
fs.writeFileSync("api_check.json", JSON.stringify(problems, null, 2));
