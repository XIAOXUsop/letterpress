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
import { readFile, readdir, stat } from 'node:fs/promises';
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

/*
 * ⚠️ **「报告存在」不等于「报告是这次的」。**
 *
 * 2026-09-24 实测踩到：报告在、格式对、条数也对**上一次的**——
 * 因为我用的是 `npx vitest run`，而只有 `npm test` 带上
 * `--reporter=json --outputFile.json=…`（那是它写报告的唯一入口）。
 *
 * 症状：加完 6 条测试 → `npm test` 报 473 → `verify:testcount` 报「实测 467」。
 * 两个数都对，**只是来自不同时刻**。
 *
 * > **对账的前提是「两边说的是同一件事」。**
 * > 拿旧报告和新文档比，得到的红是**假的**——
 * > 而「门禁报了红」很容易被当成「我漏改了某处」，于是去改本来正确的地方。
 *
 * 判据：**报告的 mtime 必须不早于 `src/` 里最新的被测源文件。**
 * 拿「目录最新 mtime」比，够用且不需要列举规则
 * （`src/`、`scripts/`、`knowledge/` 三个目录里取最新的那个）。
 */
const reportMtime = (await stat(REPORT)).mtimeMs;
/*
 * ⚠️ **只扫「会改变测试条数或测试结果」的文件**，不扫整个 `scripts/`。
 *
 * 第一版把 `scripts/` 整个算进去，于是**改这个文件本身就让报告过期**——
 * 而它不产生任何测试。那是**假红**，而假红比没检查更糟。
 *
 * 会影响测试的：`src/` 下的 `.ts` 与 `.astro`（被测代码）。
 * 不影响测试的：`scripts/`（只被 npm 调，不被 vitest 收）、
 * `knowledge/` 下的 `.md`（金标数据在 check-* 里读，不在 vitest 里）。
 *
 * > ⚠️ **写这条注释时踩过一次**：`src/**\/*.ts` 里的 `**` 紧跟 `*`，
 * > 在块注释内部构成 `*\/` —— **提前闭合了注释**，
 * > 于是后面那行普通文本被当成代码解析，报 `SyntaxError: Unexpected token`。
 * > 注释里**不要写 glob 模式**。
 */
const INPUT_GLOBS = [
  { dir: 'src', match: /\.(ts|astro)$/ },
];
let newestInput = 0;
let newestPath = '';
for (const { dir, match } of INPUT_GLOBS) {
  const full = join(process.cwd(), dir);
  if (!existsSync(full)) continue;
  for (const name of await readdir(full, { withFileTypes: true, recursive: true })) {
    if (!name.isFile() || !match.test(name.name)) continue;
    const p = join(name.parentPath ?? name.path, name.name);
    const m = (await stat(p)).mtimeMs;
    if (m > newestInput) {
      newestInput = m;
      newestPath = p;
    }
  }
}
if (newestInput > reportMtime + 1000) {
  // 容忍 1 秒：文件系统时间戳精度与写入顺序都可能带来几十毫秒的抖动
  console.log(`  ✗ 报告比输入旧：${newestPath.slice(process.cwd().length + 1)} 改于报告之后。`);
  console.log('      **它量的是上一次的结果**——拿它对账会得到一个假的红。');
  console.log('      重跑 `npm test`（不是 `npx vitest run`：只有前者会写这份报告）。');
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
