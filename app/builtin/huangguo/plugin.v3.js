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
 * ── 关于播放（重要，请勿误判为插件 bug）──────────────────────────────
 * `GET /api/videos/{id}/play?ep=N` 对**匿名请求**返回 200，但其中
 * `video_url` / `video_key` / `video_iv` / `media_id` 全部为空字符串。
 * 实测连续多部作品（id 12/117/2833/323/2181/7628）一律如此。
 * 官方站另有一套 dx150-edge-v1 加密通道（ECDH P-256 → HKDF-SHA256 →
 * AES-256-GCM），实测握手与解密均成功，但走该通道取同一路由，
 * 返回内容与明文完全一致，video_url 依然为空。
 * => 结论：播放地址的发放与登录态绑定，匿名身份不下发。
 * 因此本插件支持在设置里填入自己的黄果账号 Cookie，带上后再取播放地址；
 * 未填 Cookie 时会明确提示需要登录，而不是含糊报错。
 */

const DEFAULT_SITE = "https://huangguoai.io";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

/* 封面密钥：旧站封面是 AES-128-CBC 密文，新站封面已改成 CDN 签名直链
   （形如 https://pic.qnlycc.cn/...?auth_key=...），通常不再需要解密。
   保留解密逻辑仅作兼容：识别出确属图片就原样返回。 */
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
  version: "3.0.0",
  protocol: 1,
  kind: "source",
  description:
    "黄果短剧点播源（AI短剧/漫剧/吃瓜/榜单/专题）。站点地址可改；播放需要登录态，可在设置里填入自己的账号 Cookie。",
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
      label: "账号 Cookie（取播放地址用）",
      hint: "在浏览器登录黄果后，把 Cookie 整段粘贴进来。留空则只能浏览、不能播放。",
      default: "",
    },
    {
      key: "cookieAuth",
      type: "text",
      label: "Authorization（可选）",
      hint: "若抓包看到 Bearer Token，填在这里；没有就留空",
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

  function cover(u) {
    const s = String(u || "");
    if (!s) return undefined;
    return /^https?:/i.test(s) ? s : site() + (s.charAt(0) === "/" ? s : "/" + s);
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

      const d = await api(
        "/api/videos/" + encodeURIComponent(realId) + "/play?ep=" + encodeURIComponent(ep),
        ctx
      );
      const x = payload(d) || {};
      const url = String(x.video_url || x.video_url_hevc || "");

      if (!url) {
        /* 明确区分「站点没给」和「插件出错」：源站对匿名请求就是不下发地址 */
        if (x.duration || x.ep_num) {
          throw new hg.PluginError(
            "CONTENT_LOCKED",
            cookie()
              ? "已带 Cookie 但仍未取到播放地址：登录可能已过期，或该账号无权观看这一集。"
              : "源站只对登录用户下发播放地址（匿名请求返回空 video_url，已实测多部作品一致）。请到插件设置里填入自己的黄果账号 Cookie 后重试。"
          );
        }
        throw new hg.PluginError(
          "UPSTREAM_CHANGED",
          "播放接口没有返回可用数据，站点接口可能已改版。"
        );
      }

      const key = String(x.video_key || "");
      const isHls = /\.m3u8(\?|$)/i.test(url) || key !== "";

      return {
        streams: [
          {
            url: url,
            kind: "media",
            format: isHls ? "hls" : "progressive",
            label: "默认",
            headers: { "User-Agent": UA, Referer: site() + "/" },
          },
        ],
      };
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
    /* 新站封面是明文直链，到这里通常已是图片，直接放行 */
    if (looksLikeImage(data)) return { data: data };
    /* 兼容旧站：AES-128-CBC 密文 */
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
      if (looksLikeImage(plain)) return { data: plain, contentType: guessType(plain) };
      return { data: data };
    } catch (_) {
      return { data: data };
    }
  }

  return { home, catalog, search, feed, media, transformResource };
}
