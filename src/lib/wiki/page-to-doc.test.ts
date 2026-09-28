import { describe, expect, it } from 'vitest';
import { pageToDoc } from './page-to-doc.js';

/**
 * `pageToDoc` 是迭代 AS 从「每个站点都要重写一遍的接线」里抽出来的。
 *
 * 抽它的理由不是「代码复用」，是路线图阶段 4 退出条件第 1 条：
 * 「**不复制内部代码**」。而实测那 27 行适配层里**只有 5 行是站点专属的**，
 * 其余 22 行每个站点都要重写一遍同样的转换。
 */

const page = {
  slug: 'abc',
  title: '甲',
  kind: 'concept',
  body: '正文。',
  sources: [{ sourceId: 's1', revision: 'v1', locator: '§1' }],
  related: [],
};

describe('pageToDoc', () => {
  it('给出与 Doc 契约一致的字段名', () => {
    const doc = pageToDoc(page, { summary: '摘要' });
    // ⚠️ `declaredRelations` **不是** `related`——传错键会被 `?? []`
    // 静静兜成空数组，摘要照样算得出，只是永远对不上。
    //
    // ⚠️ `review` **默认不在**里面：`page` 固件没有它，而 `Doc.review` 是可选的。
    // 「字段集合固定」这条不变——变的只是**哪些键出现**（见下一条）。
    expect(Object.keys(doc).sort()).toEqual([
      'body', 'declaredRelations', 'draft', 'explicitSlug', 'kind',
      'slug', 'sources', 'summary', 'title', 'wikiKind',
    ]);
  });

  /**
   * ⚠️ **2026-09-28 加。`post` 的键集合比 `wiki` 少两个。**
   *
   * `wikiKind` 与 `review` 是**知识层专属**的——构建侧 `toDoc` 对 `post`
   * 两处都给 `undefined`。若读路径照给，**同一页在两个出口形状不同**。
   *
   * > 用「省略键」而不是「给 undefined」：两者 `Doc.x` 读起来一样，
   * > 但 `Object.keys()` 与 `JSON.stringify` 会不同——
   * > 而 `content-manifest` 正是把 `Doc` 序列化出去的。
   */
  it('post 的键集合少 wikiKind 与 review——与构建侧同一口径', () => {
    const withReview = { ...page, review: { status: 'reviewed' as const, checkedAt: '2026-01-01' } };
    const wikiKeys = Object.keys(pageToDoc(withReview, { docKind: 'wiki' })).sort();
    const postKeys = Object.keys(pageToDoc(withReview, { docKind: 'post' })).sort();
    expect(wikiKeys).toContain('wikiKind');
    expect(wikiKeys).toContain('review');
    expect(postKeys).not.toContain('wikiKind');
    expect(postKeys).not.toContain('review');
    // 其余键**一个都不少**——差别只在这两个，不是一大截。
    expect(postKeys.length).toBe(wikiKeys.length - 2);
  });

  /**
   * ⚠️ **「键不出现」与「键在、值 undefined」在产物上没有区别。**
   *
   * 2026-09-28 我在注释里写「`JSON.stringify` 会不同、manifest 会不一致」——
   * **那是夸大了**：实测两边序列化后**逐字节相同**，因为 `undefined` 的值
   * 会被 `JSON.stringify` 丢掉。差别只在内存里那个对象的键集合。
   *
   * 这条断言把那个实测钉住，免得下次又照着错的前提往下推。
   */
  it('省略键与给 undefined 在 JSON 产物上完全相同——差别只在键集合', () => {
    const noReview = { ...page };
    delete (noReview as { review?: unknown }).review;
    const doc = pageToDoc(noReview, { docKind: 'wiki' });
    expect('review' in doc).toBe(false);
    // 序列化后不含 review 键——这才是产物里看得见的
    expect(JSON.parse(JSON.stringify(doc))).not.toHaveProperty('review');
    // 而「键在、值 undefined」那种写法，序列化后也一样不含
    expect(JSON.parse(JSON.stringify({ ...doc, review: undefined }))).not.toHaveProperty('review');
  });

  it('关系用 declaredRelations，且默认取 page.related', () => {
    const withRelated = { ...page, related: ['x', 'y'] };
    expect(pageToDoc(withRelated, {}).declaredRelations).toEqual(['x', 'y']);
  });

  it('relations 选项覆盖 page.related——那是「站点翻译」的入口', () => {
    // 异构站点把关系声明叫 `audience`，适配层翻译后从 options 传进来
    const withRelated = { ...page, related: ['不应被用'] };
    expect(pageToDoc(withRelated, { relations: ['翻译后'] }).declaredRelations)
      .toEqual(['翻译后']);
  });

  it('summary 缺省是空串而不是 undefined——Doc.summary 是必填 string', () => {
    // lint 直接调 doc.summary.trim()，undefined 会在那里崩
    expect(pageToDoc(page, {}).summary).toBe('');
  });

  /**
   * ⚠️ **2026-09-28 加。** `readContentDirs` 已经顺带补上 `summary`，
   * 所以读一整个语料时**不必再传 options**。
   *
   * 空摘要不是「少了个字段」，它会让 lint 多报 6 条——
   * 所以这条兜底链（`options.summary ?? page.summary ?? ''`）
   * 决定了一个接线写错的人看到的是「正常」还是「核心坏了」。
   */
  it('不传 options 时从 page.summary 取（readContentDirs 已经补好的）', () => {
    expect(pageToDoc({ ...page, summary: '甲的摘要。' }, {}).summary).toBe('甲的摘要。');
  });

  it('显式传入的 summary 优先于 page.summary', () => {
    expect(pageToDoc({ ...page, summary: '页面的' }, { summary: '调用方的' }).summary)
      .toBe('调用方的');
  });

  it('page.summary 是空串时不会被显式传入顶掉', () => {
    // 空串是**已读到了、确实没有**，而 undefined 是**没读**。
    // 两者都要尊重调用方的显式值——否则「显式传空以清空摘要」做不到。
    expect(pageToDoc({ ...page, summary: '' }, { summary: '调用方的' }).summary)
      .toBe('调用方的');
  });

  it('wikiKind 取 page.kind（知识类型），不是 Doc.kind（文档类型）', () => {
    const doc = pageToDoc(page, { docKind: 'wiki' });
    expect(doc.kind).toBe('wiki');          // 文档类型
    expect(doc.wikiKind).toBe('concept');   // 知识类型
  });

  it('docKind 默认 wiki，可显式给 post', () => {
    expect(pageToDoc(page, {}).kind).toBe('wiki');
    expect(pageToDoc(page, { docKind: 'post' }).kind).toBe('post');
  });

  /**
   * ⚠️ **2026-09-28 加。这条对齐的是「构建侧的口径」，不是设计偏好。**
   *
   * `src/lib/content.ts` 的 `toDoc` 写的是
   * `kind === 'wiki' ? data.related : []`，而 `src/content.config.ts` 的
   * **posts schema 里根本没有 `related` 这个键**——所以文章里写了会被 zod 剥掉。
   * 读路径若照收，**同一页在构建产物与 CLI 回答里关系就不同**。
   *
   * > 本仓库 posts 里 0 篇写 `related:`，所以**这个分歧从未发作**——
   * > 而「新站点会在文章里写关系」是很正常的一件事。
   */
  it('post 一律没有关系——与构建侧的 `kind === "wiki" ? related : []` 同口径', () => {
    const withRel = { ...page, related: ['乙'] };
    expect(pageToDoc(withRel, { docKind: 'post' }).declaredRelations).toEqual([]);
    expect(pageToDoc(withRel, { docKind: 'wiki' }).declaredRelations).toEqual(['乙']);
  });

  it('page.docKind 也管用（readContentDirs 传下来的），且 options 优先', () => {
    // `readContentDirs` 传了 docKind 时会把它带在页上——
    // 而**调用方不该为了这个再手写一遍 map**。
    expect(pageToDoc({ ...page, docKind: 'post' }, {}).declaredRelations).toEqual([]);
    expect(pageToDoc({ ...page, docKind: 'post' }, { docKind: 'wiki' }).declaredRelations)
      .toEqual(page.related);
  });

  it('草稿默认 false——buildGraph 会滤掉它', () => {
    expect(pageToDoc(page, {}).draft).toBe(false);
    expect(pageToDoc(page, { draft: true }).draft).toBe(true);
  });

  it('保留 slug 是否由作者显式指定的信息', () => {
    expect(pageToDoc(page).explicitSlug).toBe(false);
    expect(pageToDoc({ ...page, explicitSlug: true }).explicitSlug).toBe(true);
    expect(pageToDoc({ ...page, explicitSlug: true }, { explicitSlug: false }).explicitSlug).toBe(false);
  });

  /**
   * `id` **不在**这个函数里。
   *
   * `Doc.id` 是**稳定身份**（改名后不变），来自 frontmatter 的 `id:`，
   * 而 `readContentPage` 不读那个字段。要用 id 的调用方走构建期那条路。
   * 在这里加一个 `id` 会让「稳定身份」与「可从文件读出的 slug」混为一谈。
   */
  it('不产出 id——稳定身份走另一条路，不在这里混', () => {
    expect(pageToDoc(page, {})).not.toHaveProperty('id');
  });
});
