import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  manifestId,
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

// ── 稳定身份 ──────────────────────────────────────────────────────────
//
// 这一组针对的是「文档身份会不会随 URL 漂移」。
//
// 背景：`manifestId` 原先直接返回 `kind:slug`。这意味着**改一次文件名
// 或显式 slug，同一篇内容的 ID 就变了**——而 manifest 是对外发布的机器
// 出口，已经引用了这个 ID 的下游（订阅者的同步状态、外部索引）会把它
// 当成一篇新文档，旧文档变成孤儿。
//
// 路线图 §5.1 写的是「`id` 和 `slug` 必须分离：URL 可以演化，
// 知识身份不能因此断裂」。下面这几条就是那个要求的可执行形式。
describe('文档身份不随 URL 漂移', () => {
  it('同一篇内容换个 slug，ID 保持不变——但前提是写了显式 id', () => {
    // 最初这条写的是无条件成立，实测发现**不成立**：缺省 ID 就是 kind:slug。
    // 这正是取舍所在——所以把「前提」写进用例名，让它日后被改坏时立刻可见。
    const before = doc({ slug: 'old-path', id: 'stable' });
    const after = doc({ slug: 'new-path', id: 'stable' });
    expect(manifestId(before)).toBe(manifestId(after));
  });

  it('kind 不同则 ID 不同——不能因为 slug 撞车就合并身份', () => {
    expect(manifestId(doc({ kind: 'post', slug: 'x' }))).not.toBe(
      manifestId(doc({ kind: 'wiki', slug: 'x' })),
    );
  });

  it('ID 只由显式身份决定，缺省时退回 slug', () => {
    // 同一个 doc 反复调用必须一致（可复现构建的前提）。
    const a = doc({ kind: 'post', slug: 'a' });
    expect(manifestId(a)).toBe(manifestId(a));
  });

  it('不同文档不会撞 ID', () => {
    // 上一版这里写的是「不同 slug 也必须同 ID」——**那是错的**，
    // 那等于允许两篇不同内容共用一个身份，正是 manifest 要防的覆盖。
    expect(manifestId(doc({ kind: 'post', slug: 'a', title: '甲' }))).not.toBe(
      manifestId(doc({ kind: 'post', slug: 'b', title: '乙' })),
    );
  });

  it('显式 id 优先于任何推导', () => {
    const withId = doc({ kind: 'post', slug: 'a', id: 'stable-one' });
    const renamed = doc({ kind: 'post', slug: 'z', id: 'stable-one' });
    expect(manifestId(withId)).toBe(manifestId(renamed));
  });

  it('没写显式 id 时仍是 kind:slug——不制造新的破坏', () => {
    // 这条钉住**取舍本身**：内容寻址看起来更"稳定"，但两篇正文相同的
    // 不同文档会撞 ID，而撞 ID 比改名改 ID 严重得多。宁可保留旧行为，
    // 也要显式承认它的边界（由 lint 提示补 id），而不是悄悄换算法。
    expect(manifestId(doc({ kind: 'wiki', slug: 'kept' }))).toBe('wiki:kept');
  });
});

// ── 来源与复核状态必须进机器出口 ──────────────────────────────────────
/**
 * 路线图阶段 2 的工作项 5：「在 HTML、Markdown twin、manifest 与 NDJSON
 * 中输出**同一套**来源和复核字段」。
 *
 * 2026-09-24 实测的缺口：HTML 页面有（Provenance 组件），
 * 而 **manifest 与 NDJSON 都没有**。于是订阅者按 manifest 同步时
 * **无从知道哪篇已过期**——而 `stale` 内容在机器接口里
 * 不该被当成新鲜内容，正是这条路会漏。
 *
 * 下面这几条量的是「出口之间不许有差别」。
 */
describe('manifest 暴露来源与复核状态', () => {
  const reviewed = doc({
    kind: 'wiki',
    slug: 'with-review',
    sources: [{ sourceId: 'src-a', revision: 'v1', locator: '§1' }],
    review: { status: 'reviewed', checkedAt: '2026-09-24', contentDigest: 'abc' },
  });

  it('文档带出来源引用', () => {
    const manifest = buildContentManifest(
      [{ ...source(reviewed) }],
      buildGraph([reviewed]),
      OPTIONS,
    );
    expect(manifest.documents[0].provenance?.sources).toEqual([
      { sourceId: 'src-a', revision: 'v1', locator: '§1' },
    ]);
  });

  it('文档带出复核状态', () => {
    const manifest = buildContentManifest(
      [{ ...source(reviewed) }],
      buildGraph([reviewed]),
      OPTIONS,
    );
    expect(manifest.documents[0].provenance?.review?.status).toBe('reviewed');
  });

  it('没标来源的页面不带 sources 字段，而不是给一个空数组', () => {
    // 空数组与「没标」在下游是两种意思：前者像「已检查过，没有来源」，
    // 后者是「没看」。混成一样就会让「没量过」看起来像「量过且为空」。
    const plain = doc({ kind: 'wiki', slug: 'plain' });
    const manifest = buildContentManifest([source(plain)], buildGraph([plain]), OPTIONS);
    expect(manifest.documents[0].provenance?.sources).toBeUndefined();
  });

  it('pending 与 stale 都要能出现在出口里', () => {
    // stale 是最要紧的那个：它必须能被下游看见，而不是消失。
    for (const status of ['pending', 'stale'] as const) {
      const d = doc({
        kind: 'wiki',
        slug: `s-${status}`,
        review: { status, checkedAt: '2026-09-24', contentDigest: 'x' },
      });
      const manifest = buildContentManifest([source(d)], buildGraph([d]), OPTIONS);
      expect(manifest.documents[0].provenance?.review?.status).toBe(status);
    }
  });

  it('产物字节稳定——加字段不能引入构建时钟', () => {
    const a = serializeContentManifest(
      buildContentManifest([source(reviewed)], buildGraph([reviewed]), OPTIONS),
    );
    const b = serializeContentManifest(
      buildContentManifest([source(reviewed)], buildGraph([reviewed]), OPTIONS),
    );
    expect(a).toBe(b);
  });
});

// ── 可选字段缺失时不能崩 ──────────────────────────────────────────────
/**
 * 与 `impact.test.ts` 里那组同源，来源是迭代 N 的实测：
 * 拿第二份内容集跑核心流程时，`computeImpact` 在 `refs` 缺失时崩溃
 * （`undefined.some`）——因为 `ImpactPage.refs` 标成必填，
 * 而真实的 `Doc.sources?` 是可选的。
 *
 * > 站内一直没暴露，是因为所有调用方**都老实填了空数组**。
 * > **默认值救了它——而那正是最危险的状态。**
 *
 * 这一组量的是同一件事在 manifest 侧的对应位置。
 * `doc.sources?.length || doc.review` 那层短路**逻辑上已经安全**，
 * 但内层写的是 `doc.sources.map`——**靠外层条件保护的内层访问**
 * 在改代码时极易被挪掉。这里直接断言「字段整个缺失」也不崩。
 */
describe('可选字段缺失时不崩', () => {
  it('sources 整个为 undefined 时不崩，且 provenance 缺席', () => {
    const d = doc({ kind: 'wiki', slug: 'no-sources' }) as Doc;
    expect(() => buildContentManifest([source(d)], buildGraph([d]), OPTIONS)).not.toThrow();
    const manifest = buildContentManifest([source(d)], buildGraph([d]), OPTIONS);
    expect(manifest.documents[0].provenance).toBeUndefined();
  });

  it('review 为 undefined 而 sources 有值时，只出 sources', () => {
    const d = doc({
      kind: 'wiki',
      slug: 'src-only',
      sources: [{ sourceId: 's', revision: 'v1' }],
    }) as Doc;
    const manifest = buildContentManifest([source(d)], buildGraph([d]), OPTIONS);
    expect(manifest.documents[0].provenance?.sources).toHaveLength(1);
    expect(manifest.documents[0].provenance?.review).toBeUndefined();
  });

  it('sources 为 undefined 而 review 有值时，只出 review', () => {
    const d = doc({
      kind: 'wiki',
      slug: 'review-only',
      review: { status: 'pending' },
    }) as Doc;
    const manifest = buildContentManifest([source(d)], buildGraph([d]), OPTIONS);
    expect(manifest.documents[0].provenance?.review?.status).toBe('pending');
    expect(manifest.documents[0].provenance?.sources).toBeUndefined();
  });

  it('review 只有 status、缺 checkedAt 与 contentDigest 时不崩', () => {
    const d = doc({ kind: 'wiki', slug: 'partial', review: { status: 'reviewed' } }) as Doc;
    const manifest = buildContentManifest([source(d)], buildGraph([d]), OPTIONS);
    expect(manifest.documents[0].provenance?.review).toEqual({ status: 'reviewed' });
  });
});

// ── 「无来源」的两种含义必须可区分 ──────────────────────────────────────
/**
 * 路线图阶段 2 的退出条件原文：「100% 的 reviewed Wiki 页面至少能解析到
 * **一个有效来源版本或明确的「原创实践记录」**」。
 *
 * 而当前 schema **没有「原创实践记录」这个概念**——
 * 一页「没登记来源」既可能是「该登记却漏了」，也可能是
 * 「它讲的是本站自己的设计选择，本来就没有外部来源」。
 * **两种含义在数据里长得一模一样。**
 *
 * 举例（都是本站真实存在的页面）：
 * - `cjk-typography` 讲「规范说 ch 等于 0 字形」→ **必须有外部来源**；
 * - `design-tokens` 讲「本站的强调色选了 #002FA7」→ **原创实践记录**，
 *   外部找不到「本站为什么选这个色」的规范。
 *
 * 缺了这个区分，「已复核」这个状态对后者就毫无意义——
 * 因为 reviewer 无从知道「没有来源」是该补还是正常。
 */
describe('原创实践记录', () => {
  it('页面可以声明自己是原创实践记录——哪怕没有 sources', () => {
    const d = doc({
      kind: 'wiki',
      slug: 'own-choice',
      review: { status: 'reviewed', checkedAt: '2026-09-24', contentDigest: 'x' },
      original: { reason: '本站的设计选择，外部没有对应规范' },
    }) as Doc;
    const manifest = buildContentManifest([source(d)], buildGraph([d]), OPTIONS);
    expect(manifest.documents[0].provenance?.original?.reason).toBe(
      '本站的设计选择，外部没有对应规范',
    );
  });

  it('「没有来源也没有原创声明」是一个可被检出的状态——不是静默', () => {
    // 这条不是要求构建失败（很多页面本来就不需要来源），
    // 而是要求**它能被检出**——否则 lint 无从提醒「这一页该补来源还是该声明原创」。
    const d = doc({ kind: 'wiki', slug: 'silent' }) as Doc;
    const manifest = buildContentManifest([source(d)], buildGraph([d]), OPTIONS);
    // 既没有 sources 也没有 original → provenance 缺席，
    // 而「为什么缺席」必须能被区分（见 content.ts 的 reportMissingProvenance）
    expect(manifest.documents[0].provenance).toBeUndefined();
  });
});
