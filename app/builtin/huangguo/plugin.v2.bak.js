/**
 * 黄果短剧 · HPP 内容源插件 v1
 *
 * 上游结构（实测 + 社区维护的源相互印证）：
 *   · 源站 `https://huangguoai.com` 直连经常被墙/换域名，社区通行做法是走一层
 *     Cloudflare Worker 反代：`/api/*` 转发、`/media?url=` 解封面密文。
 *   · 因此本插件把「接口地址」与「源站地址」都做成设置项：Worker 挂了就换自己的，
 *     站点换域名就改 site，不用重新打包。
 *   · 封面是 AES-128-CBC 密文；走 Worker 时由 /media 解密，直连时由本插件的
 *     transformResource 解密（两种都支持，按设置切换）。
 *
 * 接口一览（BASE = Worker 或源站）：
 *   GET  /api/all                      首页聚合（sections.recommend）
 *   GET  /api/category/{tid}?page&size&sort
 *   GET  /api/chigua?cate=all|remen|yuanchuang&page&size
 *   GET  /api/ranks/{hot|recommend|potential}?page&size
 *   GET  /api/topics                   专题清单
 *   GET  /api/topics/{slug}?page&size  专题内容（只有源站有）
 *   GET  /api/search/{wd}?page&size    Worker 侧搜索
 *   GET  /api/search?q=&page&size      源站向量搜索
 *   GET  /api/detail/{id}              详情（含 episodes）
 *   GET  /api/play?url={id}&ep={n}     取播放地址
 *   GET  /media?url={cover}            封面解密（仅 Worker）
 */

const DEFAULT_API = "https://huangguo-parser.13681235735.workers.dev";
const DEFAULT_SITE = "https://huangguoai.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* 源站封面 AES-128-CBC（与旧客户端一致），仅在直连模式下使用 */
const IMG_KEY = "f5d965df75336270";
const IMG_IV = "97b60394abc2fbe1";

const CLASSES = [
  { id: "ai-duanju", label: "AI短剧" },
  { id: "ai-manju", label: "AI漫剧" },
  { id: "ai-huanlian", label: "换脸专区" },
  { id: "ai-mogai", label: "魔改专区" },
  { id: "chigua:all", label: "吃瓜·全部" },
  { id: "chigua:remen", label: "吃瓜·热门" },
  { id: "chigua:yuanchuang", label: "吃瓜·AI原创" },
  { id: "rank:hot", label: "热播榜" },
  { id: "rank:recommend", label: "推荐榜" },
  { id: "rank:potential", label: "潜力榜" },
];

const SORTS = [
  { id: "latest", label: "最新更新" },
  { id: "hot", label: "当前热播" },
  { id: "original", label: "独家原创" },
  { id: "random", label: "随机推荐" },
];

const SORTABLE = { "ai-duanju": 1, "ai-manju": 1, "ai-huanlian": 1, "ai-mogai": 1 };

export const meta = {
  id: "huangguo",
  name: "黄果短剧",
  version: "2.0.0",
  protocol: 1,
  kind: "source",
  description:
    "黄果短剧点播源（AI短剧/漫剧/吃瓜/榜单/专题）。接口地址与源站地址都可改，站点换域名或反代挂掉时只需改设置。",
  author: "local",
  defaultHeaders: { "User-Agent": UA },
  settings: [
    {
      key: "api",
      type: "text",
      label: "接口地址（Worker 反代）",
      description:
        "转发 /api/* 并解密封面的地址。默认用社区维护的公共反代；它挂掉时换成你自己部署的 Worker。",
      placeholder: DEFAULT_API,
      default: DEFAULT_API,
    },
    {
      key: "site",
      type: "text",
      label: "源站地址",
      description: "黄果源站根地址。专题列表、源站搜索、吃瓜帖正文需要它。站点换域名后改这里。",
      placeholder: DEFAULT_SITE,
      default: DEFAULT_SITE,
    },
    {
      key: "decryptCover",
      type: "switch",
      label: "插件解密封面",
      description:
        "走 Worker 时封面由 /media 解密，无需开启；直连源站时打开，用内置 AES 密钥解密。",
      default: false,
    },
  ],
};

export default function (hg) {
  /* ── 地址与请求 ───────────────────────────────────────── */

  function root(key, fallback) {
    const v = hg.settings.get(key);
    const s = (typeof v === "string" && v.trim()) || fallback;
    return String(s).trim().replace(/\/+$/, "");
  }
  const api = () => root("api", DEFAULT_API);
  const site = () => root("site", DEFAULT_SITE);

  /* 接口基址：默认用反代；反代不通时自动退回源站，避免「地址填错整站空白」。 */
  let resolvedBase = null;

  async function rawJson(url, ctx) {
    let res;
    try {
      res = await hg.http.fetch({
        url: url,
        method: "GET",
        headers: { "User-Agent": UA, Referer: site() + "/", Accept: "application/json" },
        responseType: "json",
        timeoutMs: 15000,
        retry: 0,
        maxBytes: 8 * 1024 * 1024,
        signal: ctx && ctx.signal,
      });
    } catch (e) {
      return null;
    }
    if (!res || !res.ok) return null;
    return res.data;
  }

  /* 探测一次并记住：优先反代，其次源站。 */
  async function base(ctx) {
    if (resolvedBase) return resolvedBase;
    const cands = [api()];
    if (site() !== api()) cands.push(site());
    for (const c of cands) {
      const d = await rawJson(c + "/api/all", ctx);
      if (d && typeof d === "object") {
        resolvedBase = c;
        return c;
      }
    }
    resolvedBase = api();
    return resolvedBase;
  }

  const fetchJson = (url, ctx) => rawJson(url, ctx);

  /* 走接口基址（反代或回退后的源站） */
  const apiJson = async (path, ctx) => rawJson((await base(ctx)) + path, ctx);
  /* 走源站：专题清单、吃瓜帖正文只有源站有 */
  const siteJson = (path, ctx) => rawJson(site() + path, ctx);

  /* ── 封面 ─────────────────────────────────────────────── */

  /* 判断是否处于「直连源站」形态：此时没有 /media 解密接口，必须由插件解密。 */
  function direct() {
    if (hg.settings.get("decryptCover") === true) return true;
    /* api 与 site 同一主机＝没走反代 */
    try {
      return new URL(api()).host === new URL(site()).host;
    } catch (_) {
      return false;
    }
  }

  function pic(u) {
    if (!u) return undefined;
    const s = String(u);
    if (!s) return undefined;
    if (direct()) {
      /* 直连：给原始地址，由 transformResource 解密 */
      return { url: /^https?:/i.test(s) ? s : site() + s, transform: { type: "plugin", name: "cover" } };
    }
    /* 反代：绝对地址交给 /media 解，相对路径直接拼 */
    if (/^https?:/i.test(s)) return { url: api() + "/media?url=" + encodeURIComponent(s) };
    return { url: api() + s };
  }

  /* ── 映射 ─────────────────────────────────────────────── */

  function tagList(v) {
    if (Array.isArray(v.vod_tags)) return v.vod_tags.filter((x) => typeof x === "string");
    if (typeof v.vod_tags === "string" && v.vod_tags)
      return v.vod_tags.split(/[\s,/]+/).filter(Boolean);
    if (v.type_name) return [String(v.type_name)];
    return undefined;
  }

  function remark(v) {
    const r = v.vod_remarks;
    return typeof r === "string" && r ? r : undefined;
  }

  function scoreOf(v) {
    const n = Number(v.vod_score || v.score);
    return isFinite(n) && n > 0 ? Math.min(10, n) : undefined;
  }

  function badgeOf(x, r) {
    if (x.is_original) return "原创";
    if (r) {
      const m = /(\d+)\s*集/.exec(r);
      if (m) return m[1] + "集";
    }
    const n = Number(x.episode_count || 0);
    return n > 0 ? n + "集" : undefined;
  }

  function toItem(x) {
    if (!x) return null;
    const id = String(x.vod_id || x.id || "");
    if (!id) return null;
    const name = String(x.vod_name || x.title || "未命名");
    const text = String(x.vod_content || x.vod_desc || x.description || "");
    const item = {
      id: id,
      title: name,
      type: "short",
      cover: pic(x.vod_pic || x.cover),
      description: text || undefined,
      tags: tagList(x),
      score: scoreOf(x),
      badge: badgeOf(x, remark(x)),
    };
    const ep = Number(x.episode_count || 0);
    if (ep > 0) item.episodeCount = ep;
    const year = Number(x.vod_year);
    if (isFinite(year) && year > 1900) item.year = year;
    return item;
  }

  function toItems(list) {
    if (!Array.isArray(list)) return [];
    return list.map(toItem).filter(Boolean);
  }

  function pg(params) {
    const n = Number((params && params.cursor) || 1);
    return n > 0 ? Math.floor(n) : 1;
  }

  function sortOf(params) {
    const f = params && params.filters;
    if (f && Array.isArray(f.sort) && f.sort.length) return String(f.sort[0]);
    return "latest";
  }

  /* ── 动态专题 ─────────────────────────────────────────── */

  let topicCache = null;

  function shortTitle(title) {
    let t = String(title || "");
    t = t
      .replace(/AI成人短剧专辑$/, "")
      .replace(/AI短剧专辑$/, "")
      .replace(/AI成人漫剧专辑$/, "")
      .replace(/AI漫剧专辑$/, "")
      .replace(/专辑$/, "")
      .replace(/专题$/, "")
      .replace(/AI/g, "")
      .replace(/成人/g, "")
      .replace(/短剧|漫剧/g, "");
    if (!t) t = String(title || "").replace(/AI/g, "");
    return t.slice(0, 10) || "专题";
  }

  async function topics(ctx) {
    if (topicCache) return topicCache;
    /* 专题清单只在源站的 /api/topics 上，反代不一定转发；失败就跳过 */
    const d = await siteJson("/api/topics", ctx);
    const items = d && d.data && Array.isArray(d.data.items) ? d.data.items : [];
    topicCache = items
      .filter((t) => t && t.slug)
      .map((t) => ({ id: "topic:" + t.slug, label: "专题·" + shortTitle(t.title) }));
    return topicCache;
  }

  /* ── 列表：按 type_id 分流到不同上游接口 ──────────────── */

  const PAGE_SIZE = 40;

  async function listBy(tid, page, sort, ctx) {
    const id = String(tid || "ai-duanju");
    let list = [];
    let pages = page;

    if (id.indexOf("topic:") === 0) {
      const slug = id.slice(6);
      const d = await siteJson(
        "/api/topics/" + encodeURIComponent(slug) + "?page=" + page + "&size=" + PAGE_SIZE,
        ctx
      );
      const v = d && d.data && d.data.videos ? d.data.videos : null;
      list = v && Array.isArray(v.items) ? v.items : [];
      pages = v && v.pagination && v.pagination.pages ? Number(v.pagination.pages) : page;
    } else if (id.indexOf("chigua") === 0) {
      const cate = id.split(":")[1] || "all";
      const d = await apiJson(
        "/api/chigua?cate=" + encodeURIComponent(cate) + "&page=" + page + "&size=" + PAGE_SIZE,
        ctx
      );
      list = d && Array.isArray(d.list) ? d.list : [];
      pages = d && d.pagecount ? Number(d.pagecount) : page;
    } else if (id.indexOf("rank:") === 0) {
      const kind = id.slice(5) || "hot";
      const d = await apiJson(
        "/api/ranks/" + encodeURIComponent(kind) + "?page=" + page + "&size=" + PAGE_SIZE,
        ctx
      );
      list = d && Array.isArray(d.list) ? d.list : [];
      pages = d && d.pagecount ? Number(d.pagecount) : page;
    } else if (id === "topics") {
      const d = await apiJson("/api/topics", ctx);
      list = d && Array.isArray(d.list) ? d.list : [];
      pages = page;
    } else {
      const d = await apiJson(
        "/api/category/" +
          encodeURIComponent(id) +
          "?page=" +
          page +
          "&size=" +
          PAGE_SIZE +
          "&sort=" +
          encodeURIComponent(sort || "latest"),
        ctx
      );
      list = d && Array.isArray(d.list) ? d.list : [];
      pages = d && d.pagecount ? Number(d.pagecount) : page;
    }

    return { items: toItems(list), next: page < pages ? String(page + 1) : null };
  }

  /* ── 能力 ─────────────────────────────────────────────── */

  const home = {
    async getSections(params, ctx) {
      const d = await apiJson("/api/all", ctx);
      const sec = d && d.sections && d.sections.recommend ? d.sections.recommend : null;
      let list = sec && Array.isArray(sec.list) ? sec.list : [];
      if (!list.length) {
        const f = await apiJson("/api/category/ai-duanju?page=1&size=30&sort=latest", ctx);
        list = f && Array.isArray(f.list) ? f.list : [];
      }
      const items = toItems(list);
      if (!items.length) return { items: [] };
      const half = Math.max(1, Math.ceil(items.length / 2));
      return {
        items: [
          {
            id: "recommend",
            title: "推荐",
            layout: "banner",
            imageAspect: "landscape",
            items: items.slice(0, half),
          },
          { id: "more", title: "接着看", layout: "grid", items: items.slice(half) },
        ],
      };
    },
  };

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
      /* 专题是动态的，取不到就不显示，不影响其它分类 */
      try {
        const t = await topics(ctx);
        for (const x of t) cats.push({ id: x.id, label: x.label });
      } catch (_) {}
      return cats;
    },

    async list(params, ctx) {
      const page = pg(params);
      const sort = sortOf(params);
      return listBy(params && params.categoryId, page, sort, ctx);
    },

    async getFilters(params) {
      const id = params && params.categoryId;
      if (!SORTABLE[id]) return {};
      return { sorts: SORTS, filters: [{ id: "sort", label: "排序", options: SORTS }] };
    },
  };

  const search = {
    async search(params, ctx) {
      const key = String((params && params.query) || "").trim();
      const page = pg(params);
      if (!key) return { items: [] };

      /* 先走反代搜索，它经常返回空，空了退回源站向量搜索 */
      const d = await apiJson(
        "/api/search/" + encodeURIComponent(key) + "?page=" + page + "&size=" + PAGE_SIZE,
        ctx
      );
      let list = d && Array.isArray(d.list) ? d.list : [];
      let pages = d && d.pagecount ? Number(d.pagecount) : page;

      if (!list.length) {
        const s = await siteJson(
          "/api/search?q=" + encodeURIComponent(key) + "&page=" + page + "&size=" + PAGE_SIZE,
          ctx
        );
        list = s && s.data && Array.isArray(s.data.items) ? s.data.items : [];
        pages =
          s && s.data && s.data.pagination && s.data.pagination.pages
            ? Number(s.data.pagination.pages)
            : page;
      }

      return { items: toItems(list), next: page < pages ? String(page + 1) : null };
    },

    async trending(params, ctx) {
      const d = await apiJson("/api/ranks/hot?page=1&size=8", ctx);
      const list = d && Array.isArray(d.list) ? d.list : [];
      return list
        .map((x) => String(x.vod_name || x.title || ""))
        .filter(Boolean)
        .slice(0, 8);
    },
  };

  const feed = {
    async list(params, ctx) {
      const page = pg(params);
      const d = await apiJson(
        "/api/category/ai-duanju?page=" + page + "&size=12&sort=latest",
        ctx
      );
      const list = d && Array.isArray(d.list) ? d.list : [];
      return { items: toItems(list), next: list.length ? String(page + 1) : null };
    },
  };

  /* 吃瓜帖：详情里可能没有分集，得从帖子接口补播放地址 */
  async function postVideo(pid, ctx) {
    const d = await siteJson("/api/posts/" + encodeURIComponent(pid), ctx);
    const data = d && d.data ? d.data : null;
    if (!data) return null;
    const u = String(data.video_url || "");
    if (/^https?:/i.test(u)) return { url: u, videoId: null };
    const m = String(data.content || "").match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
    if (m) return { url: m[0].replace(/&amp;/g, "&"), videoId: null };
    const v = String(data.content || "").match(/\/video\/(\d+)\//);
    if (v) return { url: null, videoId: v[1] };
    return null;
  }

  const media = {
    async getDetail(params, ctx) {
      const id = String((params && params.id) || "");
      if (!id) throw new hg.PluginError("INVALID_ARGUMENT", "缺少作品 id");

      const d = await apiJson("/api/detail/" + encodeURIComponent(id), ctx);
      const x = d && Array.isArray(d.list) && d.list.length ? d.list[0] : null;
      if (!x) throw new hg.PluginError("UPSTREAM_CHANGED", "站点没有返回这部作品的信息");

      const base = toItem(x) || { id: id, title: "未命名", type: "short" };
      let eps = Array.isArray(x.episodes) ? x.episodes : [];

      /* 吃瓜图文帖：反代抓不到分集时补一条占位集，播放时再解析 */
      const isArchive = id.indexOf("archives_") === 0;
      if (!eps.length && isArchive) {
        const found = await postVideo(id.replace("archives_", ""), ctx);
        if (found) eps = [{ ep: "1", url: "", title: "第1集" }];
      }
      if (!eps.length) eps = [{ ep: "1", url: "", title: "第1集" }];

      const episodes = eps.map((e, i) => {
        const num = Number(e.ep);
        const idx = i + 1;
        const n = isFinite(num) && num > 0 ? num : idx;
        return {
          id: String(n),
          index: idx,
          episodeNumber: n,
          label: String(n),
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

      let url = "";
      const headers = { "User-Agent": UA, Referer: site() + "/" };

      if (vid.indexOf("archives_") === 0) {
        /* 一：反代详情里的 episodes[0].url */
        const dd = await apiJson("/api/detail/" + encodeURIComponent(vid), ctx);
        const xx = dd && Array.isArray(dd.list) && dd.list.length ? dd.list[0] : null;
        const ee = xx && Array.isArray(xx.episodes) ? xx.episodes : [];
        if (ee.length && ee[0].url) url = String(ee[0].url);

        if (!url) {
          /* 二：帖子自己的 video_url，或正文里的 m3u8 */
          const found = await postVideo(vid.replace("archives_", ""), ctx);
          if (found && found.url) url = found.url;
          /* 三：帖子正文指向正片 /video/{id}，换成普通播放 */
          if (!url && found && found.videoId) {
            const pd = await apiJson(
              "/api/play?url=" +
                encodeURIComponent(found.videoId) +
                "&ep=" +
                encodeURIComponent(ep),
              ctx
            );
            if (pd && pd.url) url = String(pd.url);
          }
        }
      } else {
        const pd = await apiJson(
          "/api/play?url=" + encodeURIComponent(vid) + "&ep=" + encodeURIComponent(ep),
          ctx
        );
        if (pd && pd.url) url = String(pd.url);
      }

      if (!url) {
        throw new hg.PluginError("CONTENT_LOCKED", "这一集没取到播放地址。可能是站点限制或接口已变更。");
      }

      return {
        streams: [
          {
            url: url,
            kind: "media",
            format: /\.m3u8(\?|$)/i.test(url) ? "hls" : "progressive",
            label: "默认",
            headers: headers,
          },
        ],
      };
    },
  };

  /* ── 封面 AES 兜底（直连模式） ────────────────────────── */

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
    if (looksLikeImage(data)) return { data: data };
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
      return { data: plain, contentType: guessType(plain) };
    } catch (_) {
      return { data: data };
    }
  }

  return { home, catalog, search, feed, media, transformResource };
}
