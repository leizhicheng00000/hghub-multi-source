/**
 * 黄果短剧 · HPP 内容源插件 v3
 *
 * ── 本版依据（全部为 2026-11 实测，非推测）─────────────────────────────
 *
 * 官方站已从旧域名迁移到 `https://huangguoai.io`，接口结构同时改版：
 *   旧（Worker 时代）          新（官方站）
 *   /api/category/{tid}   →   /api/videos/category/{tid}
 *   /api/detail/{id}      →   /api/videos/{id}
 *   /api/play?url=&ep=    →   /api/videos/{id}/play?ep=
 *   /api/search/{kw}      →   /api/search?q=
 *   /api/chigua           →   /api/posts
 *   响应 {list:[...]}      →   {data:{items,pagination}}
 *
 * 实测确认可用的接口（均返回明文 JSON，无需签名）：
 *   GET /api/videos/category/{tid}?page=&size=&sort=
 *   GET /api/ranks/{hot|recommend|potential}?page=&size=
 *   GET /api/posts?page=&size=&cate=
 *   GET /api/topics?page=&size=
 *   GET /api/search?q=&page=&size=
 *   GET /api/videos/{id}
 *   GET /api/videos/{id}/play?ep=N
 *
 * ── 关于播放（v4 更正 v3 的错误结论，务必看完）────────────────────────
 * v3 曾判定「播放地址与登录态绑定，匿名不下发」——**这个结论是错的**，
 * 错因是端点用错，不是权限问题：
 *
 *   ✗ 错误端点  GET  /api/videos/{id}/play?ep=N
 *     匿名返回 200，但 video_url / video_key / video_iv / media_id 全空。
 *   ✓ 正确端点  POST /api/videos/{id}/episodes/{ep}/playback
 *     走 dx150-edge-v1 的 playback 加密通道，**匿名即可拿到真实 m3u8**。
 *
 * 实测（2026-11-27，作品 12 与 117 均通过）：
 *   {"data":{"streams":{"main":"https://yd-lphu-hls.tjyyjk.cn/videos5/…m3u8?auth_key=…&via=dx150"}}}
 * 该 m3u8 为 38 个分片 / 208 秒的完整正片（AES-128 分片加密，播放器原生支持），
 * 与作品时长字段 207 秒吻合，不是试看片段。
 *
 * => 因此**不需要账号、不需要 Cookie**。设置里的 Cookie 仅作为兜底手段保留。
 *
 * ── dx150-edge-v1 是什么 ─────────────────────────────────────────────
 *   握手：ECDH P-256 → HKDF-SHA256 派生 req/res 双密钥 → AES-256-GCM 双向加密
 *   报文：{v:1,type:'hello',client_pub} → {v:1,type:'call',kid,sid,seq,ts,ciphertext}
 *   内层：{request:{method,path,body(base64),content_type,visitor_id}}
 *   注意：重建会话后 seq 必须从 1 重新开始，ts 需用服务端时钟；
 *   同一会话内 seq 重复会被判定 409 replay。
 *   宿主 hg.crypto 只有 hmac 与 aes，没有 ECDH/HKDF，故下面用 BigInt 手写 P-256。
 */

const DEFAULT_SITE = "https://huangguoai.io";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

/* 封面密钥：直接来自站点自己的 /static/web/js/plugins/crypto-image-protocol.js
     window.CryptoImageProtocol = {decryptEnabled:true,
                                   decryptKey:"f5d965df75336270",
                                   decryptIV:"97b60394abc2fbe1"}
   图床 pic.qnlycc.cn 上的 .jpg 是 AES-128-CBC 密文，不是真 JPEG：
   实测 174816 字节、熵 7.999、前两字节 09 3d，用上面这对密钥解密后
   前 16 字节为 ffd8ffe000104a464946000101000001（标准 JPEG 头）。
   两张不同封面前 640 字节完全相同，也印证了固定头部＋同类密文的特征。 */
const IMG_KEY = "f5d965df75336270";
const IMG_IV = "97b60394abc2fbe1";

const CLASSES = [
  { id: "ai-duanju", label: "AI短剧" },
  { id: "ai-manju", label: "AI漫剧" },
  { id: "ai-huanlian", label: "换脸专区" },
  { id: "ai-mogai", label: "魔改专区" },
  { id: "rank:hot", label: "热播榜" },
  { id: "rank:recommend", label: "推荐榜" },
  { id: "rank:potential", label: "潜力榜" },
  { id: "posts:all", label: "吃瓜·全部" },
  { id: "posts:remen", label: "吃瓜·热门" },
  { id: "posts:yuanchuang", label: "吃瓜·原创" },
];

const SORTS = [
  { id: "latest", label: "最新更新" },
  { id: "hot", label: "当前热播" },
  { id: "original", label: "独家原创" },
];

const SORTABLE = {
  "ai-duanju": 1,
  "ai-manju": 1,
  "ai-huanlian": 1,
  "ai-mogai": 1,
};

export const meta = {
  id: "huangguo",
  name: "黄果短剧",
  version: "4.1.0",
  protocol: 1,
  kind: "source",
  description:
    "黄果短剧点播源（AI短剧/漫剧/吃瓜/榜单/专题）。播放走 dx150 加密通道，匿名可取真实 m3u8，无需登录。",
  author: "local",
  defaultHeaders: { "User-Agent": UA },
  settings: [
    {
      key: "site",
      type: "text",
      label: "站点地址",
      hint: "官方站换域名时改这里，不用重新安装",
      default: DEFAULT_SITE,
    },
    {
      key: "cookie",
      type: "text",
      label: "账号 Cookie（可选，不需要填）",
      hint: "播放已走加密通道，匿名就能取到地址，通常留空即可。仅当某部片子提示取不到地址时，才需要填登录后的 Cookie。",
      default: "",
    },
    {
      key: "cookieAuth",
      type: "text",
      label: "Authorization（可选，不需要填）",
      hint: "一般留空。抓包看到 Bearer Token 时才需要。",
      default: "",
    },
  ],
};

export default function (hg) {
  /* ── 地址 ─────────────────────────────────────────────── */

  function setting(key, fallback) {
    const v = hg.settings.get(key);
    const s = typeof v === "string" ? v.trim() : "";
    return s || fallback || "";
  }

  const site = () => setting("site", DEFAULT_SITE).replace(/\/+$/, "");
  const cookie = () => setting("cookie", "");
  const bearer = () => setting("cookieAuth", "");

  /* ── dx150-edge-v1：P-256 ECDH + HKDF-SHA256 + AES-256-GCM ──────────
     宿主 hg.crypto 只有 hmac 与 aes，没有 ECDH / HKDF。
     所以：P-256 用 BigInt 手写（Jacobian 坐标，全程只做 1 次模逆），
     HKDF 用 hg.crypto.hmac 拼两次，AES-GCM 直接用宿主的 gcm 模式。
     实测在 QuickJS 里一次握手约 30ms 量级，不影响播放体验。 */

  const CURVE = {
    p: 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn,
    a: 0xffffffff00000001000000000000000000000000fffffffffffffffffffffffcn,
    gx: 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
    gy: 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n,
    n: 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n,
  };

  const modP = (x) => ((x % CURVE.p) + CURVE.p) % CURVE.p;

  /* 模幂：用于求逆（费马小定理），只在最后转仿射时调用一次 */
  function modPow(b, e, m) {
    let r = 1n;
    let base = ((b % m) + m) % m;
    while (e > 0n) {
      if (e & 1n) r = (r * base) % m;
      base = (base * base) % m;
      e >>= 1n;
    }
    return r;
  }

  const modInv = (x) => modPow(x, CURVE.p - 2n, CURVE.p);

  const J_INF = { x: 0n, y: 1n, z: 0n };

  /* Jacobian 倍点（曲线 a = -3，用等价式 alpha = 3(X-δ)(X+δ)） */
  function jDouble(p) {
    if (p.z === 0n || p.y === 0n) return J_INF;
    const delta = modP(p.z * p.z);
    const gamma = modP(p.y * p.y);
    const beta = modP(p.x * gamma);
    const alpha = modP(3n * modP(p.x - delta) * modP(p.x + delta));
    const x3 = modP(alpha * alpha - 8n * beta);
    const z3 = modP(modP((p.y + p.z) * (p.y + p.z)) - gamma - delta);
    const y3 = modP(alpha * modP(4n * beta - x3) - 8n * modP(gamma * gamma));
    return { x: x3, y: y3, z: z3 };
  }

  /* Jacobian 加点 */
  function jAdd(p, q) {
    if (p.z === 0n) return q;
    if (q.z === 0n) return p;
    const z1z1 = modP(p.z * p.z);
    const z2z2 = modP(q.z * q.z);
    const u1 = modP(p.x * z2z2);
    const u2 = modP(q.x * z1z1);
    const s1 = modP(p.y * q.z * z2z2);
    const s2 = modP(q.y * p.z * z1z1);
    if (u1 === u2) return s1 === s2 ? jDouble(p) : J_INF;
    const h = modP(u2 - u1);
    const i = modP(4n * h * h);
    const j = modP(h * i);
    const r = modP(2n * (s2 - s1));
    const v = modP(u1 * i);
    const x3 = modP(r * r - j - 2n * v);
    const y3 = modP(r * modP(v - x3) - 2n * s1 * j);
    const z3 = modP(2n * p.z * q.z * h);
    return { x: x3, y: y3, z: z3 };
  }

  function jToAffine(p) {
    if (p.z === 0n) return null;
    const zi = modInv(p.z);
    const zi2 = modP(zi * zi);
    return { x: modP(p.x * zi2), y: modP(p.y * zi2 * zi) };
  }

  /* 标量乘：返回仿射坐标，无穷远点返回 null */
  function pointMul(k, pt) {
    let r = J_INF;
    let add = { x: pt.x, y: pt.y, z: 1n };
    let e = k;
    while (e > 0n) {
      if (e & 1n) r = jAdd(r, add);
      add = jDouble(add);
      e >>= 1n;
    }
    return jToAffine(r);
  }

  function bigFromBytes(u8) {
    let v = 0n;
    for (let i = 0; i < u8.length; i++) v = (v << 8n) | BigInt(u8[i]);
    return v;
  }

  function bigToBytes(v, len) {
    const out = new Uint8Array(len);
    let x = v;
    for (let i = len - 1; i >= 0; i--) {
      out[i] = Number(x & 0xffn);
      x >>= 8n;
    }
    return out;
  }

  const B64ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function b64encode(u8, urlSafe) {
    let out = "";
    for (let i = 0; i < u8.length; i += 3) {
      const rem = u8.length - i;
      const n = (u8[i] << 16) | ((rem > 1 ? u8[i + 1] : 0) << 8) | (rem > 2 ? u8[i + 2] : 0);
      out += B64ABC[(n >> 18) & 63] + B64ABC[(n >> 12) & 63];
      out += rem > 1 ? B64ABC[(n >> 6) & 63] : "=";
      out += rem > 2 ? B64ABC[n & 63] : "=";
    }
    return urlSafe ? out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : out;
  }

  function b64decode(text, urlSafe) {
    let t = String(text || "");
    if (urlSafe) t = t.replace(/-/g, "+").replace(/_/g, "/");
    t = t.replace(/[^A-Za-z0-9+/]/g, "");
    const out = new Uint8Array(Math.ceil((t.length * 3) / 4));
    let o = 0;
    let buf = 0;
    let bits = 0;
    for (let i = 0; i < t.length; i++) {
      buf = (buf << 6) | B64ABC.indexOf(t.charAt(i));
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[o++] = (buf >> bits) & 0xff;
      }
    }
    return out.subarray(0, o);
  }

  function concatBytes(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  const toU8 = (x) => (x instanceof Uint8Array ? x : new Uint8Array(x));
  const enc8 = (s) => new TextEncoder().encode(String(s));

  function hmacSha256(key, data) {
    return toU8(hg.crypto.hmac("sha256", toU8(key), toU8(data)));
  }

  /* HKDF-SHA256 单块 32 字节输出（AES-256 密钥长度正好） */
  function hkdf32(ikm, salt, info) {
    const prk = hmacSha256(salt, ikm);
    return hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
  }

  const DX_PROTO = "dx150-edge-v1";
  const DX_EP = {
    playback: "/api/playback/request",
    public: "/api/public/request",
    user: "/api/user/request",
    dynamic: "/api/dynamic/request",
  };

  /* 会话缓存：按 scope 各一份，过期前复用，避免每次播放都握手 */
  const dxSessions = {};

  async function postJson(url, obj, ctx) {
    const res = await hg.http.fetch({
      url: url,
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Accept: "application/json",
        Referer: site() + "/",
      },
      body: { json: obj },
      responseType: "json",
      timeoutMs: 15000,
      retry: 1,
      maxBytes: 4 * 1024 * 1024,
      signal: ctx && ctx.signal,
    });
    if (!res || !res.ok) {
      throw new hg.PluginError(
        "UPSTREAM_UNAVAILABLE",
        "加密通道请求失败（HTTP " + (res ? res.status : "无响应") + "）"
      );
    }
    return res.data;
  }

  async function dxOpen(scope, ctx) {
    /* 私钥规整到 [1, n-1] */
    let d = bigFromBytes(toU8(hg.crypto.randomBytes(32))) % CURVE.n;
    if (d === 0n) d = 1n;
    const pubPt = pointMul(d, { x: CURVE.gx, y: CURVE.gy });
    /* 未压缩点格式：04 || X(32) || Y(32) */
    const pubRaw = concatBytes(
      new Uint8Array([4]),
      concatBytes(bigToBytes(pubPt.x, 32), bigToBytes(pubPt.y, 32))
    );

    const hello = await postJson(
      site() + DX_EP[scope],
      { v: 1, type: "hello", client_pub: b64encode(pubRaw, true) },
      ctx
    );
    if (!hello || hello.type !== "hello" || !hello.server_pub || !hello.salt) {
      throw new hg.PluginError("UPSTREAM_CHANGED", "加密握手响应无效，站点协议可能又改了");
    }

    const srv = b64decode(hello.server_pub, true);
    const sharedPt = pointMul(d, {
      x: bigFromBytes(srv.subarray(1, 33)),
      y: bigFromBytes(srv.subarray(33, 65)),
    });
    if (!sharedPt) throw new hg.PluginError("UPSTREAM_CHANGED", "加密握手失败（共享密钥为无穷远点）");

    /* ECDH 共享密钥取 X 坐标 */
    const shared = bigToBytes(sharedPt.x, 32);
    const salt = b64decode(hello.salt, true);
    const info = [DX_PROTO, scope, hello.site, hello.kid, hello.sid].join("\n");

    const now = Math.floor(Date.now() / 1000);
    const sess = {
      kid: hello.kid,
      sid: hello.sid,
      info: info,
      off: hello.server_time - now,
      exp: now + hello.expires_at - hello.server_time,
      seq: 0,
      reqKey: hkdf32(shared, salt, enc8(info + "\nreq")),
      resKey: hkdf32(shared, salt, enc8(info + "\nres")),
    };
    dxSessions[scope] = sess;
    return sess;
  }

  async function dxCall(scope, method, path, bodyObj, ctx) {
    let s = dxSessions[scope];
    if (!s || s.exp <= Math.floor(Date.now() / 1000) + 5) s = await dxOpen(scope, ctx);

    const seq = ++s.seq;
    const ts = Math.floor(Date.now() / 1000) + s.off;

    /* nonce 12 字节：前 8 字节为 0，后 4 字节是 seq 大端 */
    const iv = new Uint8Array(12);
    iv[8] = (seq >>> 24) & 0xff;
    iv[9] = (seq >>> 16) & 0xff;
    iv[10] = (seq >>> 8) & 0xff;
    iv[11] = seq & 0xff;

    const aad = (dir) => enc8(s.info + "\n" + dir + "\n" + seq + "\n" + ts);

    const packet = {
      method: method,
      path: path,
      body: bodyObj === undefined ? "" : b64encode(enc8(JSON.stringify(bodyObj)), false),
      content_type: bodyObj === undefined ? "" : "application/json",
      visitor_id: "",
    };

    const cipher = toU8(
      hg.crypto.aesEncrypt(
        { mode: "gcm", key: s.reqKey, iv: iv, aad: aad("req") },
        enc8(JSON.stringify({ request: packet }))
      )
    );

    const out = await postJson(
      site() + DX_EP[scope],
      {
        v: 1,
        type: "call",
        kid: s.kid,
        sid: s.sid,
        seq: seq,
        ts: ts,
        ciphertext: b64encode(cipher, true),
      },
      ctx
    );

    if (!out || !out.ciphertext) {
      /* 会话失效就清掉，下次自动重新握手 */
      delete dxSessions[scope];
      throw new hg.PluginError("UPSTREAM_UNAVAILABLE", "加密通道返回异常：" + JSON.stringify(out).slice(0, 120));
    }

    let plain;
    try {
      plain = toU8(
        hg.crypto.aesDecrypt(
          { mode: "gcm", key: s.resKey, iv: iv, aad: aad("res") },
          b64decode(out.ciphertext, true)
        )
      );
    } catch (e) {
      delete dxSessions[scope];
      throw new hg.PluginError("UPSTREAM_CHANGED", "加密响应解密失败，站点协议可能已升级");
    }

    const inner = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
    const bodyBytes = inner.body ? b64decode(inner.body, false) : new Uint8Array(0);
    return {
      status: inner.status,
      body: new TextDecoder("utf-8").decode(bodyBytes),
    };
  }

  /* ── 请求 ─────────────────────────────────────────────── */

  function headers() {
    const h = {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      Referer: site() + "/",
    };
    const c = cookie();
    if (c) h.Cookie = c;
    const b = bearer();
    if (b) h.Authorization = /^Bearer /i.test(b) ? b : "Bearer " + b;
    return h;
  }

  async function getJson(url, ctx) {
    let res;
    try {
      res = await hg.http.fetch({
        url: url,
        method: "GET",
        headers: headers(),
        responseType: "json",
        timeoutMs: 15000,
        retry: 1,
        maxBytes: 8 * 1024 * 1024,
        signal: ctx && ctx.signal,
      });
    } catch (e) {
      return null;
    }
    if (!res || !res.ok) return null;
    return res.data;
  }

  const api = (path, ctx) => getJson(site() + path, ctx);

  /* 统一取出 {data:{...}}。新站所有业务接口都是这个外壳。 */
  function payload(d) {
    if (!d || typeof d !== "object") return null;
    if (d.data && typeof d.data === "object") return d.data;
    return null;
  }

  function listOf(d) {
    const p = payload(d);
    if (!p) return { items: [], pages: 1 };
    const items = Array.isArray(p.items) ? p.items : [];
    const pg = p.pagination && typeof p.pagination === "object" ? p.pagination : {};
    const pages = Number(pg.pages);
    return { items: items, pages: isFinite(pages) && pages > 0 ? pages : 1 };
  }

  /* ── 映射 ─────────────────────────────────────────────── */

  /* 加密图床：官方 crypto-image-protocol.js 明示的 AES-128-CBC 解密协议。
     这些图床上 .jpg 返回的是密文（Content-Type: binary/octet-stream），
     必须挂 transform 交给宿主解密，否则显示为坏图。 */
  const ENCRYPTED_IMG_HOST = /^https?:\/\/(?:[a-z0-9-]+\.)*qnlycc\.cn\//i;

  function cover(u) {
    const s = String(u || "");
    if (!s) return undefined;
    const full = /^https?:/i.test(s) ? s : site() + (s.charAt(0) === "/" ? s : "/" + s);
    if (ENCRYPTED_IMG_HOST.test(full)) {
      /* 用 plugin 变换而非原生 aes-cbc：先判图片魔数，明文图直接放行，
         只有真密文才解密，避免站点改回明文后反而全变成坏图。 */
      return { url: full, transform: { type: "plugin", name: "cover" } };
    }
    return full;
  }

  function tagsOf(x) {
    if (Array.isArray(x.tags) && x.tags.length) {
      return x.tags.filter((t) => typeof t === "string");
    }
    return undefined;
  }

  function epCount(x) {
    const a = Number(x.total_episodes);
    if (isFinite(a) && a > 0) return a;
    const b = Number(x.episode_count);
    if (isFinite(b) && b > 0) return b;
    return 0;
  }

  function toItem(x) {
    if (!x) return null;
    const id = String(x.id != null ? x.id : x.video_id != null ? x.video_id : "");
    if (!id) return null;
    const item = {
      id: id,
      title: String(x.title || x.name || "未命名"),
      type: "short",
      cover: cover(x.cover || x.pic || x.thumbnail),
      description: x.description ? String(x.description) : undefined,
      tags: tagsOf(x),
    };
    const sc = Number(x.score);
    if (isFinite(sc) && sc > 0) item.score = Math.min(10, sc);
    const n = epCount(x);
    if (n > 0) {
      item.episodeCount = n;
      item.badge = (x.is_finished ? "全" : "") + n + "集";
    } else if (x.is_finished) {
      item.badge = "已完结";
    }
    return item;
  }

  function toItems(list) {
    if (!Array.isArray(list)) return [];
    return list.map(toItem).filter(Boolean);
  }

  function pageOf(params) {
    const n = Number((params && params.cursor) || 1);
    return isFinite(n) && n > 0 ? Math.floor(n) : 1;
  }

  function sortOf(params) {
    const f = params && params.filters;
    if (f && Array.isArray(f.sort) && f.sort.length) return String(f.sort[0]);
    return "latest";
  }

  const PAGE_SIZE = 40;

  /* ── 专题 ─────────────────────────────────────────────── */

  let topicCache = null;

  function shortTitle(t) {
    return String(t || "")
      .replace(/AI成人短剧专辑|AI短剧专辑|AI成人漫剧专辑|AI漫剧专辑|专辑|专题/g, "")
      .trim()
      .slice(0, 10);
  }

  async function topics(ctx) {
    if (topicCache) return topicCache;
    const d = await api("/api/topics?page=1&size=30", ctx);
    const p = payload(d);
    const items = p && Array.isArray(p.items) ? p.items : [];
    topicCache = items
      .filter((t) => t && t.slug)
      .map((t) => ({ id: "topic:" + t.slug, label: "专题·" + shortTitle(t.title) }));
    return topicCache;
  }

  /* ── 列表分流 ─────────────────────────────────────────── */

  async function listBy(tid, page, sort, ctx) {
    const id = String(tid || "ai-duanju");
    let d;

    if (id.indexOf("topic:") === 0) {
      const slug = id.slice(6);
      d = await api(
        "/api/topics/" + encodeURIComponent(slug) + "?page=" + page + "&size=" + PAGE_SIZE,
        ctx
      );
    } else if (id.indexOf("rank:") === 0) {
      const kind = id.slice(5) || "hot";
      d = await api(
        "/api/ranks/" + encodeURIComponent(kind) + "?page=" + page + "&size=" + PAGE_SIZE,
        ctx
      );
    } else if (id.indexOf("posts") === 0) {
      const cate = id.split(":")[1] || "all";
      d = await api(
        "/api/posts?cate=" + encodeURIComponent(cate) + "&page=" + page + "&size=" + PAGE_SIZE,
        ctx
      );
    } else {
      d = await api(
        "/api/videos/category/" +
          encodeURIComponent(id) +
          "?page=" +
          page +
          "&size=" +
          PAGE_SIZE +
          "&sort=" +
          encodeURIComponent(sort || "latest"),
        ctx
      );
    }

    const r = listOf(d);
    return { items: toItems(r.items), next: page < r.pages ? String(page + 1) : null };
  }

  /* ── 能力：首页 ───────────────────────────────────────── */

  const home = {
    async getSections(params, ctx) {
      const out = [];
      const sets = [
        {
          path: "/api/videos/category/ai-duanju?page=1&size=18&sort=latest",
          id: "new",
          title: "最新短剧",
          layout: "banner",
          aspect: "landscape",
        },
        { path: "/api/ranks/hot?page=1&size=18", id: "hot", title: "热播榜", layout: "grid" },
      ];
      for (const s of sets) {
        const r = listOf(await api(s.path, ctx));
        const items = toItems(r.items);
        if (items.length) {
          const sec = { id: s.id, title: s.title, layout: s.layout, items: items };
          if (s.aspect) sec.imageAspect = s.aspect;
          out.push(sec);
        }
      }
      return { items: out };
    },
  };

  /* ── 能力：分类 ───────────────────────────────────────── */

  const catalog = {
    async getCategories(params, ctx) {
      const cats = CLASSES.map((c) => {
        const cat = { id: c.id, label: c.label };
        if (SORTABLE[c.id]) {
          cat.filters = [{ id: "sort", label: "排序", options: SORTS }];
          cat.sorts = SORTS;
        }
        return cat;
      });
      try {
        const t = await topics(ctx);
        for (const x of t) cats.push({ id: x.id, label: x.label });
      } catch (_) {}
      return cats;
    },

    async list(params, ctx) {
      return listBy(params && params.categoryId, pageOf(params), sortOf(params), ctx);
    },

    async getFilters(params) {
      const id = params && params.categoryId;
      if (!SORTABLE[id]) return {};
      return { sorts: SORTS, filters: [{ id: "sort", label: "排序", options: SORTS }] };
    },
  };

  /* ── 能力：搜索 ───────────────────────────────────────── */

  const search = {
    async search(params, ctx) {
      const key = String((params && params.query) || "").trim();
      const page = pageOf(params);
      if (!key) return { items: [] };
      const d = await api(
        "/api/search?q=" + encodeURIComponent(key) + "&page=" + page + "&size=" + PAGE_SIZE,
        ctx
      );
      const r = listOf(d);
      return { items: toItems(r.items), next: page < r.pages ? String(page + 1) : null };
    },

    async trending(params, ctx) {
      const r = listOf(await api("/api/ranks/hot?page=1&size=10", ctx));
      return r.items
        .map((x) => String(x.title || x.name || ""))
        .filter(Boolean)
        .slice(0, 8);
    },
  };

  /* ── 能力：首页信息流 ─────────────────────────────────── */

  const feed = {
    async list(params, ctx) {
      const page = pageOf(params);
      const r = listOf(
        await api("/api/videos/category/ai-duanju?page=" + page + "&size=12&sort=latest", ctx)
      );
      const items = toItems(r.items);
      return { items: items, next: page < r.pages ? String(page + 1) : null };
    },
  };

  /* ── 能力：媒体（详情与播放）──────────────────────────── */

  const media = {
    async getDetail(params, ctx) {
      const id = String((params && params.id) || "");
      if (!id) throw new hg.PluginError("INVALID_ARGUMENT", "缺少作品 id");

      let x = null;
      if (id.indexOf("post:") === 0) {
        const d = await api("/api/posts/" + encodeURIComponent(id.slice(5)), ctx);
        x = payload(d);
      } else {
        const d = await api("/api/videos/" + encodeURIComponent(id), ctx);
        x = payload(d);
      }

      if (!x) throw new hg.PluginError("UPSTREAM_CHANGED", "站点没有返回这部作品的信息");

      const base = toItem(x) || { id: id, title: "未命名", type: "short" };

      /* 新站详情不一定给分集数组，用集数生成；已有数组则以其为准 */
      let eps = Array.isArray(x.episodes) ? x.episodes : [];
      if (!eps.length) {
        const n = epCount(x) || 1;
        eps = [];
        for (let i = 1; i <= n; i++) eps.push({ ep: i });
      }

      const episodes = eps.map((e, i) => {
        const num = Number(e.ep || e.ep_num || e.id);
        const n2 = isFinite(num) && num > 0 ? num : i + 1;
        return {
          id: String(n2),
          index: i + 1,
          episodeNumber: n2,
          label: String(n2),
          title: e.title ? String(e.title) : undefined,
        };
      });

      return Object.assign({}, base, {
        playlists: [{ id: "main", label: "黄果", kind: "main", episodes: episodes }],
      });
    },

    async resolvePlayback(params, ctx) {
      const vid = String((params && params.mediaId) || "");
      const ep = String((params && params.episodeId) || "1");
      if (!vid) throw new hg.PluginError("INVALID_ARGUMENT", "缺少作品 id");

      const isPost = vid.indexOf("post:") === 0;
      const realId = isPost ? vid.slice(5) : vid;

      /* 帖子形态：先看帖子自身有没有直链 */
      if (isPost) {
        const d = await api("/api/posts/" + encodeURIComponent(realId), ctx);
        const x = payload(d) || {};
        const direct = String(x.video_url || "");
        if (/^https?:/i.test(direct)) {
          return {
            streams: [
              {
                url: direct,
                kind: "media",
                format: /\.m3u8(\?|$)/i.test(direct) ? "hls" : "progressive",
                label: "默认",
                headers: { "User-Agent": UA, Referer: site() + "/" },
              },
            ],
          };
        }
      }

      /* 主路：dx150 加密通道的 playback 作用域。
         正确路由是 POST /api/videos/{id}/episodes/{ep}/playback，
         不是 /api/videos/{id}/play?ep=N（那个端点匿名只给空地址）。 */
      let stream = "";
      let hevc = "";
      let viaDx = "";
      try {
        const r = await dxCall(
          "playback",
          "POST",
          "/api/videos/" + encodeURIComponent(realId) +
            "/episodes/" + encodeURIComponent(ep) + "/playback",
          {},
          ctx
        );
        if (r && r.status === 200) {
          const body = JSON.parse(r.body || "{}");
          const data = (body && body.data) || {};
          const st = data.streams || {};
          stream = String(st.main || st.preview || "");
          hevc = String(st.hevc || "");
          viaDx = "dx";
        }
      } catch (e) {
        /* 加密通道异常不致命，下面还有明文接口兜底 */
        if (e && e.code === "CANCELLED") throw e;
      }

      /* 兜底一：明文播放接口（部分老片仍从这个端点下发） */
      if (!stream) {
        const d = await api(
          "/api/videos/" + encodeURIComponent(realId) + "/play?ep=" + encodeURIComponent(ep),
          ctx
        );
        const x = payload(d) || {};
        stream = String(x.video_url || x.video_url_hevc || "");
      }

      if (!stream) {
        throw new hg.PluginError(
          "CONTENT_LOCKED",
          cookie()
            ? "加密通道与明文接口都没取到播放地址。已带 Cookie，可能是该集需要更高权限，或这一集源站确实没有片源。"
            : "两路都没取到播放地址：可能是该集源站没有片源，或站点协议又升级了。可在设置里填账号 Cookie 再试。"
        );
      }

      const isHls = /\.m3u8(\?|$)/i.test(stream);
      const streams = [
        {
          url: stream,
          kind: "media",
          format: isHls ? "hls" : "progressive",
          label: viaDx ? "默认（dx）" : "默认",
          headers: { "User-Agent": UA, Referer: site() + "/" },
        },
      ];
      /* HEVC 作为备选，部分机型硬解更省电；主源不可用时播放器会换 */
      if (hevc && /^https?:/i.test(hevc) && hevc !== stream) {
        streams.push({
          url: hevc,
          kind: "media",
          format: /\.m3u8(\?|$)/i.test(hevc) ? "hls" : "progressive",
          label: "HEVC",
          headers: { "User-Agent": UA, Referer: site() + "/" },
        });
      }

      return { streams: streams };
    },
  };

  /* ── 资源变换：封面兜底 ───────────────────────────────── */

  function looksLikeImage(u8) {
    if (!u8 || u8.length < 12) return false;
    if (u8[0] === 0xff && u8[1] === 0xd8) return true;
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return true;
    if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return true;
    if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46) return true;
    return false;
  }

  function guessType(u8) {
    if (u8[0] === 0xff && u8[1] === 0xd8) return "image/jpeg";
    if (u8[0] === 0x89 && u8[1] === 0x50) return "image/png";
    if (u8[0] === 0x47 && u8[1] === 0x49) return "image/gif";
    if (u8[0] === 0x52 && u8[1] === 0x49) return "image/webp";
    return undefined;
  }

  function transformResource(params) {
    const data = params && params.data;
    if (!data || !data.length) return { data: data };
    /* 已经是图片就放行（站点若改回明文，这里自动兼容） */
    if (looksLikeImage(data)) return { data: data, contentType: guessType(data) };
    /* 图床密文：AES-128-CBC / PKCS7 */
    try {
      const plain = hg.crypto.aesDecrypt(
        {
          mode: "cbc",
          key: hg.codec.utf8Encode(IMG_KEY),
          iv: hg.codec.utf8Encode(IMG_IV),
          padding: "pkcs7",
        },
        data
      );
      if (plain && looksLikeImage(plain)) {
        return { data: plain, contentType: guessType(plain) };
      }
      return { data: data };
    } catch (_) {
      return { data: data };
    }
  }

  return { home, catalog, search, feed, media, transformResource };
}
