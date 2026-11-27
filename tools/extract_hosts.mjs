// 从插件源码提取站点域名，供探活使用
import fs from "node:fs";
import path from "node:path";

const meta = JSON.parse(fs.readFileSync("pool_meta.json", "utf8"));
const out = [];

for (const r of meta.unique) {
  const src = fs.readFileSync(r.path, "utf8");
  const hosts = new Set();
  // 抓所有 https://xxx 形式的域名
  for (const m of src.matchAll(/https?:\/\/([a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/g)) {
    const h = m[1].toLowerCase();
    // 排除通用 CDN / 统计 / 第三方，只留业务域名
    if (/^(www\.)?(google|gstatic|cloudflare|jsdelivr|unpkg|cdnjs|fonts|ajax|img|static)\./.test(h)) continue;
    if (/\.(jpg|png|gif|webp|css|js)$/.test(h)) continue;
    hosts.add(h.replace(/^www\./, ""));
  }
  out.push({ id: r.id, name: r.name, hosts: [...hosts].slice(0, 4), path: r.path });
}
fs.writeFileSync("pool_hosts.json", JSON.stringify(out, null, 2));
console.log(`提取 ${out.length} 个插件的域名`);
for (const o of out) console.log(`${o.id}\t${o.hosts.join(" ") || "(无)"}`);
