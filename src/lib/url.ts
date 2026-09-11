/**
 * 站点内链接的统一构造。
 *
 * ── 为什么需要这一层 ────────────────────────────────────────────────
 *
 * Astro 的 `base` 配置只对**它自己生成的东西**生效（`Astro.url`、
 * `_astro/` 资源）。**手写的 `href="/posts/"` 不会自动加前缀**——
 * 部署到子路径（GitHub Pages 的项目站是 `/仓库名/`）时，这些链接
 * 会全部指向域名根，整站点不动。
 *
 * 而这类错误**在本地 `npm run dev` 下完全看不出来**——本地 base 是 `/`，
 * 前缀为空，一切正常。只有真正部署到子路径才会暴露。
 *
 * 所以所有站内链接都必须经过 `path()`。
 * `npm run verify` 里有一条断言会扫描构建产物，揪出任何绕过它的绝对路径。
 *
 * ── 用法 ────────────────────────────────────────────────────────────
 *
 * ```ts
 * path('/posts/')            // base='/'          → '/posts/'
 *                            // base='/letterpress' → '/letterpress/posts/'
 * path(`/${doc.slug}/`)      // 同样处理
 * ```
 *
 * 外部地址（`https://…`）原样返回，不做前缀。
 */
export function path(p: string): string {
  // 外部地址与锚点不处理
  if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('//') || p.startsWith('#')) {
    return p;
  }

  const base = import.meta.env.BASE_URL ?? '/';
  // 去掉末尾斜杠，`/letterpress/` → `/letterpress`；`/` → ``
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;

  return prefix + (p.startsWith('/') ? p : `/${p}`);
}

/**
 * 取出部署子路径（`''` 或 `/letterpress`）。
 *
 * Astro 的 `base` 与 `site.url` 里可能各写了一遍子路径——
 * **两个真相来源相加就是前缀翻倍**（实测踩过：产物里全是
 * `/letterpress/letterpress/og.png`，分享图与 RSS 发现全部 404）。
 */
export function basePath(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return base === '/' || base === '' ? '' : base.replace(/\/$/, '');
}

/**
 * 构造绝对地址。用于 `og:image`、RSS、sitemap、JSON-LD 这些
 * **必须**是完整 URL 的地方。
 *
 * ── 约定：`site.url` 填**域名根**，不要带部署路径 ──────────────────
 *
 * 部署到子路径时，路径由 `SITE_BASE` 提供。写两遍会翻倍：
 *
 *     site.url = 'https://example.com/blog'   ← 含路径
 *     SITE_BASE = /blog                        ← 又一遍
 *     → https://example.com/blog/blog/og.png   ✗
 *
 * 但「写错了不会报错、只是产物里多个前缀」这种事不该靠人记住，
 * 所以下面做一层容错：**若 `siteUrl` 末尾已经带了当前 base，先剥掉**。
 * 两种写法都能得到正确结果，代价只是这里多一个判断。
 *
 * `siteUrl` 为空时返回带 base 的相对路径——比编一个 localhost 地址好，
 * 后者会原样进生产产物（这个坑也踩过）。
 */
export function absolute(p: string, siteUrl: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return p;

  const withBase = path(p);
  if (!siteUrl) return withBase;

  let origin = siteUrl.replace(/\/$/, '');
  const prefix = basePath();
  if (prefix && origin.endsWith(prefix)) {
    origin = origin.slice(0, -prefix.length);
  }

  return origin + withBase;
}

/**
 * 站点来源（协议 + 域名 + 端口），**已剥掉重复的部署路径**。
 *
 * 给 llms.txt / RSS 这类自己拼 URL 的地方用，避免每处各写一遍
 * 「剥掉末尾 base」的逻辑——写漏一处就是一次前缀翻倍，
 * 而翻倍的表现是 404，不是报错。
 */
export function siteOrigin(siteUrl: string): string {
  let origin = siteUrl.replace(/\/$/, '');
  const prefix = basePath();
  if (prefix && origin.endsWith(prefix)) {
    origin = origin.slice(0, -prefix.length);
  }
  return origin;
}
