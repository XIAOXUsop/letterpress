#!/usr/bin/env node
/**
 * 第二份内容集：用一份**刻意与本站不同**的合成内容集跑核心流程。
 *
 * ── 它量的是什么 ────────────────────────────────────────────────────
 *
 * 路线图阶段 4 有一条退出条件：「**一个全新的真实内容集能在不复制内部代码
 * 的情况下使用核心流程**」。本仓库至今只有一个站点，所以这份合成的
 * 异构内容集是那条退出条件的**第一次实测**（不是证明——合成语料不是真实站点）。
 *
 * 它与本站处处不同：
 *   - 全部英文 slug（本站是英文 + 中文混合）
 *   - 全部显式 `slug`（本站多数靠文件名推导）
 *   - kind 用 `entity`（本站 5 concept / 1 entity）
 *   - 有一对同名标题、一条断链、一个真孤儿页、一处 `related` 声明
 *
 * ── 它第一次跑就抓到了一个真 bug ────────────────────────────────────
 *
 * `computeImpact` 在 `refs` 缺失时崩溃（`undefined.some`）——
 * 因为 `ImpactPage.refs` 标成必填，而真实的 `Doc.sources` 是可选的。
 * 站内两个调用方都老实填了空数组，**默认值救了它**。
 * 已修：字段改可选 + 实现兜底 + 3 条用例。
 *
 * ⚠️ **这个探针自己也写错过三次**（`ledger` 其实有入链、
 * `sources` 与 `refs` 字段名对不上、`shared-two` 是 entity 不算孤儿页）。
 * 每次都是「探针报错」被误当成「实现有 bug」。**探针也要被验证。**
 */
import { buildGraph } from '../src/lib/wiki/graph.ts';
import { lint, hasErrors } from '../src/lib/wiki/lint.ts';
import { computeImpact, isDisjoint } from '../src/lib/wiki/impact.ts';
import { resolveSlug, containsCjk } from '../src/lib/wiki/slug.ts';

const docs = [
  { kind: 'wiki', slug: 'payments', title: 'Payments', summary: 'How money moves.',
    body: '## Overview\n\nSee [[risk]] and [[ledger]].\n\n## Details\n\nMore.',
    explicitSlug: true, draft: false },
  { kind: 'wiki', slug: 'risk', title: 'Risk', summary: 'Risk controls.',
    body: '## Overview\n\nReferenced by [[payments]].\n\n## Controls\n\nLedger first.',
    explicitSlug: true, draft: false, declaredRelations: ['payments'] },
  { kind: 'wiki', slug: 'ledger', title: 'Ledger', summary: 'Double-entry bookkeeping.',
    body: '## Overview\n\nNothing links here.', explicitSlug: true, draft: false },
  { kind: 'entity', slug: 'shared', title: 'Shared', summary: 'A page named Shared.',
    body: '## A\n\ntext', explicitSlug: true, draft: false, wikiKind: 'entity' },
  { kind: 'entity', slug: 'shared-two', title: 'Shared', summary: 'Another Shared.',
    body: '## B\n\ntext', explicitSlug: true, draft: false, wikiKind: 'entity' },
  { kind: 'wiki', slug: 'orphan-note', title: 'Orphan Note', summary: 'Nobody links here.',
    body: '## A\n\ntext', explicitSlug: true, draft: false },
  { kind: 'wiki', slug: 'broken', title: 'Broken', summary: 'Links nowhere.',
    body: '## A\n\n[[does-not-exist]]', explicitSlug: true, draft: false,
    sources: [{ sourceId: 'ext', revision: 'v1' }] },
];

const graph = buildGraph(docs);
const issues = lint(docs, graph, { checkWikilinks: true, checkOrphans: true });
// ⚠️ 字段名要对：真实 Doc 是 `sources` / `declaredRelations`，
// 而 ImpactPage 要的是 `refs` / `related`。第一版直接传 docs，
// 于是「直接引用者 0」——**是我的探针错了，不是实现错了**。
const impactPages = docs.map((d) => ({
  slug: d.slug,
  title: d.title,
  refs: d.sources ?? [],
  related: d.declaredRelations ?? [],
}));
const impact = computeImpact(impactPages, 'ext');

const checks = [
  ['断链被 lint 抓到', graph.broken.length === 1 && graph.broken[0].target === 'does-not-exist'],
  ['同名标题形成歧义', graph.ambiguousTitles.size === 1],
  ['孤儿页被识别（只算 wiki，entity 不算）',
    graph.orphans.includes('orphan-note') && !graph.orphans.includes('shared-two')],
  ['ledger 的入链来自 payments', graph.backlinks.get('risk')?.some((b) => b.fromSlug === 'payments') === true],
  ['影响分析可用（直接引用者 1）', impact.direct.length === 1 && impact.direct[0].slug === 'broken'],
  ['影响分析三组互不重叠', isDisjoint(impact, [])],
  ['lint 判为有错误', hasErrors(issues)],
  ['slug 解析对纯英文标题有效', resolveSlug('Payments', 'payments', 'x') === 'payments'],
  ['CJK 检测对英文标题为 false', containsCjk('Payments') === false],
];

let bad = 0;
for (const [name, ok] of checks) { if (!ok) bad++; console.log(`  ${ok ? '+' : '-'} ${name}`); }
console.log(bad === 0 ? '\n核心流程在异构内容集上全部成立。' : `\n${bad} 项不成立。`);
process.exit(bad === 0 ? 0 : 1);
