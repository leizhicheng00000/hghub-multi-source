// 批量语法检查 + 宿主 API 依赖统计
// 只 import 模块拿 meta，不执行 default 工厂（工厂需要完整 hg，容易误报）
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const meta = JSON.parse(fs.readFileSync("pool_meta.json", "utf8"));

const apis = ["http", "crypto", "codec", "html", "settings", "storage", "log", "webview", "cookies", "endpoint", "env", "PluginError", "media"];
const report = [];

for (const r of meta.unique) {
  const src = fs.readFileSync(r.path, "utf8");
  const used = apis.filter((a) => new RegExp(`hg\\.${a}\\b`).test(src));
  let syntaxOk = true, err = "";
  try {
    await import(pathToFileURL(path.resolve(r.path)).href + "?t=" + Date.now());
  } catch (e) {
    syntaxOk = false;
    err = (e.message || String(e)).split("\n")[0].slice(0, 90);
  }
  report.push({ id: r.id, name: r.name, syntaxOk, err, used, path: r.path, hasHome: /home\s*:/.test(src) });
}

report.sort((a, b) => Number(a.syntaxOk) - Number(b.syntaxOk) || a.id.localeCompare(b.id));
for (const r of report) {
  console.log([r.id.padEnd(20), r.syntaxOk ? "OK " : "ERR", r.hasHome ? "home" : "----", r.used.join(","), r.err].join("  "));
}
const bad = report.filter((r) => !r.syntaxOk);
console.log(`\n语法通过 ${report.length - bad.length}/${report.length}`);
fs.writeFileSync("syntax_report.json", JSON.stringify(report, null, 2));
