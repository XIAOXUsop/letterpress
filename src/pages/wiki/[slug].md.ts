/** 知识层条目的 markdown 孪生文件：`/wiki/<slug>.md`。 */
import type { APIRoute } from 'astro';
import { site } from '../../config.js';
import { MARKDOWN_CONTENT_TYPE, estimateTokens } from '../../lib/negotiate/accept.js';
import { loadContent, publishedWiki, reportIssues } from '../../lib/content.js';
import { buildMarkdownTwin } from '../../lib/wiki/llms.js';

export async function getStaticPaths() {
  const content = await loadContent();
  reportIssues(content.issues);

  return publishedWiki(content).map((doc) => ({
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

  const body = buildMarkdownTwin(doc, content.graph, {
    siteUrl: site.url || undefined,
    lang: site.lang,
  });

  return new Response(body, {
    headers: {
      'Content-Type': MARKDOWN_CONTENT_TYPE,
      Vary: 'Accept',
      'x-markdown-tokens': String(estimateTokens(body)),
    },
  });
};
