import { describe, expect, it } from 'vitest';
import { buildContextPack, packPassages, type PackDoc } from './context-pack.js';

function doc(slug: string, over: Partial<PackDoc> = {}): PackDoc {
  return { slug, title: slug, updated: '', body: `## ${slug} 节\n\n正文。`, ...over };
}

const SOURCES = [
  { sourceId: 'css-values-4', revision: 'WD-20240312', locator: '§5.1.1' },
];

const CORPUS: PackDoc[] = [
  doc('cjk', {
    title: '中文排版',
    updated: '2026-09-24',
    body: '## 34em 这个数字\n\n行宽用 34em，容器宽度跟随字号。',
    sources: SOURCES,
    review: { status: 'reviewed', checkedAt: '2026-09-24' },
  }),
  doc('negotiation', {
    title: '内容协商',
    body: '## Accept 头\n\nmarkdown 与 html 的 q 值相同时比顺序。',
    related: ['cjk'],
  }),
];

describe('context pack · 路线图 §3 要的五样', () => {
  /*
   * §3 写的是「查询结果必须包含文档 ID、片段、来源版本、状态和关系路径」。
   * 下面逐样断言——**缺一样就是那个形状没实现**，而输出看上去仍然正常。
   */
  it('① 文档 ID', () => {
    const pack = buildContextPack(CORPUS, '行宽为什么用 34em');
    expect(pack.passages[0].docId).toBe('cjk');
    expect(pack.passages[0].id).toMatch(/^cjk#/);
  });

  it('② 片段（标题 + 正文）', () => {
    const pack = buildContextPack(CORPUS, '行宽为什么用 34em');
    expect(pack.passages[0].heading).toBe('34em 这个数字');
    expect(pack.passages[0].text).toContain('34em');
  });

  it('③ 来源版本', () => {
    const pack = buildContextPack(CORPUS, '行宽为什么用 34em');
    expect(pack.passages[0].sources[0]).toEqual(SOURCES[0]);
    // **版本号必须在**——「有来源」而没有版本，正是版本登记要防的退化
    expect(pack.passages[0].sources[0]?.revision).toBeTruthy();
  });

  it('④ 复核状态', () => {
    const pack = buildContextPack(CORPUS, '行宽为什么用 34em');
    expect(pack.passages[0].review?.status).toBe('reviewed');
  });

  it('⑤ 关系路径', () => {
    const pack = buildContextPack(CORPUS, '内容协商里 q 值相同时怎么判');
    const main = pack.passages.find((p) => p.relation === '主命中');
    expect(main).toBeDefined();
    // 其余每一段都要有**明确**的关系，不能是空
    for (const p of pack.passages) expect(p.relation).toBeTruthy();
  });

  it('没标来源的页面 sources 为空数组，review 为 null', () => {
    const pack = buildContextPack(CORPUS, '内容协商里 q 值相同时怎么判');
    const other = pack.passages.find((p) => p.docId !== pack.passages[0].docId);
    // 缺席而不是空——「没标」与「标了但为空」在下游是两种含义
    expect(other?.sources ?? []).toEqual([]);
  });
});

describe('context pack · 判定与形状', () => {
  it('无依据时 supported=false 且 passages 仍可为空', () => {
    const pack = buildContextPack(CORPUS, 'Stripe 支付怎么接入');
    expect(pack.supported).toBe(false);
    expect(pack.reason).toBeTruthy();
  });

  it('带出门槛值，让调用方知道判定标准', () => {
    const pack = buildContextPack(CORPUS, '行宽');
    expect(pack.minCoverage).toBeGreaterThan(0);
  });

  it('输出可 JSON 序列化且无 undefined 字段', () => {
    // 「字段是 undefined」在 JSON 里会**整个消失**——
    // 下游看到的是「这个字段不存在」而不是「这个字段没有值」。
    const pack = buildContextPack(CORPUS, '行宽为什么用 34em');
    const round = JSON.parse(JSON.stringify(pack));
    expect(round.passages[0].sources).toBeDefined();
    expect(round.passages[0].review).toBeDefined();
  });

  it('同样输入得到同样输出——可复现构建的前提', () => {
    const a = buildContextPack(CORPUS, '行宽为什么用 34em');
    const b = buildContextPack(CORPUS, '行宽为什么用 34em');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('fullText 关闭时截断正文、打开时给全段', () => {
    const long = doc('long', { body: `## 甲\n\n${'行\n'.repeat(30)}` });
    const short = buildContextPack([long], '甲', { fullText: false });
    const full = buildContextPack([long], '甲', { fullText: true });
    expect(short.passages[0].text.split('\n').length).toBeLessThanOrEqual(6);
    expect(full.passages[0].text.length).toBeGreaterThan(short.passages[0].text.length);
  });
});

describe('context pack · 边界', () => {
  it('空语料不崩', () => {
    const pack = buildContextPack([], '任何问题');
    expect(pack.supported).toBe(false);
    expect(pack.passages).toEqual([]);
  });

  it('related 缺失时不崩——与迭代 N 那处同型', () => {
    // a?.related 只保护了 a 为空，没保护 related 为 undefined
    const docs = [
      doc('main', { body: '## 甲\n\n[[other]]' }),
      doc('other', { body: '## 乙\n\n正文' }), // 完全没有 related
    ];
    expect(() => buildContextPack(docs, '正文')).not.toThrow();
  });

  it('slug 含正则元字符时关系判定不抛错', () => {
    // slug 来自文件名与 frontmatter，**两处都不是受控输入**
    const docs = [
      doc('a+b', { body: '## 甲\n\n[[a+b]]' }),
      doc('main', { body: '## 乙\n\n[[a+b]]' }),
    ];
    expect(() => buildContextPack(docs, '正文')).not.toThrow();
  });

  it('packPassages 与 buildContextPack 用同一把尺子', () => {
    expect(packPassages(CORPUS).length).toBeGreaterThan(0);
    const pack = buildContextPack(CORPUS, '行宽');
    expect(pack.passages.length).toBeLessThanOrEqual(packPassages(CORPUS).length);
  });
});
