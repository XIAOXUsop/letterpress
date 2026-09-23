import { describe, expect, it } from 'vitest';
import { computeImpact, isDisjoint, type ImpactPage } from './impact.js';

function page(slug: string, over: Partial<ImpactPage> = {}): ImpactPage {
  return { slug, title: slug, sources: [], related: [], ...over };
}

function ref(sourceId: string, revision: string, locator = '') {
  return { sourceId, revision, locator };
}

const S = 'src-a';

describe('computeImpact · 直接引用者', () => {
  it('找出明确引用了该来源的页面', () => {
    const pages = [
      page('a', { sources: [ref(S, 'v1')] }),
      page('b', { sources: [ref(S, 'v1')] }),
      page('c', { sources: [ref('other', 'v1')] }),
    ];
    expect(computeImpact(pages, S).direct.map((p) => p.slug)).toEqual(['a', 'b']);
  });

  it('指定版本时，只认引用那一版的页面', () => {
    const pages = [page('a', { sources: [ref(S, 'v1')] }), page('b', { sources: [ref(S, 'v2')] })];
    expect(computeImpact(pages, S, 'v1').direct.map((p) => p.slug)).toEqual(['a']);
    expect(computeImpact(pages, S, 'v2').direct.map((p) => p.slug)).toEqual(['b']);
  });

  it('不指定版本时，该来源的所有版本都算', () => {
    const pages = [page('a', { sources: [ref(S, 'v1')] }), page('b', { sources: [ref(S, 'v2')] })];
    expect(computeImpact(pages, S).direct.map((p) => p.slug)).toEqual(['a', 'b']);
  });

  /*
   * ── 阶段 3 的核心退出条件 ──────────────────────────────────────────
   *
   * 「对预埋的显式来源变更，直接影响召回率为 100%」。
   *
   * 这里的做法是**穷举**：对每个「声称引用了 S」的页面，
   * 断言它一定出现在结果里。反过来也断言——多出来的才是误召回。
   * 两条合起来才是「100%」，只查一条会漏掉另一半。
   */
  it('预埋的来源变更：召回率 100%，且无误召回', () => {
    const pages = [
      page('a', { sources: [ref(S, 'v1')] }),
      page('b', { sources: [ref(S, 'v1'), ref(S, 'v1', '§2')] }),
      page('c', { sources: [ref(S, 'v1', '§3')] }),
      page('d', { sources: [ref(S, 'v1')] }),
      page('unrelated', { sources: [ref('other-source', 'v9')] }),
      page('no-refs'),
    ];
    const expected = ['a', 'b', 'c', 'd'];
    const got = computeImpact(pages, S, 'v1').direct.map((p) => p.slug);

    // 漏召回
    expect(got.filter((s) => expected.includes(s))).toEqual(expected);
    // 误召回
    expect(got.filter((s) => !expected.includes(s))).toEqual([]);
  });
});

describe('computeImpact · 一跳邻居只是候选', () => {
  it('包含直接引用者声明指向的页面', () => {
    const pages = [page('a', { sources: [ref(S, 'v1')], related: ['b'] }), page('b')];
    const { candidates } = computeImpact(pages, S);
    expect(candidates.get('b')).toBe('a');
  });

  it('包含声明指向直接引用者的页面——反向也要算', () => {
    // 「A 引了来源，B 引了 A」里的 B 是最可能需要一起复查的一篇。
    // 只算正向就会漏掉它，而漏掉它不会有任何报错。
    const pages = [page('a', { sources: [ref(S, 'v1')] }), page('b', { related: ['a'] })];
    const { candidates } = computeImpact(pages, S);
    expect(candidates.get('b')).toBe('a');
  });

  it('直接引用者自己不算候选', () => {
    const pages = [page('a', { sources: [ref(S, 'v1')], related: ['a'] })];
    expect(computeImpact(pages, S).candidates.size).toBe(0);
  });

  it('不存在的 slug 不进候选——断链是 lint 的职责，不该混成噪声', () => {
    const pages = [page('a', { sources: [ref(S, 'v1')], related: ['ghost'] })];
    expect(computeImpact(pages, S).candidates.size).toBe(0);
  });

  it('两个方向都命中同一页时只列一次', () => {
    const pages = [
      page('a', { sources: [ref(S, 'v1')], related: ['b'] }),
      page('b', { related: ['a'] }),
    ];
    const { candidates } = computeImpact(pages, S);
    expect([...candidates.keys()]).toEqual(['b']);
  });
});

describe('三组互不重叠', () => {
  it('已在①里列过的页面不出现在③', () => {
    const pages = [page('a', { sources: [ref(S, 'v1')] })];
    const result = computeImpact(pages, S);
    // ③ 扫仓库时命中了同一篇 wiki 页——重叠会让人以为"还有别处要改"
    expect(isDisjoint(result, ['src/content/wiki/a.md'])).toBe(false);
  });

  it('真正不同的辅助载体不算重叠', () => {
    const pages = [page('a', { sources: [ref(S, 'v1')] })];
    const result = computeImpact(pages, S);
    expect(isDisjoint(result, ['docs/cjk-typography.md', 'src/styles/tokens.css'])).toBe(true);
  });

  it('非 wiki 路径即使同名也不算重叠', () => {
    const pages = [page('a', { sources: [ref(S, 'v1')] })];
    const result = computeImpact(pages, S);
    expect(isDisjoint(result, ['docs/a.md'])).toBe(true);
  });
});

describe('边界', () => {
  it('没有任何引用时返回空，不报错', () => {
    const result = computeImpact([page('a'), page('b', { related: ['a'] })], S);
    expect(result.direct).toEqual([]);
    expect(result.candidates.size).toBe(0);
  });

  it('空语料不炸', () => {
    expect(() => computeImpact([], S)).not.toThrow();
  });
});

// ── 输入形状必须容得下真实内容 ────────────────────────────────────────
/**
 * 这一组是**被第二份内容集逼出来的**（2026-09-24）。
 *
 * 背景：路线图阶段 4 有一条退出条件「一个全新的真实内容集能在
 * 不复制内部代码的情况下使用核心流程」。于是拿一份刻意与本站不同的
 * 合成内容集跑了一遍——**当场崩了**：
 *
 *     TypeError: Cannot read properties of undefined (reading 'some')
 *
 * 根因：`ImpactPage.refs` 与 `related` 在类型上都是**必填**，
 * 而真实的 `Doc` 里 `sources` 与 `declaredRelations` **都是可选的**
 * （`Doc.sources?` / `Doc.declaredRelations?`）。
 *
 * > 站内一直没暴露，是因为两个调用方（`read-page.ts` 与 `check-impact.mjs`）
 * > **都老老实实填了空数组**。**默认值救了它**——
 * > 而「默认值救了它」正是最危险的状态：它掩盖了类型与现实脱节。
 *
 * 修法不是「让调用方记得填」，是**类型接受现实**：
 * 字段改成可选，实现里兜底。
 */
describe('输入形状容得下真实内容', () => {
  it('refs 缺失不崩——真实 Doc.sources 是可选的', () => {
    const pages = [
      { slug: 'a', title: '甲' },                                  // 完全没有 refs / related
      { slug: 'b', title: '乙', sources: [ref(S, 'v1')] },
    ] as unknown as ImpactPage[];
    expect(() => computeImpact(pages, S)).not.toThrow();
    expect(computeImpact(pages, S).direct.map((p) => p.slug)).toEqual(['b']);
  });

  it('related 缺失不崩——真实 Doc.declaredRelations 是可选的', () => {
    const pages = [
      { slug: 'a', title: '甲', sources: [ref(S, 'v1')] },           // 缺 related
      { slug: 'b', title: '乙', refs: [], related: ['a'] },
    ] as unknown as ImpactPage[];
    const { direct, candidates } = computeImpact(pages, S);
    expect(direct.map((p) => p.slug)).toEqual(['a']);
    expect(candidates.get('b')).toBe('a');
  });

  it('两者都缺时直接引用者判定仍正确', () => {
    const pages = [{ slug: 'x', title: 'X' }] as unknown as ImpactPage[];
    const result = computeImpact(pages, S);
    expect(result.direct).toEqual([]);
    expect(result.candidates.size).toBe(0);
  });
});
