/**
 * `/llms-full.txt`——全部内容内联成一份自包含文档。
 *
 * 与 `/llms.txt` 的分工：前者是目录（让 agent 决定读什么），
 * 后者是全文（一次拿完，不用遍历）。
 *
 * 内容多起来之后这个文件会很大。这是刻意的取舍——agent 侧可以只取前若干行，
 * 而「一次请求拿到全部」在 token 成本上通常仍优于遍历十几个页面。
 */
import type { APIRoute } from 'astro';
import { site } from '../config.js';
import { siteOrigin, basePath } from '../lib/url.js';
import { loadContent, reportIssues } from '../lib/content.js';
import { buildLlmsFullTxt } from '../lib/wiki/llms.js';

export const GET: APIRoute = async () => {
  const content = await loadContent();
  reportIssues(content.issues);

  const body = buildLlmsFullTxt(content.docs, {
    siteName: site.title,
    /*
     * 传**剥掉部署路径的站点来源**。早先这里写成「site.url + base」，
     * 而 site.url 本身就含子路径——两处相加就是前缀翻倍，
     * llms.txt 里 8 条 URL 全部 404。
     */
    /*
     * `siteOrigin` 剥掉重复的部署路径，`basePath` 再把它加回来一次——
     * 合起来就是「域名 + 且仅一个部署前缀」。
     * 少了后半截，llms.txt 里所有链接都会指向域名根。
     */
    siteUrl: siteOrigin(site.url) + basePath(),
    tagline: site.tagline,
    // 纯文本产物里中英文之间要手动加空格——`text-autospace` 只在 HTML 里生效。
    notes: [
      `本站以 ${site.lang} 为主。`,
      '需要增量同步时，先读取 /content-manifest.json，按 sha256 只抓取变化的 .md 文件。',
    ],
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      Vary: 'Accept',
    },
  });
};
