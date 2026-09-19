/** 每个标签一份全文 RSS：读者只订阅关心的主题，不必接收整站内容。 */
import type { APIRoute } from 'astro';
import { site } from '../../../config.js';
import { loadContent, publishedPosts, reportIssues, tagsOf } from '../../../lib/content.js';
import { createFeed } from '../../../lib/feed.js';

export async function getStaticPaths() {
  const content = await loadContent();
  reportIssues(content.issues);

  const posts = publishedPosts(content);
  const tags = new Set(posts.flatMap((post) => tagsOf(content, post.slug)));

  return [...tags].sort().map((tag) => ({
    params: { tag },
    props: {
      tag,
      docs: posts.filter((post) => tagsOf(content, post.slug).includes(tag)),
      content,
    },
  }));
}

export const GET: APIRoute = ({ props, site: astroSite }) => {
  const { tag, docs, content } = props as {
    tag: string;
    docs: ReturnType<typeof publishedPosts>;
    content: Awaited<ReturnType<typeof loadContent>>;
  };

  return createFeed({
    content,
    docs,
    title: `${tag} · ${site.title}`,
    description: `带有「${tag}」标签的文章订阅。`,
    feedPath: `/tags/${encodeURIComponent(tag)}/rss.xml`,
    astroSite,
  });
};
