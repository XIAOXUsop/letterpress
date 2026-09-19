/**
 * 版本化内容清单。
 *
 * 它不是搜索索引，也不是某个尚未稳定的行业标准；它解决的是一个更窄、
 * 可验证的问题：让同步器先比较 hash，只抓取真正变化的 markdown 孪生文件。
 */
import { createHash } from 'node:crypto';
import type { Doc, LinkGraph } from './wiki/graph.js';
import { urlOf } from './wiki/graph.js';

export const CONTENT_MANIFEST_FORMAT = 'letterpress-content-manifest';
export const CONTENT_MANIFEST_VERSION = 1;

export interface ManifestSource {
  readonly doc: Doc;
  /** 对应 `.md` 端点实际返回的完整字节内容。 */
  readonly markdown: string;
  readonly publishedAt?: Date | null;
  readonly updatedAt?: Date | null;
  readonly tags?: readonly string[];
  readonly wikiKind?: 'concept' | 'entity' | 'synthesis' | null;
}

export interface ContentManifestOptions {
  readonly siteName: string;
  readonly language: string;
  /** 站点根地址；可以为空，也可以是含部署子路径的绝对地址。 */
  readonly siteUrl?: string;
}

export interface ContentManifestDocument {
  readonly id: string;
  readonly kind: Doc['kind'];
  readonly wikiKind?: 'concept' | 'entity' | 'synthesis';
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly urls: {
    readonly html: string;
    readonly markdown: string;
  };
  readonly publishedAt?: string;
  readonly updatedAt?: string;
  readonly tags: readonly string[];
  readonly relations: {
    readonly outgoing: readonly string[];
    readonly backlinks: readonly string[];
  };
  readonly markdown: {
    readonly mediaType: 'text/markdown';
    readonly bytes: number;
    readonly sha256: string;
  };
}

export interface ContentManifest {
  readonly format: typeof CONTENT_MANIFEST_FORMAT;
  readonly version: typeof CONTENT_MANIFEST_VERSION;
  readonly site: {
    readonly name: string;
    readonly language: string;
    readonly home: string;
  };
  readonly documentCount: number;
  readonly edgeCount: number;
  readonly documents: readonly ContentManifestDocument[];
}

/** 类型与 slug 共同组成稳定 ID，避免未来两类内容出现同名时含义模糊。 */
export function manifestId(doc: Pick<Doc, 'kind' | 'slug'>): string {
  return `${doc.kind}:${doc.slug}`;
}

function joinSite(siteUrl: string | undefined, pathname: string): string {
  const root = siteUrl?.replace(/\/$/, '') ?? '';
  return `${root}${pathname}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * 构建确定性清单：没有构建时间，输入不变时输出字节也不变。
 */
export function buildContentManifest(
  sources: readonly ManifestSource[],
  graph: LinkGraph,
  options: ContentManifestOptions,
): ContentManifest {
  const published = sources.filter(({ doc }) => !doc.draft);

  const documents = published
    .map(({ doc, markdown, publishedAt, updatedAt, tags = [], wikiKind }) => {
      const htmlPath = urlOf(doc);
      const outgoing = [...(graph.outbound.get(doc.slug) ?? [])]
        .map((slug) => graph.bySlug.get(slug))
        .filter((target): target is Doc => target !== undefined && !target.draft)
        .map(manifestId)
        .sort();
      const backlinks = (graph.backlinks.get(doc.slug) ?? [])
        .map(({ fromSlug }) => graph.bySlug.get(fromSlug))
        .filter((source): source is Doc => source !== undefined && !source.draft)
        .map(manifestId)
        .sort();

      const entry: ContentManifestDocument = {
        id: manifestId(doc),
        kind: doc.kind,
        ...(doc.kind === 'wiki' && wikiKind ? { wikiKind } : {}),
        slug: doc.slug,
        title: doc.title,
        summary: doc.summary,
        urls: {
          html: joinSite(options.siteUrl, htmlPath),
          markdown: joinSite(options.siteUrl, `${htmlPath.replace(/\/$/, '')}.md`),
        },
        ...(publishedAt ? { publishedAt: publishedAt.toISOString() } : {}),
        ...(updatedAt ? { updatedAt: updatedAt.toISOString() } : {}),
        tags: [...tags],
        relations: { outgoing, backlinks },
        markdown: {
          mediaType: 'text/markdown',
          bytes: new TextEncoder().encode(markdown).byteLength,
          sha256: sha256(markdown),
        },
      };

      return entry;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    format: CONTENT_MANIFEST_FORMAT,
    version: CONTENT_MANIFEST_VERSION,
    site: {
      name: options.siteName,
      language: options.language,
      home: joinSite(options.siteUrl, '/'),
    },
    documentCount: documents.length,
    edgeCount: documents.reduce((sum, doc) => sum + doc.relations.outgoing.length, 0),
    documents,
  };
}

export function serializeContentManifest(manifest: ContentManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
