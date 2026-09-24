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
    expect(Object.keys(doc).sort()).toEqual([
      'body', 'declaredRelations', 'draft', 'explicitSlug', 'kind',
      'slug', 'sources', 'summary', 'title', 'wikiKind',
    ]);
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

  it('wikiKind 取 page.kind（知识类型），不是 Doc.kind（文档类型）', () => {
    const doc = pageToDoc(page, { docKind: 'wiki' });
    expect(doc.kind).toBe('wiki');          // 文档类型
    expect(doc.wikiKind).toBe('concept');   // 知识类型
  });

  it('docKind 默认 wiki，可显式给 post', () => {
    expect(pageToDoc(page, {}).kind).toBe('wiki');
    expect(pageToDoc(page, { docKind: 'post' }).kind).toBe('post');
  });

  it('草稿默认 false——buildGraph 会滤掉它', () => {
    expect(pageToDoc(page, {}).draft).toBe(false);
    expect(pageToDoc(page, { draft: true }).draft).toBe(true);
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
