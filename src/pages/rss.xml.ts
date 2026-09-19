import type { APIRoute } from 'astro';
import { site } from '../config.js';
import { dateOfDoc, loadContent, publishedPosts, reportIssues } from '../lib/content.js';
import { createFeed, FALLBACK_ORIGIN } from '../lib/feed.js';

/**
 * `site.url` 未配置时的兜底地址。
 *
 * 为什么是兜底而不是「没配就不生成 RSS」：**零配置必须能构建成功**，
 * 这是这个项目对使用者的承诺。少一个文件会让首页与页脚的 RSS 链接变 404，
 * 比生成一份地址不对的 RSS 更糟——后者至少能被发现并修好。
 */
export const GET: APIRoute = async (context) => {
  const content = await loadContent();
  reportIssues(content.issues);

  const posts = publishedPosts(content).filter((doc) => dateOfDoc(content, doc.slug) !== null);
  if (!site.url) {
    console.warn(
      '\n[letterpress] src/config.ts 里的 site.url 还是空的。\n' +
        '  RSS、sitemap 与 llms.txt 里的地址会指向 ' +
        FALLBACK_ORIGIN +
        '。\n' +
        '  部署前请把它改成你的真实域名。\n',
    );
  }

  return createFeed({
    content,
    docs: posts,
    title: site.title,
    description: site.tagline,
    feedPath: '/rss.xml',
    astroSite: context.site,
  });
};
