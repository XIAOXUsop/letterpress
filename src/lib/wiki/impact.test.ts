import { describe, expect, it } from 'vitest';
import { computeImpact, isDisjoint, type ImpactPage } from './impact.js';

function page(slug: string, over: Partial<ImpactPage> = {}): ImpactPage {
  return { slug, title: slug, refs: [], related: [], ...over };
}

function ref(sourceId: string, revision: string, locator = '') {
  return { sourceId, revision, locator };
}

const S = 'src-a';

describe('computeImpact · 直接引用者', () => {
  it('找出明确引用了该来源的页面', () => {
    const pages = [
      page('a', { refs: [ref(S, 'v1')] }),
      page('b', { refs: [ref(S, 'v1')] }),
      page('c', { refs: [ref('other', 'v1')] }),
    ];
    expect(computeImpact(pages, S).direct.map((p) => p.slug)).toEqual(['a', 'b']);
  });

  it('指定版本时，只认引用那一版的页面', () => {
    const pages = [page('a', { refs: [ref(S, 'v1')] }), page('b', { refs: [ref(S, 'v2')] })];
    expect(computeImpact(pages, S, 'v1').direct.map((p) => p.slug)).toEqual(['a']);
    expect(computeImpact(pages, S, 'v2').direct.map((p) => p.slug)).toEqual(['b']);
  });

  it('不指定版本时，该来源的所有版本都算', () => {
    const pages = [page('a', { refs: [ref(S, 'v1')] }), page('b', { refs: [ref(S, 'v2')] })];
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
      page('a', { refs: [ref(S, 'v1')] }),
      page('b', { refs: [ref(S, 'v1'), ref(S, 'v1', '§2')] }),
      page('c', { refs: [ref(S, 'v1', '§3')] }),
      page('d', { refs: [ref(S, 'v1')] }),
      page('unrelated', { refs: [ref('other-source', 'v9')] }),
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
    const pages = [page('a', { refs: [ref(S, 'v1')], related: ['b'] }), page('b')];
    const { candidates } = computeImpact(pages, S);
    expect(candidates.get('b')).toBe('a');
  });

  it('包含声明指向直接引用者的页面——反向也要算', () => {
    // 「A 引了来源，B 引了 A」里的 B 是最可能需要一起复查的一篇。
    // 只算正向就会漏掉它，而漏掉它不会有任何报错。
    const pages = [page('a', { refs: [ref(S, 'v1')] }), page('b', { related: ['a'] })];
    const { candidates } = computeImpact(pages, S);
    expect(candidates.get('b')).toBe('a');
  });

  it('直接引用者自己不算候选', () => {
    const pages = [page('a', { refs: [ref(S, 'v1')], related: ['a'] })];
    expect(computeImpact(pages, S).candidates.size).toBe(0);
  });

  it('不存在的 slug 不进候选——断链是 lint 的职责，不该混成噪声', () => {
    const pages = [page('a', { refs: [ref(S, 'v1')], related: ['ghost'] })];
    expect(computeImpact(pages, S).candidates.size).toBe(0);
  });

  it('两个方向都命中同一页时只列一次', () => {
    const pages = [
      page('a', { refs: [ref(S, 'v1')], related: ['b'] }),
      page('b', { related: ['a'] }),
    ];
    const { candidates } = computeImpact(pages, S);
    expect([...candidates.keys()]).toEqual(['b']);
  });
});

describe('三组互不重叠', () => {
  it('已在①里列过的页面不出现在③', () => {
    const pages = [page('a', { refs: [ref(S, 'v1')] })];
    const result = computeImpact(pages, S);
    // ③ 扫仓库时命中了同一篇 wiki 页——重叠会让人以为"还有别处要改"
    expect(isDisjoint(result, ['src/content/wiki/a.md'])).toBe(false);
  });

  it('真正不同的辅助载体不算重叠', () => {
    const pages = [page('a', { refs: [ref(S, 'v1')] })];
    const result = computeImpact(pages, S);
    expect(isDisjoint(result, ['docs/cjk-typography.md', 'src/styles/tokens.css'])).toBe(true);
  });

  it('非 wiki 路径即使同名也不算重叠', () => {
    const pages = [page('a', { refs: [ref(S, 'v1')] })];
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
