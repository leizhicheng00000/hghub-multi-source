// 并发探活：每站 GET / ，最多跟 3 次跳转
import fs from "node:fs";
import https from "node:https";
import http from "node:http";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
const list = JSON.parse(fs.readFileSync("pool_hosts.json", "utf8"));

function hit(url, hops = 0) {
  return new Promise((resolve) => {
    if (hops > 3) return resolve({ code: 0, url, note: "跳转过多" });
    let u;
    try { u = new URL(url); } catch { return resolve({ code: 0, url, note: "URL 非法" }); }
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      { hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + u.search, method: "GET", headers: { "User-Agent": UA, Accept: "text/html,*/*" }, timeout: 12000, rejectUnauthorized: false },
      (res) => {
        const loc = res.headers.location;
        if (loc && res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          const next = loc.startsWith("http") ? loc : new URL(loc, url).href;
          return resolve(hit(next, hops + 1));
        }
        // 只读前 1KB 判断是否有内容，然后断开
        let got = 0;
        res.on("data", (c) => { got += c.length; if (got > 1024) { res.destroy(); } });
        res.on("end", () => resolve({ code: res.statusCode, url, bytes: got }));
        res.on("close", () => resolve({ code: res.statusCode, url, bytes: got }));
      }
    );
    req.on("timeout", () => { req.destroy(); resolve({ code: -1, url, note: "超时" }); });
    req.on("error", (e) => resolve({ code: 0, url, note: e.code || e.message.slice(0, 24) }));
    req.end();
  });
}

async function run() {
  const q = [...list];
  const out = [];
  const worker = async () => {
    while (q.length) {
      const item = q.shift();
      const host = item.hosts[0];
      if (!host) { out.push({ id: item.id, host: "", code: 0, note: "无域名" }); continue; }
      const r = await hit(`https://${host}/`);
      out.push({ id: item.id, host, ...r });
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));
  out.sort((a, b) => (b.code === 200 ? 1 : 0) - (a.code === 200 ? 1 : 0) || a.id.localeCompare(b.id));
  fs.writeFileSync("probe_result.json", JSON.stringify(out, null, 2));
  for (const o of out) {
    const finalHost = (() => { try { return new URL(o.url).hostname; } catch { return "-"; } })();
    console.log([o.id.padEnd(20), String(o.code).padEnd(5), o.host.padEnd(28), finalHost.padEnd(28), o.note || `${o.bytes || 0}B`].join(" "));
  }
  const alive = out.filter((o) => o.code === 200);
  console.log(`\n合计 ${out.length} 个，200 存活 ${alive.length} 个`);
}
run();
