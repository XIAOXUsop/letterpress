#!/usr/bin/env node
/**
 * 单元测试的**条数**必须与 README / docs 里写的那个数一致。
 *
 * ── 为什么单为这个数字写一个脚本 ────────────────────────────────
 *
 * 端到端契约的条数早就有对账了（`scripts/verify-negotiation.mjs` 尾部那段），
 * 而**单元测试的条数没有任何东西守着**。实测（2026-09-22）：
 * 修分享图碰撞那次新增了 `og.test.ts` 的 7 条用例，实际到了 270，
 * 而四个表面（README 徽章、README 的英文段、README 的「实测数据」表、`docs/cli.md`）
 * 全都还写着 **263**。
 *
 * 这正是本仓库反复记的那件事——**同一个事实有几个表面，只改一处等于没改**；
 * 而只要没有门禁守着，那个数就一定会漂。契约条数有门禁所以没漂，
 * 单测条数没有门禁所以漂了，因果关系很干净。
 *
 * ── 数据从哪来 ──────────────────────────────────────────────────
 *
 * `npm test` 现在除了默认报告器，还多写一份 JSON 到 `.verify/vitest-report.json`。
 * 这个脚本读它。**读不到就是失败**，不是"跳过"——否则把 `npm test` 那步从流水线里
 * 拿掉，这条检查会安静地不再检查任何东西（那是"查不动 ≠ 通过"的老毛病）。
 *
 * 用法：`npm test && npm run verify:testcount`
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const REPORT = join(process.cwd(), '.verify', 'vitest-report.json');
const problems = [];

console.log('\n单元测试条数对账');
console.log('─'.repeat(64));

if (!existsSync(REPORT)) {
  console.log(`  ✗ 找不到 ${REPORT}`);
  console.log('      这个检查读的是 `npm test` 写出来的 JSON 报告。先跑 `npm test`。');
  console.log('      它**不会**因为读不到就当作通过——那正是"把检查拿掉就静默失效"。');
  process.exit(1);
}

const report = JSON.parse(await readFile(REPORT, 'utf-8'));
const actual = report.numTotalTests;
const failed = report.numFailedTests ?? 0;
const skipped = report.numPendingTests ?? 0;

if (typeof actual !== 'number') {
  console.log('  ✗ 报告里没有 numTotalTests —— 报告格式变了，这条检查要先修');
  process.exit(1);
}

console.log(`  · 本次实测 ${actual} 项（失败 ${failed}，跳过/待定 ${skipped}）`);

/** README 上抄这个数的四种写法，逐个抓出来 */
const readme = await readFile(join(process.cwd(), 'README.md'), 'utf-8');
const claimed = [
  ...[...readme.matchAll(/测试-(\d+)%20项/g)].map((m) => ({ where: 'README 徽章', n: m[1] })),
  ...[...readme.matchAll(/(\d+)\s+unit tests/g)].map((m) => ({ where: 'README 英文段', n: m[1] })),
  ...[...readme.matchAll(/单元测试\s*\|\s*\*\*(\d+)\s*项\*\*/g)].map((m) => ({ where: 'README 实测数据表', n: m[1] })),
];

const docsMentions = [];
for (const name of (await readdir('docs')).sort()) {
  if (extname(name) !== '.md') continue;
  const text = await readFile(join('docs', name), 'utf-8');
  for (const m of text.matchAll(/\*\*(\d+)\s*项\*\*单元测试/g)) {
    docsMentions.push({ where: `docs/${name}`, n: m[1] });
  }
}

const all = [...claimed, ...docsMentions];
if (all.length === 0) {
  console.log('  ✗ 一处都没抓到 —— 写法变了或者这些句子被删了，这条检查成了空转');
  problems.push('README / docs 里一处都没提到单元测试条数，这条对账失去意义');
} else {
  const wrong = all.filter((c) => Number(c.n) !== actual);
  if (wrong.length === 0) {
    console.log(`  ✓ ${all.length} 处写到的条数都与实测一致（${all.map((c) => c.where).join('、')}）`);
  } else {
    for (const w of wrong) console.log(`  ✗ ${w.where} 写 ${w.n}`);
    problems.push(`${wrong.length} 处单元测试条数与实测（${actual}）对不上：`
      + wrong.map((w) => `${w.where} 写 ${w.n}`).join('、'));
  }
}

console.log('\n' + '─'.repeat(64));
if (problems.length === 0) {
  console.log('单元测试条数对账通过。\n');
} else {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log('');
}
process.exitCode = problems.length === 0 ? 0 : 1;
