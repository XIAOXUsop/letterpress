/**
 * 检索层的单元测试。
 *
 * ── 它和金标（`knowledge/questions.md`）的分工 ──────────────────────
 *
 * 金标在**真实语料**上端到端跑，量的是「这套东西在真内容上准不准」。
 * 这里在**合成语料**上逐条量每一道闸，量的是「每个部件单独对不对」。
 *
 * 两者都需要，因为**金标覆盖不到所有闸**——这是实测出来的，不是设想的：
 * 把 `MIN_COVERAGE` 改成 0 之后，18 条金标**一条都没变红**。
 * 原因是实词闸（闸二）先一步拦住了那些查询。也就是说
 * **闸一当前没有被任何一条金标量到**，它只在这里被测。
 *
 * 一个没被量过的闸，和没有这个闸是一回事——所以下面有一条专门喂给它。
 */
import { describe, expect, it } from 'vitest';
import {
  assess,
  documentFrequency,
  idf,
  isSubjectTerm,
  junctionsOf,
  rank,
  splitPassages,
  termWeight,
  tokenize,
} from './retrieve.js';

/** 造一份小语料：`{ docId: 正文 }`。 */
function corpus(docs: Record<string, string>) {
  return Object.entries(docs).flatMap(([id, body]) => splitPassages(id, body));
}

describe('分词', () => {
  it('中文切二元组，西文切词', () => {
    expect(tokenize('行宽')).toEqual(['行宽']);
    expect(tokenize('中文排版')).toEqual(['中文', '文排', '排版']);
    // 带连字符的西文标识符算**一个**词——`text-autospace` 拆成
    // `text` + `autospace` 的话，查询与正文两边会同时拆，看着没差；
    // 但 `q=1.0` 这类会碎成 `q`、`1.0`，而 `q` 在每一页都有，噪声极大。
    expect(tokenize('34em 与 text-autospace')).toEqual(['与', '34em', 'text-autospace']);
  });

  it('全角与大小写归一后再切', () => {
    // 不归一的话「（」与「(」是两个不同的词，查询和正文就永远对不上
    expect(tokenize('Tailwind')).toEqual(['tailwind']);
    expect(tokenize('（a）')).toEqual(['a']);
  });

  it('单个汉字不会被丢掉', () => {
    // 二元组循环 `i + 1 < len` 在长度为 1 时一次都不执行——**这是很容易漏的分支**
    expect(tokenize('书')).toEqual(['书']);
  });
});

describe('idf', () => {
  it('语料里没有的词，权重**最高**，不是最低', () => {
    // 这一条钉住一个方向反了的 bug：早先写作 `df.get(term) ?? docCount`，
    // 于是「从未出现过」被当成「出现在所有文档里」。
    // 症状是**检索器用问题的虚词回答问题的实词**（实测：Webmention 那次）。
    const df = new Map([['常见', 6], ['少见', 1]]);
    expect(idf(df, 6, '从未出现')).toBeGreaterThan(idf(df, 6, '少见'));
    expect(idf(df, 6, '少见')).toBeGreaterThan(idf(df, 6, '常见'));
  });

  it('出现在全部文档里的词权重仍然为正', () => {
    // 用 log(N/df) 的话这里是 0，覆盖度就永远反映不出「命中了多少」
    expect(idf(new Map([['到处都有', 6]]), 6, '到处都有')).toBeGreaterThan(0);
  });
});

describe('实词判定', () => {
  it('含虚词的二元组不是实词，不含的是', () => {
    expect(isSubjectTerm('实现')).toBe(true);
    expect(isSubjectTerm('么实')).toBe(false); // 「么」是虚词
    expect(isSubjectTerm('站不')).toBe(false); // 「不」是虚词
  });

  it('西文 token 一律算实词', () => {
    expect(isSubjectTerm('webmention')).toBe(true);
  });
});

describe('跨词接缝识别', () => {
  it('两个字各自属于别的已知词时，判为接缝', () => {
    const df = new Map([['样式', 1], ['方案', 1], ['行宽', 1]]);
    const j = junctionsOf(['样式', '式方', '方案'], df);
    expect(j.has('式方')).toBe(true);
  });

  it('**真的缺席的词不会被误判成接缝**', () => {
    // 「评论区」的「评」与「论」都没有别的已知词托底，所以它不是接缝，
    // 会保留权重——这正是「怎么加评论区」能正确报「没有依据」的原因。
    const df = new Map([['怎么', 3], ['实现', 1]]);
    const j = junctionsOf(['怎么', '么加', '加评', '评论', '论区'], df);
    expect(j.has('评论')).toBe(false);
    expect(j.has('加评')).toBe(false);
  });

  it('语料里真的存在的二元组不算接缝', () => {
    const df = new Map([['样式', 1], ['式方', 1], ['方案', 1]]);
    expect(junctionsOf(['样式', '式方', '方案'], df).has('式方')).toBe(false);
  });
});

describe('闸二：最重的实词必须存在于知识层', () => {
  const passages = corpus({
    a: '## 行宽\n\n中文正文的理想行宽是 34em，不用 ch 是因为它随字体浮动。',
  });

  it('缺席的西文专名会被拦下', () => {
    const r = assess(passages, '怎么接 Stripe 支付');
    expect(r.supported).toBe(false);
    expect(r.reason).toContain('stripe');
  });

  it('**虚词命中得再密也替代不了实词**', () => {
    // 实测原型：问「Webmention 是怎么实现的」，`怎么`、`么实`、`实现` 三处命中，
    // 覆盖度 0.53 轻松过闸——而全站根本没有 webmention 这个词。
    const r = assess(passages, 'Webmention 是怎么实现的');
    expect(r.supported).toBe(false);
    expect(r.reason).toContain('webmention');
  });

  it('实词都在语料里时，闸二放行', () => {
    expect(assess(passages, '中文正文的理想行宽是多少').supported).toBe(true);
  });
});

describe('闸一：覆盖度（金标量不到它，只在这里量）', () => {
  /**
   * 所有实词都**存在**于语料，但没有一页回答得了这个问题。
   *
   * 造法（数字是算过的，不是碰巧）：语料里只有 `字体子集` 与 `构建` 两组词，
   * 而问句里除它们之外还有十来组词（`脚本`、`统计`、`总量`、`完整性`、`校验`…）
   * 在语料里**一次都没出现**。闸二会放行——因为权重最高的那个实词
   * `体子` 恰好在语料里（`字体子集` 切出来的）。只有闸一能拦下它。
   */
  const passages = corpus({
    fonts: '## 字体\n\n字体子集',
    build: '## 别的\n\n构建',
  });

  it('词都在、但没一页答得出来 → 拦下', () => {
    const r = assess(passages, '构建脚本怎么统计字体子集的总量并做完整性校验');
    expect(r.supported).toBe(false);
    expect(r.reason).toContain('低于门槛');
  });

  it('同一份语料上，真答得出来的问题照样通过', () => {
    // 没有这一条的话，上面那条可能只是因为「这个语料什么都答不出来」而恒真
    expect(assess(passages, '字体子集是什么').supported).toBe(true);
  });

  it('门槛是**可调的数字**，不是写死的常数被悄悄放宽', () => {
    // 这条防的是「为了让某条用例过而把门槛调低」。门槛一旦低于
    // 「一个普通词的分量」，闸一就退化成恒真。
    const r = assess(passages, '构建脚本怎么统计字体子集的总量并做完整性校验');
    const top = r.docs[0]?.coverage ?? 0;
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(0.34);
  });
});

describe('覆盖度按文档合并，不按段落取最大', () => {
  /**
   * 答案横跨同一页的两个小节，而**任何单独一节都答不全**。
   * 逐段算的话，两段双双掉到门槛下——而「这一页答得出来」是文档级的事实。
   *
   * 实测原型：问「为什么不用 Tailwind」，「不用 Tailwind」在 letterpress 的
   * 「不做什么」一节，「样式 | 手写 CSS」在**同一页**的「技术选择」表格里。
   */
  const passages = corpus({
    page: [
      '## 不做什么',
      '',
      '不做生成器，不用 Tailwind，不做数据库。',
      '',
      '## 技术选择',
      '',
      '| 项 | 选择 |',
      '|---|---|',
      '| 样式 | 手写 CSS + @layer |',
    ].join('\n'),
  });

  it('两个小节合起来够门槛，单独一节不够', () => {
    const r = assess(passages, '为什么不用 Tailwind，样式方案是什么');
    expect(r.supported).toBe(true);
    // 逐段的最大值确实低于文档级的值——否则这条测试没量到「合并」这件事
    const perPassage = Math.max(...r.passages.map((p) => p.coverage));
    const perDoc = r.docs[0].coverage;
    expect(perPassage).toBeLessThan(perDoc);
  });
});

describe('排序', () => {
  const passages = corpus({
    one: '## 甲\n\n甲甲甲 甲乙丙 甲乙丙 甲乙丙',
    two: '## 乙\n\n乙乙乙',
  });

  it('结果确定：同样的输入永远同样的顺序', () => {
    // 不确定的排序会让金标随机地红，而那种红最容易被当成「偶发」忽略掉
    const a = rank(passages, '甲乙丙').map((p) => p.id);
    const b = rank(passages, '甲乙丙').map((p) => p.id);
    expect(a).toEqual(b);
  });

  it('perDoc 生效：一页不会霸榜', () => {
    const many = corpus({
      big: Array.from({ length: 10 }, (_, i) => `## 节${i}\n\n行宽 行宽 行宽 行宽`).join('\n\n'),
      small: '## 小\n\n行宽',
    });
    const r = rank(many, '行宽', { limit: 6, perDoc: 2 });
    expect(r.filter((p) => p.docId === 'big').length).toBeLessThanOrEqual(2);
  });

  it('一个词都没命中的段落不进结果', () => {
    expect(rank(passages, '完全不相干的词')).toEqual([]);
  });
});

describe('切段', () => {
  it('标题留进段落里', () => {
    // 标题是最强的信号之一：问「行宽」时 `## 34em 这个数字` 这一行最有用
    const ps = splitPassages('d', '## 标题甲\n\n正文甲\n\n## 标题乙\n\n正文乙');
    expect(ps).toHaveLength(2);
    expect(ps[0].text).toContain('标题甲');
    expect(ps[1].heading).toBe('标题乙');
  });

  it('空段落不产出', () => {
    expect(splitPassages('d', '\n\n\n')).toEqual([]);
  });

  it('段落 id 在同一文档内唯一且稳定', () => {
    const ps = splitPassages('d', '## 甲\n\nx\n\n## 乙\n\ny');
    expect(ps.map((p) => p.id)).toEqual(['d#0', 'd#1']);
  });
});

describe('文档频次', () => {
  it('按**文档**数，不是按段落数', () => {
    // 按段落数的话，一个词在同一页里出现 10 次会被当成 10 个文档，
    // idf 就变成了「这页写了多少遍」而不是「多少页写了它」
    const ps = corpus({ a: '## 甲\n\n行宽\n\n## 乙\n\n行宽\n\n## 丙\n\n行宽', b: '## 丁\n\n行宽' });
    expect(documentFrequency(ps).get('行宽')).toBe(2);
  });
});

// ── 单字母不该有权重 ──────────────────────────────────────────────────
/**
 * 实测出来的缺陷（2026-09-24）：把语料从「只有 wiki」扩到「wiki + posts」后，
 * 金标里「怎么做 A/B 测试？」这一条翻绿了——检索器说 `reproducible-builds`
 * 覆盖 44%，于是判定「有依据」。
 *
 * 去看它到底命中了什么：
 *
 *     命中词：['b', 'a']    覆盖：0.4436
 *
 * **`A/B` 被切成了 `a` 和 `b` 两个单字母**，而「测试」根本没进命中词。
 * 根因在 `termWeight`：ASCII 词只要语料里出现过就按 IDF 给权重，
 * 而 `a` / `b` 这种字母在任何含英文的文本里都大量出现——
 * **它们几乎必然命中，于是必然贡献覆盖。**
 *
 * 后果很具体：一条期望「无依据」的问题被判成「有依据」，
 * 而真正相关的「测试」一词压根没被算进去。
 */
describe('termWeight · 单字母 ASCII', () => {
  const idfOf = (term: string) => termWeight(new Map([[term, 5]]), 10, term, 1);

  it('单字母 ASCII 权重为 0——它们在任何英文文本里都会出现', () => {
    expect(idfOf('a')).toBe(0);
    expect(idfOf('b')).toBe(0);
    expect(idfOf('x')).toBe(0);
  });

  it('两个字母的缩写仍有权重——那是真词（A/B、MVP、CI）', () => {
    // 边界不能一起砍掉：`A/B 测试` 里的 `a`、`b` 是噪声，
    // 而 `CI` 里的 `ci` 是货真价实的术语。**长度就是这条线。**
    expect(idfOf('ci')).toBeGreaterThan(0);
    expect(idfOf('ab')).toBeGreaterThan(0);
  });

  it('多字母 ASCII 词照常有权重', () => {
    expect(idfOf('markdown')).toBeGreaterThan(0);
  });

  it('中文单字不受影响——「文」这类字不是这个问题', () => {
    // 中文没有「单字母」这回事：切出来的是一个字，而字是有语义的。
    // 砍 ASCII 单字母不能顺手把中文单字也砍掉。
    expect(termWeight(new Map([['行', 1]]), 10, '行', 1)).toBeGreaterThan(0);
  });
});
