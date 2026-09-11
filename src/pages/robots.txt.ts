/**
 * `robots.txt`。
 *
 * 用路由而不是 `public/` 下的静态文件，唯一的理由是**要注入 `Sitemap:` 行**——
 * 而 sitemap 的地址取决于用户有没有配 `site.url`。
 *
 * 静态文件做不到这件事：写死了会在没配域名的站点上指向不存在的地址，
 * 不写又会让搜索引擎失去 sitemap 线索。早先的版本在注释里写着
 * 「sitemap 的地址由构建时注入」，但**实际没有任何代码去注入它**——
 * 又一次「注释描述了本该发生但没发生的事」。
 */
import type { APIRoute } from 'astro';
import { site } from '../config.js';
import { absolute } from '../lib/url.js';

export const GET: APIRoute = () => {
  const lines = [
    '# 全站允许抓取。',
    '#',
    '# 关于 AI 爬虫的一段说明，值得读完再改。',
    '#',
    '# 2026 年的「AI 爬虫」不是一个类别，而是两类，混为一谈会造成两种相反的错误：',
    '#',
    '#   · 训练爬虫（GPTBot、ClaudeBot、Google-Extended、CCBot）',
    '#     把内容拿去做模型训练。不希望在训练语料里出现就挡掉。',
    '#',
    '#   · 检索爬虫（OAI-SearchBot、Claude-SearchBot、PerplexityBot）',
    '#     让内容能被 AI 搜索引用并给出处。**挡住它们等于让这个站从 AI',
    '#     回答里消失**，而且没有变通办法——这是最常见的自伤。',
    '#',
    '# 下面默认全放行：个人博客最想要的是被读到，而不是为训练数据较劲。',
    '# 要挡训练爬虫就取消对应行的注释，但不要整体 Disallow，那会连检索一起挡掉。',
    '',
    'User-agent: *',
    'Allow: /',
    '',
    '# ── 训练爬虫（按需取消注释）──────────────────────────────────',
    '# User-agent: GPTBot',
    '# Disallow: /',
    '# User-agent: ClaudeBot',
    '# Disallow: /',
    '# User-agent: Google-Extended',
    '# Disallow: /',
    '# User-agent: CCBot',
    '# Disallow: /',
    '',
    '# 构建产物里没有这个目录，写出来是防止某些爬虫按惯例去试探',
    'Disallow: /_astro/',
  ];

  // 只有配了站点地址才输出 Sitemap——指向 localhost 的 sitemap 比没有更糟
  if (site.url) {
    lines.push('', `Sitemap: ${absolute('/sitemap-index.xml', site.url)}`);
  }

  return new Response(lines.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
