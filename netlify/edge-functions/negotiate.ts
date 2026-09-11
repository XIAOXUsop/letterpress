/**
 * Netlify Edge Functions —— 内容协商垫片。
 *
 * Netlify 会自动发现 `netlify/edge-functions/` 目录。
 * 免费套餐包含每月 100 万次边缘函数调用，远超个人博客的需要。
 *
 * 注意 Netlify 的运行环境是 Deno，但这里用的是标准 Web API
 * （Request / Response / URL），所以共享逻辑无需任何改动。
 */

import { negotiate } from '../../src/lib/negotiate/edge.ts';

/*
 * 就地声明而非安装 `@netlify/edge-functions`——理由同 Cloudflare 垫片：
 * 只用到两个形状，不值得引入一整个平台的类型包。
 */
interface Context {
  next: () => Promise<Response>;
}

interface Config {
  path: string;
  [key: string]: unknown;
}

export default async (request: Request, context: Context): Promise<Response> => {
  const url = new URL(request.url);

  const response = await negotiate(request, {
    pathname: url.pathname,
    fetchAsset: async (pathname) => {
      try {
        // Deno 环境下直接 fetch 同源地址即可
        const asset = await fetch(new URL(pathname, url.origin));
        return asset.ok ? asset : null;
      } catch {
        return null;
      }
    },
  });

  return response ?? (await context.next());
};

export const config: Config = {
  /**
   * 排除静态资源目录——它们本来就不参与协商，
   * 让它们进函数是白白消耗调用额度。
   *
   * `.md` 也要排除，否则 `/foo.md` 会再次进入函数被改写成 `/foo.md.md`。
   * （共享逻辑里也有这个判断，这里是省额度的第一道拦截。）
   */
  path: '/((?!_astro|favicon|.*\\.(?:css|js|mjs|json|xml|txt|ico|svg|png|jpe?g|gif|webp|avif|woff2?|md)$).*)',
};
