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
import { captureWorktree, diffWorktree } from './lib/worktree-assert.mjs';

/** 跑之前的工作区——收尾断言要与它比，而不是与「空」比。 */
const WORKTREE = captureWorktree();

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
/*
 * ⚠️ **这个数此前是手写的「22/22」**（2026-09-29 改）。
 *
 * 而金标在 2026-09-24 之后已经从 19 条长到 23 条、语料从 6 页到 11 页——
 * **它没跟着动，而没有任何东西会红**：那是一行 `console.log`。
 *
 * > 与 `docs/retrieval.md` 里那句「红 2 条」是同一类：
 * > **散文里的数，没有门禁盯着。**
 *
 * 现在从金标自己的输出里读——**它是权威的那一份**。
 */
const cleanOut = clean.stdout ?? '';
const summaryLine = cleanOut.split('\n').find((l) => l.includes('条问题'));
if (!summaryLine) {
  console.log('  ✗ 读不到金标的汇总行——本轮的「干净状态」说法没有依据');
  process.exit(1);
}
console.log(`  ✓ 干净状态：${summaryLine.trim()}`);

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

/*
 * ── 顺带核一件事：文档里不许再出现**手抄的闸统计** ────────────────────
 *
 * ⚠️ **2026-09-29 加。** `docs/retrieval.md` 里曾有两张手抄表
 * （「每道闸的专属用例是哪一条」），记的是 2026-09-24 那次手工统计。
 * 而**没有任何门禁核它们**——正是那份文档自己反复警告的那类。
 *
 * 本次重跑实测：**闸一已经红 5 条，而文档写的是 2 条**。
 *
 * 处置是**删表改指路**（「去跑这条命令，它每次打印当场算的数」）。
 * 这条判据守住那个处置：文档里若又长出一张「闸 → 专属用例」的表，
 * 它必须同时写明「以命令输出为准」。
 *
 * > **不是禁止写表格，是禁止写一张没人核的表格。**
 */
{
  const doc = readFileSync(join(ROOT, 'docs', 'retrieval.md'), 'utf8');
  const rows = [...doc.matchAll(/^\|\s*(?:闸[一二三四五]|接缝识别|单字母权重|问句壳剔除)[^|]*\|/gm)];
  const hasPointer = /每次打印|当场算|以.{0,12}命令.{0,12}为准/.test(doc);
  if (rows.length > 0 && !hasPointer) {
    console.log(`  ✗ docs/retrieval.md 有 ${rows.length} 行手抄的闸统计，而没有指向命令的说明`);
    console.log('      那类表记的是**某一次**的手工统计，会漂——2026-09-29 实测就漂过（2 → 3 → 5）。');
    bad++;
  } else if (rows.length > 0) {
    console.log(`  ✓ docs/retrieval.md 有闸统计表，且写明了以命令输出为准`);
  } else {
    console.log('  ✓ docs/retrieval.md 没有手抄的闸统计表');
  }
}
/*
 * 收尾断言见 `lib/worktree-assert.mjs` 的文件头。
 *
 * ⚠️ 而这道脚本改的是 `src/lib/wiki/retrieve.ts`（**生产源码**），
 * 它是七道里**唯一碰 `src/` 的**——所以「没还原」的代价最高。
 */
{
  const { ok, report } = diffWorktree(WORKTREE);
  if (!ok) { console.log(report); bad++; }
  else console.log(report);
}

if (bad === 0) {
  console.log('五道闸**各自**都被金标量到了——README 那句声称成立。\n');
} else {
  console.log(
    `${bad} 道闸没有被金标独立量到。\n` +
      '  **「这个闸有人在量」很容易变成想当然**——语料一扩、闸一改，遮住关系就变了。\n',
  );
}
process.exit(bad === 0 ? 0 : 1);
