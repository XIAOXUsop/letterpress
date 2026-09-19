import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildContentManifest,
  CONTENT_MANIFEST_FORMAT,
  CONTENT_MANIFEST_VERSION,
  serializeContentManifest,
  type ManifestSource,
} from './content-manifest.js';
import { buildGraph, type Doc } from './wiki/graph.js';

function doc(over: Partial<Doc> & { slug: string }): Doc {
  return {
    kind: 'wiki',
    title: over.slug,
    summary: '摘要',
    body: '正文',
    explicitSlug: true,
    draft: false,
    ...over,
  };
}

function source(value: Doc, markdown = `# ${value.title}\n`): ManifestSource {
  return { doc: value, markdown };
}

const OPTIONS = {
  siteName: '示例站',
  language: 'zh-CN',
  siteUrl: 'https://example.com/notes',
};

describe('buildContentManifest', () => {
  it('声明自有格式与版本，而不伪装成外部标准', () => {
    const manifest = buildContentManifest([], buildGraph([]), OPTIONS);
    expect(manifest.format).toBe(CONTENT_MANIFEST_FORMAT);
    expect(manifest.version).toBe(CONTENT_MANIFEST_VERSION);
    expect(manifest.site).toEqual({
      name: '示例站',
      language: 'zh-CN',
      home: 'https://example.com/notes/',
    });
  });

  it('输入顺序不同仍得到逐字节相同的输出', () => {
    const a = doc({ slug: 'a', kind: 'post' });
    const b = doc({ slug: 'b' });
    const graph = buildGraph([a, b]);

    const forward = serializeContentManifest(
      buildContentManifest([source(a), source(b)], graph, OPTIONS),
    );
    const reverse = serializeContentManifest(
      buildContentManifest([source(b), source(a)], graph, OPTIONS),
    );

    expect(forward).toBe(reverse);
    expect(forward).not.toContain('generatedAt');
  });

  it('草稿不会进入清单', () => {
    const live = doc({ slug: 'live' });
    const draft = doc({ slug: 'draft', draft: true });
    const manifest = buildContentManifest(
      [source(live), source(draft)],
      buildGraph([live, draft]),
      OPTIONS,
    );

    expect(manifest.documentCount).toBe(1);
    expect(manifest.documents.map((entry) => entry.id)).toEqual(['wiki:live']);
  });

  it('hash 与字节数基于实际 UTF-8 markdown', () => {
    const item = doc({ slug: 'hash-me' });
    const markdown = '# 标题\n\n正文🙂\n';
    const manifest = buildContentManifest([source(item, markdown)], buildGraph([item]), OPTIONS);
    const digest = createHash('sha256').update(markdown, 'utf8').digest('hex');

    expect(manifest.documents[0]?.markdown).toEqual({
      mediaType: 'text/markdown',
      bytes: Buffer.byteLength(markdown, 'utf8'),
      sha256: digest,
    });
  });

  it('markdown 任一字节变化都会改变 hash', () => {
    const item = doc({ slug: 'changed' });
    const graph = buildGraph([item]);
    const before = buildContentManifest([source(item, '正文')], graph, OPTIONS);
    const after = buildContentManifest([source(item, '正文。')], graph, OPTIONS);

    expect(before.documents[0]?.markdown.sha256).not.toBe(after.documents[0]?.markdown.sha256);
  });

  it('出链与反向链接使用可解析的稳定 ID，并保持排序', () => {
    const target = doc({ slug: 'target' });
    const z = doc({ slug: 'z', kind: 'post', body: '[[target]]' });
    const a = doc({ slug: 'a', body: '[[target]]' });
    const docs = [target, z, a];
    const manifest = buildContentManifest(docs.map((item) => source(item)), buildGraph(docs), OPTIONS);
    const targetEntry = manifest.documents.find((entry) => entry.id === 'wiki:target');

    expect(targetEntry?.relations.backlinks).toEqual(['post:z', 'wiki:a']);
    expect(manifest.documents.find((entry) => entry.id === 'post:z')?.relations.outgoing).toEqual([
      'wiki:target',
    ]);
    expect(manifest.edgeCount).toBe(2);
  });

  it('URL 同时覆盖 HTML 与真实 markdown 端点', () => {
    const post = doc({ slug: 'hello', kind: 'post' });
    const wiki = doc({ slug: 'idea' });
    const manifest = buildContentManifest(
      [source(post), source(wiki)],
      buildGraph([post, wiki]),
      OPTIONS,
    );

    expect(manifest.documents.find((entry) => entry.id === 'post:hello')?.urls).toEqual({
      html: 'https://example.com/notes/hello/',
      markdown: 'https://example.com/notes/hello.md',
    });
    expect(manifest.documents.find((entry) => entry.id === 'wiki:idea')?.urls).toEqual({
      html: 'https://example.com/notes/wiki/idea/',
      markdown: 'https://example.com/notes/wiki/idea.md',
    });
  });

  it('未配置域名时保留可用的站内路径', () => {
    const item = doc({ slug: 'local' });
    const manifest = buildContentManifest([source(item)], buildGraph([item]), {
      ...OPTIONS,
      siteUrl: undefined,
    });

    expect(manifest.site.home).toBe('/');
    expect(manifest.documents[0]?.urls.markdown).toBe('/wiki/local.md');
  });

  it('保留同步与筛选所需的真实元数据', () => {
    const item = doc({ slug: 'metadata' });
    const manifest = buildContentManifest(
      [
        {
          ...source(item),
          publishedAt: new Date('2026-01-02T00:00:00.000Z'),
          updatedAt: new Date('2026-02-03T04:05:06.000Z'),
          tags: ['Agent', 'RAG'],
          wikiKind: 'concept',
        },
      ],
      buildGraph([item]),
      OPTIONS,
    );

    expect(manifest.documents[0]).toMatchObject({
      wikiKind: 'concept',
      publishedAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-02-03T04:05:06.000Z',
      tags: ['Agent', 'RAG'],
    });
  });
});
