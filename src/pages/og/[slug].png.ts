/**
 * 分享图路由：`/og/<slug>.png`。
 *
 * 用普通路由产出而不是构建钩子——这样它走正常的数据管线，
 * 能拿到内容集合，也能被 `getStaticPaths` 正确处理草稿过滤。
 *
 * 生成的是**几何图形，不含文字**，原因见 `src/lib/og.ts`。
 * 想要带标题的分享图，在 frontmatter 里写 `cover:` 或 `ogImage:` 指向自制图片。
 */
import type { APIRoute } from 'astro';
import { generateOgImage } from '../../lib/og.js';
import { loadContent, publishedPosts, publishedWiki, reportIssues } from '../../lib/content.js';

export async function getStaticPaths() {
  const content = await loadContent();
  reportIssues(content.issues);

  // 文章与知识层条目都生成——两者都可能被分享
  return [...publishedPosts(content), ...publishedWiki(content)].map((doc) => ({
    params: { slug: doc.slug },
    props: { slug: doc.slug },
  }));
}

export const GET: APIRoute = ({ props }) => {
  const { slug } = props as { slug: string };

  return new Response(new Uint8Array(generateOgImage(slug)), {
    headers: {
      'Content-Type': 'image/png',
      // 分享图按 slug 确定，内容不会变——可以长期缓存
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
