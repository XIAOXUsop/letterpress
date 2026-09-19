/**
 * 机器可读出口共享的内容快照。
 *
 * manifest 与 NDJSON 若各自加载、转换正文，很容易在以后只改到其中一条路径。
 * 这里一次性生成“清单 + 清单对应的真实 markdown”，两个路由只负责序列化。
 */
import { site } from '../config.js';
import {
  dateOfDoc,
  kindOf,
  loadContent,
  markdownTwinOf,
  reportIssues,
  tagsOf,
  updatedOfDoc,
} from './content.js';
import {
  buildContentManifest,
  manifestId,
  type ContentManifest,
} from './content-manifest.js';
import { basePath, siteOrigin } from './url.js';

export interface ContentSnapshot {
  readonly manifest: ContentManifest;
  readonly markdownById: ReadonlyMap<string, string>;
}

export async function createContentSnapshot(): Promise<ContentSnapshot> {
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

  const manifest = buildContentManifest(sources, content.graph, {
    siteName: site.title,
    language: site.lang,
    siteUrl,
  });
  const markdownById = new Map(
    sources.filter(({ doc }) => !doc.draft).map(({ doc, markdown }) => [manifestId(doc), markdown]),
  );

  return { manifest, markdownById };
}
