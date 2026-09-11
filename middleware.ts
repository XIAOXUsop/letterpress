/**
 * Vercel Edge Middleware —— 内容协商垫片。
 *
 * Vercel 的中间件必须放在项目根目录（或 `src/`）。它只在 Vercel 构建时生效，
 * Cloudflare 与 Netlify 会忽略这个文件，所以三个平台的文件可以共存。
 *
 * 与另外两个平台的差别：Vercel 的中间件无法直接取静态资源，必须**回源请求**
 * 一次。多一跳的代价换来的是平台无关——这是 Vercel 的模型决定的，不是取舍。
 */

import { negotiate } from './src/lib/negotiate/edge';

export const config = {
  /**
   * 排除静态资源与已有 `.md` 后缀的路径。
   * matcher 只支持正则，不支持函数——所以判断条件写在这里而不是共享逻辑里。
   */
  matcher: '/((?!_astro/|favicon|.*\\.(?:css|js|mjs|json|xml|txt|ico|svg|png|jpe?g|gif|webp|avif|woff2?|md)$).*)',
};

export default async function middleware(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);

  const response = await negotiate(request, {
    pathname: url.pathname,
    fetchAsset: async (pathname) => {
      try {
        const asset = await fetch(new URL(pathname, url.origin), {
          // 带上原始请求的 host，避免命中错误的部署
          headers: { host: url.host },
        });
        return asset.ok ? asset : null;
      } catch {
        return null;
      }
    },
  });

  /**
   * 返回 undefined = 不干预，Vercel 会继续走静态资源流程。
   * 与另外两个平台的 `next()` 语义相同。
   */
  return response ?? undefined;
}
