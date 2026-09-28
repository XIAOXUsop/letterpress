#!/usr/bin/env node
/**
 * **「接一个新站点要写多少站点专属的代码」必须会随核心变强而变少。**
 *
 * ── 它量的是阶段 4 第 4 条的一个**代理指标** ──────────────────────
 *
 * 第 4 条原文：「第二个站点的接入**确实减少重复维护**，而非只做演示」。
 * 它现在标着 **未达成**——理由是「fixture 是测试语料，不是真的第二站点」。
 *
 * 那个理由**成立**，本门禁也不推翻它**。** 但「有没有真站点」这件事
 * 我在工作区内造不出来（造出来的还是 fixture）。
 *
 * > **不可判定的条件不能靠「说了就算」来处理。**
 * > 所以这里量一个**能被证伪的代理**：核心每多收走一块接线，
 * > 适配层就该少一行。**它变多，本门禁就红。**
 *
 * ⚠️ **它量的是「行数」，不是「质量」。**
 * 一行写得再蠢也是一行，而 10 行写得很聪明也是 10 行——
 * 所以**上限会被人为压低**（把三行并成一行）。
 * 缓解：那三行各自都有独立的可证伪断言（见 `check-second-site-real.mjs` 的
 * 20 条），而**它们还在，就说明接线还在**。
 *
 * ── 判据 ────────────────────────────────────────────────────────────
 *
 * 取 `check-second-site-real.mjs` 里**标着「映射层」的那段**，
 * 数其中**非空、非注释、非 import** 的行数，与上限比。
 *
 * ⚠️ **不能只数行**：把三行写进一个 `if` 块或一个 IIFE 里就能骗过它。
 * 所以同时断言**那一段里出现的核心调用**（`readContentDirs` / `pageToDoc`）
 * 都在——**「变少」不能靠「不调用核心」实现。**
 *
 * 用法：`node scripts/check-adapter-size.mjs`
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ADAPTER = join(ROOT, 'scripts', 'check-second-site-real.mjs');

/**
 * 站点专属代码的**行数上限**。
 *
 * ⚠️ **改这个数字必须同时说明理由。** 它不是随手定的：
 * 2026-09-28 实测从 27 行降到 3 行（`pageToDoc` 22 + `readContentDirs` 8 +
 * `relationField` 5 被收进核心），见 `knowledge/gate-negatives.md`。
 *
 * <p>现存 2 行是**不可再压的**：
 * 「内容在哪个目录」与「这个站点把关系字段叫什么」——
 * 那是**站点事实**，核心问不到。`docs/onboarding-a-new-site.md` 里那份
 * 接线文档就是照着这 2 行写的，它必须能跑。
 */
const MAX_ADAPTER_LINES = 2;

/** 核心必须仍被调用——否则「适配层变小」是靠「不接核心」实现的。 */
const REQUIRED_CORE_CALLS = ['readContentDirs', 'pageToDoc'];

const problems = [];

console.log('站点专属接线的规模');
console.log('─'.repeat(64));

const text = readFileSync(ADAPTER, 'utf8');

// 取出标着「映射层」的那一段。
//
// ⚠️ **切到 `const docs =` 为止是不够的**——第一版那么切，
// 于是 `const docs = pages.map((page) => pageToDoc(page));` **整行落在段外**，
// 「仍调用 pageToDoc」那条立刻报红。**判据自己红了而实现是对的。**
// 改成切到 `buildGraph` 之前：那才是「读完内容」的终点。
const startMark = text.indexOf('const { pages } = readContentDirs');
const endMark = text.indexOf('const graph = buildGraph');
if (startMark < 0 || endMark < 0) {
  console.error('定位不到映射层——`check-second-site-real.mjs` 的结构变了。');
  console.error('（这一条不能当成「0 行」——那正是「查不动 ≠ 空集」。）');
  process.exit(1);
}
const segment = text.slice(startMark, endMark);

/**
 * 排除**不是接线**的行。
 *
 * ⚠️ **是白名单，不是「排除所有含 console 的行」。**
 * 后者会变成「往里塞一个 console.log 就不计数了」——
 * 而那正是要防的。
 * 所以逐条写明**为什么它不是接线**，多一条就要能答出这个问题。
 */
const NOT_WIRING = [
  // 输出给人看的报告。它不参与「内容 → Doc」这条链。
  /^\/\/\s/,
  /^(console|process\.stdout\.write)/,
];

/** 去掉行内注释与空行，只留真正的代码行。 */
const codeLines = segment
  .split('\n')
  .map((l) => l.replace(/\/\/.*$/, '').trim())
  .filter((l) => l !== '')
  .filter((l) => !NOT_WIRING.some((re) => re.test(l)));

console.log(`  映射层：${codeLines.length} 行（上限 ${MAX_ADAPTER_LINES}）`);
for (const l of codeLines) console.log(`    ${l}`);

if (codeLines.length > MAX_ADAPTER_LINES) {
  problems.push(
    `站点专属接线有 ${codeLines.length} 行，超过上限 ${MAX_ADAPTER_LINES}：\n`
    + codeLines.map((l) => `      ${l}`).join('\n') + '\n'
    + '    **上限只能降，不能升。** 升它之前先问：那几行为什么不能在核心里？\n'
    + '    ——若答案确实是「站点事实」，那它应该被表达成一个**参数**，而不是一段代码。',
  );
  console.log('  ✗ 超过上限');
} else {
  console.log(`  ✓ 未超过上限（${codeLines.length} / ${MAX_ADAPTER_LINES}）`);
}

/*
 * ⚠️ **反向断言：核心必须仍被调用。**
 * 少了这一条，把整段换成 `const docs = [];` 就能让行数变成 0 而门禁全绿——
 * **「变小」不等于「变好」**。
 */
const missing = REQUIRED_CORE_CALLS.filter((fn) => !segment.includes(fn));
if (missing.length > 0) {
  problems.push(
    `映射层里没有调用 ${missing.join('、')}——`
    + '**「适配层变小」不能靠「不接核心」实现。**',
  );
  console.log(`  ✗ 映射层不再调用 ${missing.join('、')}`);
} else {
  console.log(`  ✓ 仍调用核心的 ${REQUIRED_CORE_CALLS.join(' / ')}`);
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log('\n站点专属接线只剩「站点事实」，核心每多收走一块它就少一行。\n');
