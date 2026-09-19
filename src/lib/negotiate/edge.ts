/**
 * 内容协商的边缘层实现。
 *
 * ── 为什么需要这一层 ────────────────────────────────────────────────
 *
 * 静态托管只吐文件，**不解析请求头**。所以「同一个 URL 按 Accept 返回不同格式」
 * 这件事在纯静态站上做不到——这也正是 Cloudflare 的 Markdown for Agents
 * 要 Pro 及以上套餐、Vercel 的实现只在自己平台内生效的原因。
 *
 * 出路是两层分工：
 *
 *   构建期：为每个页面生成 `.md` 孪生文件（零运行时成本）
 *   边缘：  读 Accept，决定回哪个文件
 *
 * 转换在构建期完成，边缘只做一次字符串判断。这意味着**没有额外的 CPU 开销**、
 * 没有冷启动问题、而且当边缘函数出错时可以整体绕过（站点照常工作）。
 *
 * ── 平台适配 ────────────────────────────────────────────────────────
 *
 * 这个文件是**平台无关**的：传入一个 Request 和一个「取文件」的函数，
 * 返回 Response 或 null（表示「不管，按原样走」）。
 * 三个平台的垫片各自只有十几行，见 `functions/`、`netlify/edge-functions/`、
 * `middleware.ts`。
 *
 * 这么分层的原因：协商逻辑是**需要被测试的**（它有七个真实 agent 的回归固件），
 * 而平台垫片是不需要测试的胶水。把两者混在一起会让测试被迫依赖某个平台的运行时。
 */

import { markdownResponseHeaders, prefersMarkdown } from './accept.js';

export interface NegotiateOptions {
  /** 取静态资源。返回 null 表示「没有这个文件」 */
  readonly fetchAsset: (pathname: string) => Promise<Response | null>;
  /** 原请求的 pathname */
  readonly pathname: string;
}

/** 这些路径永远不参与协商。 */
function isExcluded(pathname: string): boolean {
  // 已经有 .md 后缀的不重复处理，否则 /foo.md 会被改写成 /foo.md.md
  if (pathname.endsWith('.md')) return true;
  // 非页面资源
  if (/\.(css|js|mjs|json|ndjson|xml|txt|ico|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|map)$/i.test(pathname)) {
    return true;
  }
  return false;
}

/** 把 `/foo/` 或 `/foo` 映射到孪生文件路径 `/foo.md`。 */
export function twinPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return `${trimmed === '' ? '/index' : trimmed}.md`;
}

/**
 * 需要追加到**所有**响应上的头。
 *
 * `Vary: Accept` 必须加在 **HTML 响应上**，不只是 markdown 响应上。
 * 只在 markdown 侧加的话，CDN 仍可能把 HTML 缓存下来发给 agent，
 * 或反过来——两种方向都会出错。
 */
export const VARY_HEADERS: Readonly<Record<string, string>> = { Vary: 'Accept' };

/**
 * 核心处理。返回 null 表示「这次请求不该由协商处理」，
 * 调用方应当原样继续（回落到静态资源）。
 */
export async function negotiate(
  request: Request,
  options: NegotiateOptions,
): Promise<Response | null> {
  // 只处理 GET / HEAD。POST 之类的请求语义不同，不该被改写。
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;

  const { pathname } = options;
  if (isExcluded(pathname)) return null;

  const wantsMarkdown = prefersMarkdown(request.headers.get('accept'));

  if (!wantsMarkdown) {
    /**
     * 客户端要 HTML。
     *
     * 这里返回 null（交给平台去取静态文件），而不是自己 fetch 回来再补头——
     * 平台自己处理静态资源时性能更好（能命中它自己的缓存层）。
     * `Vary: Accept` 由平台配置（`_headers` 文件、`netlify.toml` 等）负责，
     * 因为从这里返回的 null 意味着我们连响应对象都拿不到。
     */
    return null;
  }

  /**
   * 取文件失败时**必须回落，不能把异常抛出去**。
   *
   * 抛出去的话边缘函数会返回 500，用户看到的是错误页——而这本来只是一个
   * 可有可无的优化：拿不到 markdown，给 HTML 就好了。
   *
   * 换句话说，**这条功能的失败必须是静默的**。它是一次增强，不是主路径；
   * 让增强失败拖垮主路径是本末倒置。
   */
  let twin: Response | null = null;
  try {
    twin = await options.fetchAsset(twinPath(pathname));
  } catch {
    return null;
  }

  /**
   * 没有孪生文件时同样回落，不能返回 404。
   *
   * 想象一个 agent 请求 `/some-page/`，而那一页恰好没有 .md 版本
   * （比如是 404 页或某个特殊路由）。直接 404 会让它以为页面不存在，
   * 而实际上 HTML 版本好好的。**回落是正确行为，不是兜底。**
   */
  if (!twin || !twin.ok) return null;

  const body = await twin.text();

  const representationPath = twinPath(pathname);
  const headers = markdownResponseHeaders(body, pathname, representationPath);

  // HEAD 请求不该带 body
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}
