#!/usr/bin/env node
/**
 * 检索金标的**负向验证**：五道闸逐一失效，每次必须真的让金标变红。
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * README 与 `docs/retrieval.md` 都声称「五道闸每道都有一条**专属**用例」——
 * 而**没有任何门禁核它**。它曾经是假的：
 * 历史记录记着「一道闸被另一道闸遮住时，关掉它金标不会红」。
 *
 * > **「这个闸有人在量」很容易变成想当然。**
 * > 手工验过一次不等于它一直成立——语料一扩、闸一改，遮住关系就变了。
 *
 * 那个手工验证的**结论还被写错进了文档**（`docs/retrieval.md` 写
 * 「**三道**闸各有一条专属用例」，而它自己的表里列了 5 行）。
 * **所以它需要一个能重复跑的检查，而不只是文档里的一句话。**
 *
 * 判据是**退出码**，不是「输出里有几个 ✗」——
 * 后者会把「已知局限」也算进去，而那些**本来就不计为失败**。
 *
 * 用法：`npm run verify:retrieval-gates`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const RETRIEVE = join(ROOT, 'src', 'lib', 'wiki', 'retrieve.ts');
const QUESTIONS = join(ROOT, 'scripts', 'check-questions.mjs');

const original = readFileSync(RETRIEVE, 'utf8');

const runGold = () => spawnSync('node', [QUESTIONS], { cwd: ROOT, encoding: 'utf8' });

/**
 * 五道闸各自的注入方式。
 *
 * ⚠️ 每条都**尽量只动一处**——若改一处就已经让别的判据崩了，
 * 那这条专属用例的归属就不清楚了。
 */
const GATES = [
  {
    name: '闸一：覆盖度门槛归零',
    why: '「实词都在、但没覆盖够比例」这类查询应该被拦下',
    from: 'export const MIN_COVERAGE = 0.34;',
    to: 'export const MIN_COVERAGE = 0;',
  },
  {
    name: '闸二：实词闸失效（单字母与停用词一律算实词）',
    why: '语料里没有的那些专有名词应该被拦下',
    from: 'export function isSubjectTerm(term: string): boolean {',
    to: 'export function isSubjectTerm(term: string): boolean {\n  return true; // MUTATION',
  },
  {
    name: '接缝识别失效（bigram 全部当作普通词）',
    why: '二元组分不出来的东西应当被降权',
    // ⚠️ 第一版锚点写的是 `return junctions.has(key)` —— 那个形状不存在，
    // 于是脚本报「变异没注入」而不是假绿。真实位置是 `junctionsOf` 的判定行。
    from: '    if (charsOfKnown.has(t[0]) && charsOfKnown.has(t[1])) junctions.add(t);',
    to: '    // MUTATION：接缝识别失效',
  },
  {
    name: '单字母权重恢复',
    why: '单字母不该贡献权重——`T 恤衫` 那类查询正是靠这条',
    from: '  if (isAsciiTerm(term) && term.length < 2) return 0;',
    to: '  // MUTATION：单字母不再被排除',
  },
  {
    name: '问句壳剔除失效（覆盖度不再剔除虚词）',
    why: '「为什么 / 怎么 / 什么」不该让覆盖率虚高',
    // ⚠️ 问句壳**没有独立的常量**（`QUESTION_WORDS` 不存在）——
    // 它就是 `coverageWeights` 里的 `filter(isSubjectTerm)`。
    // **与闸二共用 `isSubjectTerm`，但作用点不同**：
    // 闸二在 `termWeight`（决定这个词算不算实词），
    // 这处在 `coverageWeights`（决定它算不算进覆盖度）。
    // **同一道判据被用在两处，两处都要能被独立弄坏。**
    from: '  return new Map(queryTerms.filter(isSubjectTerm).map((t) => [t, full.get(t) ?? 0] as const));',
    to: '  return new Map(queryTerms.map((t) => [t, full.get(t) ?? 0] as const)); // MUTATION',
  },
];

let bad = 0;
console.log('检索金标的负向验证：五道闸逐一失效');
console.log('─'.repeat(64));

const clean = runGold();
if (clean.status !== 0) {
  console.log(`  ✗ 干净状态下金标就不通过（退出码 ${clean.status}）——先修那个`);
  process.exit(1);
}
console.log('  ✓ 干净状态：22/22 通过\n');

for (const gate of GATES) {
  if (!original.includes(gate.from)) {
    console.log(`  ✗ ${gate.name}：锚点在 retrieve.ts 里找不到（源码已漂，**变异没注入**）`);
    bad++;
    continue;
  }
  writeFileSync(RETRIEVE, original.replace(gate.from, gate.to), 'utf8');
  const r = runGold();
  writeFileSync(RETRIEVE, original, 'utf8');

  if (r.status !== 0) {
    const red = (r.stdout ?? '').split('\n').filter((l) => l.includes('✗'));
    console.log(`  ✓ ${gate.name} → 金标变红（退出码 ${r.status}，${red.length} 条）`);
  } else {
    console.log(`  ✗ ${gate.name} → **金标照样全绿**——这一道闸没有专属用例（或被别的闸遮住）`);
    console.log(`      ${gate.why}`);
    bad++;
  }
}

if (runGold().status !== 0) {
  console.log('\n  ✗ 恢复后仍然红——源码没还原干净，本轮结论不作数');
  process.exit(1);
}
console.log('\n  ✓ 恢复后：绿（源码已还原）\n');

if (bad === 0) {
  console.log('五道闸**各自**都被金标量到了——README 那句声称成立。\n');
} else {
  console.log(
    `${bad} 道闸没有被金标独立量到。\n` +
      '  **「这个闸有人在量」很容易变成想当然**——语料一扩、闸一改，遮住关系就变了。\n',
  );
}
process.exit(bad === 0 ? 0 : 1);
