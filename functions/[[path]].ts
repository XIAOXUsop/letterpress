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

interface Env {
  /** Pages 的静态资源绑定 */
  ASSETS: { fetch: (input: RequestInfo | URL) => Promise<Response> };
}

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
