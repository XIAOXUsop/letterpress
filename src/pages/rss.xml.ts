import rss from '@astrojs/rss';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { render } from 'astro:content';
import type { APIRoute } from 'astro';
import { site } from '../config.js';
import {
  dateOfDoc,
  loadContent,
  publishedPosts,
  reportIssues,
  tagsOf,
  updatedOfDoc,
} from '../lib/content.js';

/**
 * `site.url` 未配置时的兜底地址。
 *
 * 为什么是兜底而不是「没配就不生成 RSS」：**零配置必须能构建成功**，
 * 这是这个项目对使用者的承诺。少一个文件会让首页与页脚的 RSS 链接变 404，
 * 比生成一份地址不对的 RSS 更糟——后者至少能被发现并修好。
 */
const FALLBACK_ORIGIN = 'http://localhost:4321';

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

  /**
   * ── 为什么 RSS 要输出全文 ────────────────────────────────────────
   *
   * 只给摘要的 RSS 在过去是省流量的做法，但今天的读者用 RSS 就是为了
   * **不打开浏览器**。摘要意味着每篇文章都要跳一次——这正好抵消了 RSS 的意义。
   *
   * 竞品里只有 Stack 默认全文，而且它还塞在 `<description>` 里、
   * 从不输出标准的 `<content:encoded>`。这里用 `content` 字段输出，
   * `@astrojs/rss` 会生成规范的 `<content:encoded>`。
   *
   * 渲染要靠容器 API 把 Astro 组件转成 HTML 字符串——静态构建时做一次，
   * 没有运行时成本。
   */
  const container = await AstroContainer.create();

  const items = await Promise.all(
    posts.map(async (doc) => {
      const entry = content.entries.get(doc.slug);
      const date = dateOfDoc(content, doc.slug);
      const updated = updatedOfDoc(content, doc.slug);

      let html = '';
      if (entry) {
        try {
          const { Content } = await render(entry);
          html = await container.renderToString(Content);
        } catch {
          /**
           * 渲染失败不能让整个 RSS 挂掉。
           *
           * 退化成只有摘要的条目仍然可用，而整个 `/rss.xml` 报错会让
           * 所有订阅者看到一篇空白——代价大得多。
           */
          html = '';
        }
      }

      return {
        title: doc.title,
        description: doc.summary,
        link: `/${doc.slug}/`,
        pubDate: date ?? new Date(),
        // 分类：把标签映射成 RSS 的 <category>
        categories: tagsOf(content, doc.slug),
        // 作者用 RSS 的 <author> 结构（只放名字，邮箱是可选的且容易被爬）
        author: site.author.name,
        ...(html ? { content: html } : {}),
      };
    }),
  );

  return rss({
    title: site.title,
    description: site.tagline,
    // 注意是 `||` 不是 `??`：`site.url` 未配置时是**空字符串**，
    // 而 `??` 只对 null/undefined 生效，空串会原样传下去导致校验失败。
    site: context.site ?? (site.url || FALLBACK_ORIGIN),
    items,
    customData:
      `<language>${site.lang}</language>` +
      `<copyright>© ${new Date().getFullYear()} ${site.author.name}</copyright>`,
    // atom:link 是 RSS 自检的标准项，不少聚合器靠它判断这是不是官方源
    xmlns: { atom: 'http://www.w3.org/2005/Atom' },
  });
};
