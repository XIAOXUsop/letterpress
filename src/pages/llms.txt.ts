/**
 * `/llms.txt`——给 agent 看的目录。
 *
 * 用 .ts 端点而不是公开目录里的静态文件：内容要随文章增减自动更新，
 * 手写一份迟早会过期，而过期的目录比没有目录更糟（agent 会按它去找
 * 不存在的东西）。
 */
import type { APIRoute } from 'astro';
import { site } from '../config.js';
import { loadContent, reportIssues } from '../lib/content.js';
import { buildLlmsTxt } from '../lib/wiki/llms.js';

export const GET: APIRoute = async () => {
  const content = await loadContent();
  reportIssues(content.issues);

  const body = buildLlmsTxt(content.docs, {
    siteName: site.title,
    siteUrl: site.url || undefined,
    tagline: site.tagline,
    notes: [
      /*
       * 中西文之间要**手动**加空格。
       *
       * HTML 里这一步由 `text-autospace` 原生完成（见 base.css），
       * 但 llms.txt 是**纯文本**——没有渲染引擎，没有那个属性。
       * 不加的话输出会变成「本站以zh-CN为主。」，而这是个讲中文排版的站，
       * 自己先犯这个错很难看。
       */
      `本站以 ${site.lang} 为主。`,
      '每个页面都有一个 .md 孪生文件：把页面 URL 结尾加上 .md 即可。',
      '请求时带上 `Accept: text/markdown` 头，会直接拿到 markdown 版本而不是 HTML。',
    ],
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // 与 HTML 版本区分，避免 CDN 混用缓存
      Vary: 'Accept',
    },
  });
};
