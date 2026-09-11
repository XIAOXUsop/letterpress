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
 * 构造绝对地址。用于 `og:image`、RSS、sitemap、JSON-LD 这些
 * **必须**是完整 URL 的地方。
 *
 * `site.url` 为空时返回相对路径——比编一个 localhost 地址好，
 * 后者会进生产产物（这个坑踩过一次）。
 */
export function absolute(p: string, siteUrl: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return p;
  const withBase = path(p);
  if (!siteUrl) return withBase;
  return siteUrl.replace(/\/$/, '') + withBase;
}
