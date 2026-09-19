/**
 * `/content-manifest.json`——供 Agent / RAG 同步器增量抓取的确定性清单。
 */
import type { APIRoute } from 'astro';
import { site } from '../config.js';
import {
  dateOfDoc,
  kindOf,
  loadContent,
  markdownTwinOf,
  reportIssues,
  tagsOf,
  updatedOfDoc,
} from '../lib/content.js';
import { buildContentManifest, serializeContentManifest } from '../lib/content-manifest.js';
import { basePath, siteOrigin } from '../lib/url.js';

export const GET: APIRoute = async () => {
  const content = await loadContent();
  reportIssues(content.issues);

  const siteUrl = siteOrigin(site.url) + basePath() || undefined;
  const sources = content.docs.map((doc) => ({
    doc,
    markdown: markdownTwinOf(content, doc, { siteUrl, lang: site.lang }),
    publishedAt: dateOfDoc(content, doc.slug),
    updatedAt: updatedOfDoc(content, doc.slug),
    tags: tagsOf(content, doc.slug),
    wikiKind: kindOf(content, doc.slug),
  }));

  const body = serializeContentManifest(
    buildContentManifest(sources, content.graph, {
      siteName: site.title,
      language: site.lang,
      siteUrl,
    }),
  );

  return new Response(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
