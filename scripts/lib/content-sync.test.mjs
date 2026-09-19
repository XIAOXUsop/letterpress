import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncContent } from './content-sync.mjs';

const ORIGIN = 'https://example.test/blog';
const HOME = `${ORIGIN}/`;
const temporary = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function outputPath() {
  const root = await mkdtemp(join(tmpdir(), 'letterpress-sync-'));
  temporary.push(root);
  return join(root, 'mirror');
}

function digest(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function document(id, text, overrides = {}) {
  const [kind, slug] = id.split(':');
  return {
    id,
    kind,
    ...(kind === 'wiki' ? { wikiKind: 'concept' } : {}),
    slug,
    title: `标题 ${slug}`,
    summary: `摘要 ${slug}`,
    urls: { html: `${HOME}${slug}/`, markdown: `${HOME}${slug}.md` },
    tags: [],
    relations: { outgoing: [], backlinks: [] },
    markdown: {
      mediaType: 'text/markdown',
      bytes: Buffer.byteLength(text, 'utf8'),
      sha256: digest(text),
    },
    ...overrides,
  };
}

function manifest(documents) {
  const sorted = [...documents].sort((a, b) => a.id.localeCompare(b.id));
  return {
    format: 'letterpress-content-manifest',
    version: 1,
    site: { name: '示例站', language: 'zh-CN', home: HOME },
    documentCount: sorted.length,
    edgeCount: 0,
    documents: sorted,
  };
}

function ndjson(documents, texts) {
  return `${documents
    .map((doc) => {
      const { markdown, ...metadata } = doc;
      return JSON.stringify({
        format: 'letterpress-content-record',
        version: 1,
        site: { name: '示例站', language: 'zh-CN', home: HOME },
        ...metadata,
        content: { ...markdown, text: texts.get(doc.id) },
      });
    })
    .join('\n')}\n`;
}

function fakeFetch(routes, calls = []) {
  return {
    calls,
    fetch: async (url) => {
      const key = String(url);
      calls.push(key);
      const body = routes.get(key);
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
    },
  };
}

function fileOf(output, id) {
  return join(output, 'documents', `${encodeURIComponent(id)}.md`);
}

describe('syncContent', () => {
  it('首次同步用 NDJSON 导入正文，并用 manifest 对账', async () => {
    const output = await outputPath();
    const texts = new Map([
      ['post:a', '# A\n'],
      ['wiki:b', '# B\n'],
    ]);
    const docs = [...texts].map(([id, text]) => document(id, text));
    const remote = manifest(docs);
    const mock = fakeFetch(
      new Map([
        [`${ORIGIN}/content.ndjson`, ndjson(remote.documents, texts)],
        [`${ORIGIN}/content-manifest.json`, remote],
      ]),
    );

    const result = await syncContent({ origin: `${ORIGIN}/`, output, fetchImpl: mock.fetch });

    expect(result).toMatchObject({ documentCount: 2, added: 2, updated: 0, deleted: 0 });
    expect(mock.calls).toEqual([
      `${ORIGIN}/content.ndjson`,
      `${ORIGIN}/content-manifest.json`,
    ]);
    expect(await readFile(fileOf(output, 'post:a'), 'utf8')).toBe('# A\n');
    expect(await readFile(fileOf(output, 'wiki:b'), 'utf8')).toBe('# B\n');
    expect(JSON.parse(await readFile(join(output, 'content-manifest.json'), 'utf8'))).toEqual(remote);
  });

  it('后续只下载新增和变化正文，并传播删除', async () => {
    const output = await outputPath();
    const initialTexts = new Map([
      ['post:a', '# A\n'],
      ['post:b', '# B old\n'],
      ['post:removed', '# Removed\n'],
    ]);
    const initialDocs = [...initialTexts].map(([id, text]) => document(id, text));
    const firstManifest = manifest(initialDocs);
    const first = fakeFetch(
      new Map([
        [`${ORIGIN}/content.ndjson`, ndjson(firstManifest.documents, initialTexts)],
        [`${ORIGIN}/content-manifest.json`, firstManifest],
      ]),
    );
    await syncContent({ origin: ORIGIN, output, fetchImpl: first.fetch });

    const nextTexts = new Map([
      ['post:a', '# A\n'],
      ['post:b', '# B new\n'],
      ['post:c', '# C\n'],
    ]);
    const nextManifest = manifest(
      [...nextTexts].map(([id, text]) => document(id, text)),
    );
    const second = fakeFetch(
      new Map([
        [`${ORIGIN}/content-manifest.json`, nextManifest],
        [`${ORIGIN}/b.md`, '# B new\n'],
        [`${ORIGIN}/c.md`, '# C\n'],
      ]),
    );

    const result = await syncContent({ origin: ORIGIN, output, fetchImpl: second.fetch });

    expect(result).toMatchObject({ added: 1, updated: 1, unchanged: 1, deleted: 1 });
    expect(second.calls).toEqual([
      `${ORIGIN}/content-manifest.json`,
      `${ORIGIN}/b.md`,
      `${ORIGIN}/c.md`,
    ]);
    expect(await readFile(fileOf(output, 'post:b'), 'utf8')).toBe('# B new\n');
    expect(await readFile(fileOf(output, 'post:c'), 'utf8')).toBe('# C\n');
    await expect(readFile(fileOf(output, 'post:removed'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('本地正文损坏时即使远端 hash 没变也会重新下载修复', async () => {
    const output = await outputPath();
    const text = '# A\n';
    const doc = document('post:a', text);
    const remote = manifest([doc]);
    const first = fakeFetch(
      new Map([
        [`${ORIGIN}/content.ndjson`, ndjson(remote.documents, new Map([[doc.id, text]]))],
        [`${ORIGIN}/content-manifest.json`, remote],
      ]),
    );
    await syncContent({ origin: ORIGIN, output, fetchImpl: first.fetch });
    await writeFile(fileOf(output, doc.id), '损坏', 'utf8');

    const second = fakeFetch(
      new Map([
        [`${ORIGIN}/content-manifest.json`, remote],
        [`${ORIGIN}/a.md`, text],
      ]),
    );
    const result = await syncContent({ origin: ORIGIN, output, fetchImpl: second.fetch });

    expect(result.repaired).toBe(1);
    expect(await readFile(fileOf(output, doc.id), 'utf8')).toBe(text);
  });

  it('下载内容 hash 不匹配时保留完整旧镜像', async () => {
    const output = await outputPath();
    const oldText = '# Old\n';
    const oldDoc = document('post:a', oldText);
    const oldManifest = manifest([oldDoc]);
    const first = fakeFetch(
      new Map([
        [`${ORIGIN}/content.ndjson`, ndjson(oldManifest.documents, new Map([[oldDoc.id, oldText]]))],
        [`${ORIGIN}/content-manifest.json`, oldManifest],
      ]),
    );
    await syncContent({ origin: ORIGIN, output, fetchImpl: first.fetch });

    const newDoc = document('post:a', '# New\n');
    const second = fakeFetch(
      new Map([
        [`${ORIGIN}/content-manifest.json`, manifest([newDoc])],
        [`${ORIGIN}/a.md`, '# 被篡改\n'],
      ]),
    );
    await expect(
      syncContent({ origin: ORIGIN, output, fetchImpl: second.fetch }),
    ).rejects.toThrow('字节数不匹配');

    expect(await readFile(fileOf(output, oldDoc.id), 'utf8')).toBe(oldText);
    expect(JSON.parse(await readFile(join(output, 'content-manifest.json'), 'utf8'))).toEqual(
      oldManifest,
    );
  });

  it('NDJSON 在完整记录边界被截断时由 manifest 对账发现', async () => {
    const output = await outputPath();
    const texts = new Map([
      ['post:a', '# A\n'],
      ['post:b', '# B\n'],
    ]);
    const remote = manifest([...texts].map(([id, text]) => document(id, text)));
    const truncated = ndjson([remote.documents[0]], texts);
    const mock = fakeFetch(
      new Map([
        [`${ORIGIN}/content.ndjson`, truncated],
        [`${ORIGIN}/content-manifest.json`, remote],
      ]),
    );

    await expect(syncContent({ origin: ORIGIN, output, fetchImpl: mock.fetch })).rejects.toThrow(
      '记录数与 manifest 不一致',
    );
    await expect(readdir(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('拒绝抓取清单站点根之外的正文 URL', async () => {
    const output = await outputPath();
    const text = '# A\n';
    const bad = document('post:a', text, {
      urls: { html: `${HOME}a/`, markdown: 'https://attacker.test/private.md' },
    });
    const remote = manifest([bad]);
    const mock = fakeFetch(
      new Map([
        [`${ORIGIN}/content.ndjson`, ndjson(remote.documents, new Map([[bad.id, text]]))],
        [`${ORIGIN}/content-manifest.json`, remote],
      ]),
    );

    await expect(syncContent({ origin: ORIGIN, output, fetchImpl: mock.fetch })).rejects.toThrow(
      '逃出了站点根',
    );
    expect(mock.calls).not.toContain('https://attacker.test/private.md');
  });

  it('拒绝覆盖非空且不属于同步器的目录', async () => {
    const output = await outputPath();
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'important.txt'), '保留', 'utf8');
    const mock = fakeFetch(new Map());

    await expect(syncContent({ origin: ORIGIN, output, fetchImpl: mock.fetch })).rejects.toThrow(
      '拒绝覆盖',
    );
    expect(await readFile(join(output, 'important.txt'), 'utf8')).toBe('保留');
    expect(mock.calls).toHaveLength(0);
  });

  it('拒绝把已有镜像静默切换到另一个来源', async () => {
    const output = await outputPath();
    const text = '# A\n';
    const doc = document('post:a', text);
    const remote = manifest([doc]);
    const first = fakeFetch(
      new Map([
        [`${ORIGIN}/content.ndjson`, ndjson(remote.documents, new Map([[doc.id, text]]))],
        [`${ORIGIN}/content-manifest.json`, remote],
      ]),
    );
    await syncContent({ origin: ORIGIN, output, fetchImpl: first.fetch });

    const second = fakeFetch(new Map());
    await expect(
      syncContent({ origin: 'https://other.test', output, fetchImpl: second.fetch }),
    ).rejects.toThrow('拒绝改用');
    expect(second.calls).toHaveLength(0);
    expect(await readFile(fileOf(output, doc.id), 'utf8')).toBe(text);
  });
});
