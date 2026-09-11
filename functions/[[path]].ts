/**
 * Cloudflare Pages Functions —— 内容协商垫片。
 *
 * Pages 会自动发现 `functions/` 目录，不需要任何配置。文件名 `[[path]].ts`
 * 表示匹配所有路径。
 *
 * 免费套餐就能用（Pages Functions 的免费额度是每天 10 万次调用）。
 * 这一点很关键：**Cloudflare 官方的 Markdown for Agents 要 Pro 及以上套餐**，
 * 而这个垫片在免费套餐上做的是同一件事。
 */

import { negotiate } from '../src/lib/negotiate/edge';

/**
 * ── 为什么不装 `@cloudflare/workers-types` ──────────────────────────
 *
 * 那是个几百 KB 的类型包，而这里只用到它的两个形状。
 * 一个主张「依赖面小、十年后还能构建」的模板，不该为了三行胶水
 * 引入一整个平台的类型依赖——尤其是绝大多数使用者只会用到其中一个平台。
 *
 * 代价是失去自动补全。但下面这两个 interface 已经把用到的部分写清楚了，
 * 真要扩展时照着 Cloudflare 文档补字段即可。
 */
interface Env {
  /** Pages 的静态资源绑定 */
  ASSETS: { fetch: (input: RequestInfo | URL) => Promise<Response> };
}

/** Cloudflare Pages Functions 的处理器签名。 */
interface PagesContext<E> {
  request: Request;
  env: E;
  next: () => Promise<Response>;
}

type PagesFunction<E> = (context: PagesContext<E>) => Promise<Response> | Response;

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);

  const response = await negotiate(context.request, {
    pathname: url.pathname,
    /**
     * 取孪生文件。
     *
     * 直接构造 URL 交给 ASSETS 绑定去取，而不是 `fetch()` 一个绝对地址——
     * 后者会走一遍公网，既有延迟也会被 Cloudflare 的循环请求保护拦下。
     */
    fetchAsset: async (pathname) => {
      try {
        return await context.env.ASSETS.fetch(new URL(pathname, url.origin));
      } catch {
        return null;
      }
    },
  });

  /**
   * 协商层返回 null = 这次请求不归它管，按原样继续。
   *
   * `context.next()` 会走正常的静态资源流程。**这一句是「边缘函数挂了
   * 站点也不会挂」的保证**——任何未处理的路径都退化成普通静态站行为。
   */
  return response ?? context.next();
};
