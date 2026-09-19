import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ContentManifest, ContentManifestDocument } from './content-manifest.js';
import {
  buildContentExportRecords,
  CONTENT_EXPORT_FORMAT,
  CONTENT_EXPORT_VERSION,
  serializeContentExport,
} from './content-export.js';

const text = '# 标题\n\n正文里有 "引号"。\n';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function document(id = 'post:hello', markdown = text): ContentManifestDocument {
  const [kind, slug] = id.split(':') as ['post' | 'wiki', string];
  return {
    id,
    kind,
    ...(kind === 'wiki' ? { wikiKind: 'concept' as const } : {}),
    slug,
    title: '标题',
    summary: '摘要',
    urls: {
      html: `https://example.com/${kind === 'wiki' ? 'wiki/' : ''}${slug}/`,
      markdown: `https://example.com/${kind === 'wiki' ? 'wiki/' : ''}${slug}.md`,
    },
    tags: ['示例'],
    relations: { outgoing: [], backlinks: [] },
    markdown: {
      mediaType: 'text/markdown',
      bytes: new TextEncoder().encode(markdown).byteLength,
      sha256: sha256(markdown),
    },
  };
}

function manifest(documents: ContentManifestDocument[]): ContentManifest {
  return {
    format: 'letterpress-content-manifest',
    version: 1,
    site: { name: '示例站', language: 'zh-CN', home: 'https://example.com/' },
    documentCount: documents.length,
    edgeCount: 0,
    documents,
  };
}

describe('buildContentExportRecords', () => {
  it('复用清单元数据，并内联真实 markdown', () => {
    const doc = document();
    const [record] = buildContentExportRecords(manifest([doc]), new Map([[doc.id, text]]));

    expect(record).toMatchObject({
      format: CONTENT_EXPORT_FORMAT,
      version: CONTENT_EXPORT_VERSION,
      site: { name: '示例站', language: 'zh-CN' },
      id: doc.id,
      urls: doc.urls,
      relations: doc.relations,
      content: { ...doc.markdown, text },
    });
    expect(record).not.toHaveProperty('markdown');
  });

  it('无论清单输入顺序如何，都按稳定 ID 排序', () => {
    const b = document('wiki:b');
    const a = document('post:a');
    const records = buildContentExportRecords(
      manifest([b, a]),
      new Map([
        [b.id, text],
        [a.id, text],
      ]),
    );
    expect(records.map((record) => record.id)).toEqual(['post:a', 'wiki:b']);
  });

  it('缺正文时明确失败，不发布空记录', () => {
    const doc = document();
    expect(() => buildContentExportRecords(manifest([doc]), new Map())).toThrow(doc.id);
  });

  it('正文 UTF-8 字节数与清单不一致时失败', () => {
    const doc = document();
    const bad = { ...doc, markdown: { ...doc.markdown, bytes: doc.markdown.bytes + 1 } };
    expect(() => buildContentExportRecords(manifest([bad]), new Map([[doc.id, text]]))).toThrow(
      '字节数',
    );
  });

  it('正文 hash 与清单不一致时失败', () => {
    const doc = document();
    const bad = { ...doc, markdown: { ...doc.markdown, sha256: '0'.repeat(64) } };
    expect(() => buildContentExportRecords(manifest([bad]), new Map([[doc.id, text]]))).toThrow(
      'SHA-256',
    );
  });

  it('重复 ID 时失败，避免消费端静默覆盖', () => {
    const doc = document();
    expect(() =>
      buildContentExportRecords(manifest([doc, doc]), new Map([[doc.id, text]])),
    ).toThrow('重复 ID');
  });
});

describe('serializeContentExport', () => {
  it('每行是独立 JSON，正文换行和引号可逆，并保留结尾换行', () => {
    const doc = document();
    const records = buildContentExportRecords(manifest([doc]), new Map([[doc.id, text]]));
    const body = serializeContentExport(records);
    const lines = body.trimEnd().split('\n');

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).content.text).toBe(text);
    expect(body.endsWith('\n')).toBe(true);
  });

  it('空站点输出空文件，而不是一行无意义的元数据', () => {
    expect(serializeContentExport([])).toBe('');
  });
});
