/**
 * RSS 的共享生成层。
 *
 * 全站 RSS 与标签 RSS 必须走同一套正文渲染、日期、分类与作者逻辑。
 * 若在两个路由里各复制一份，最容易出现的结果是：主订阅源已经修好，
 * 标签订阅源仍悄悄缺全文或输出另一套链接格式。
 */
import rss from '@astrojs/rss';
import { getContainerRenderer } from '@astrojs/mdx/container-renderer';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { render } from 'astro:content';
import { site } from '../config.js';
import type { Doc } from './wiki/graph.js';
import type { SiteContent } from './content.js';
import { dateOfDoc, tagsOf } from './content.js';
import { absolute, path } from './url.js';

/** `site.url` 未配置时仍保证订阅地址可生成，构建日志会明确提示。 */
export const FALLBACK_ORIGIN = 'http://localhost:4321';

/** customData 是 XML 字符串，配置值进入前必须转义。 */
export const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[char] ?? char;
  });

interface FeedOptions {
  readonly content: SiteContent;
  readonly docs: readonly Doc[];
  readonly title: string;
  readonly description: string;
  /** 从站点根开始的订阅路径，例如 `/tags/Java/rss.xml`。 */
  readonly feedPath: string;
  readonly astroSite?: URL;
}

/**
 * 生成一份全文 RSS。
 *
 * 只给摘要会迫使订阅者每篇都跳回浏览器，抵消 RSS 的主要价值。
 * 正文在构建期渲染一次，没有运行时成本；单篇渲染失败时只退化该条目的
 * 全文，不让整个订阅源一起失效。
 */
export async function createFeed(options: FeedOptions): Promise<Response> {
  // ⚠️ 容器**必须显式拿到 MDX 渲染器**，否则 `.mdx` 文章渲染时抛
  // `Unable to render Content. No valid renderer was found for this file extension.`
  // ——而下面那个 try/catch 会把异常吞掉，于是该条目**静默地**没有全文。
  //
  // 这正是 `npm run verify:formats` 里那条断言抓到的：探针标签下应该有 2 条全文，
  // 之前只有 Markdown 那条有（实测 2 个 item、1 个 `<content:encoded>`）。
  // 探针当初就是为「`.mdx` 装了却没接线、文章静默消失」补的，这里是同一个缺口的另一半。
  //
  // 代价是 `feed.ts` 现在依赖 `@astrojs/mdx`。这是有意的：这个模板自带 MDX 并对外宣称
  // 支持它。若使用者把 MDX 拆掉，构建会**明确报模块找不到**，而不是悄悄退化成没有全文——
  // 对这个项目来说，响的失败比对静默的退让好。
  const renderers = await loadRenderers([getContainerRenderer()]);
  const container = await AstroContainer.create({ renderers });

  const items = await Promise.all(
    options.docs.map(async (doc) => {
      const entry = options.content.entries.get(doc.slug);
      const date = dateOfDoc(options.content, doc.slug);
      if (!date) {
        throw new Error(`文章「${doc.slug}」没有发布日期，不能生成真实的 RSS pubDate。`);
      }

      let html = '';
      if (entry) {
        try {
          const { Content } = await render(entry);
          html = await container.renderToString(Content);
        } catch {
          html = '';
        }
      }

      return {
        title: doc.title,
        description: doc.summary,
        link: path(`/${doc.slug}/`),
        pubDate: date,
        categories: tagsOf(options.content, doc.slug),
        author: site.author.name,
        ...(html ? { content: html } : {}),
      };
    }),
  );

  const origin = site.url || FALLBACK_ORIGIN;
  const feedUrl = absolute(options.feedPath, origin);

  return rss({
    title: options.title,
    description: options.description,
    // `site.url` 的出厂值允许为空；空时用可见的本地地址，而不是生成无效 XML。
    site: options.astroSite ?? origin,
    items,
    // 不写构建年份，避免源码没变而 RSS 跨年漂移。
    customData:
      `<language>${escapeXml(site.lang)}</language>` +
      `<copyright>© ${escapeXml(site.author.name)}</copyright>` +
      `<atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>`,
    xmlns: { atom: 'http://www.w3.org/2005/Atom' },
  });
}
