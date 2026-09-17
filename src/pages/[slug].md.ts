/**
 * 文章的 markdown 孪生文件：`/<slug>.md`。
 *
 * ── 这是内容协商的落点 ──────────────────────────────────────────────
 *
 * 转换在**构建期**完成，边缘函数只负责「选哪个文件」。这个分工很重要：
 * 运行时转换意味着每次请求都要现算，而静态产物直接命中 CDN 缓存，
 * 零运行时成本、零冷启动、也不可能因为源站挂了而失败。
 *
 * 路由写法说明：`[slug].md.ts` 里的 `.md` 是**输出扩展名**，
 * 所以它产出的是 `dist/<slug>.md`，而不是 `<slug>.md/index.html`。
 */
import type { APIRoute } from 'astro';
import { site } from '../config.js';
import { markdownResponseHeaders } from '../lib/negotiate/accept.js';
import { dateOfDoc, loadContent, publishedPosts, reportIssues, tagsOf } from '../lib/content.js';
import { buildMarkdownTwin } from '../lib/wiki/llms.js';
import { path } from '../lib/url.js';

export async function getStaticPaths() {
  const content = await loadContent();
  reportIssues(content.issues);

  return publishedPosts(content).map((doc) => ({
    params: { slug: doc.slug },
    props: { slug: doc.slug, content },
  }));
}

export const GET: APIRoute = ({ props }) => {
  const { slug, content } = props as {
    slug: string;
    content: Awaited<ReturnType<typeof loadContent>>;
  };

  const doc = content.docs.find((d) => d.slug === slug);
  if (!doc) return new Response('Not found', { status: 404 });

  let body = buildMarkdownTwin(doc, content.graph, {
    siteUrl: site.url || undefined,
    lang: site.lang,
  });

  // 元信息用一段 markdown 表格补在正文前——比 YAML frontmatter 更适合被模型读，
  // 而且这些字段（日期、标签）对人也有用。
  const date = dateOfDoc(content, slug);
  const tags = tagsOf(content, slug);
  const meta: string[] = [];
  if (date) meta.push(`日期：${date.toISOString().slice(0, 10)}`);
  if (tags.length > 0) meta.push(`标签：${tags.join('、')}`);
  if (meta.length > 0) {
    const [head, ...rest] = body.split('\n\n');
    body = `${head}\n\n${meta.join('  \n')}\n\n${rest.join('\n\n')}`;
  }

  return new Response(body, {
    headers: markdownResponseHeaders(body, path(`/${slug}/`), path(`/${slug}.md`)),
  });
};
