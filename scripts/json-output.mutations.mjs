#!/usr/bin/env node
/**
 * `check-json-output` 的负向验证：**门禁真能抓到那三类违约吗？**
 *
 * 判据是「失败时 stdout 必须是合法 JSON、`ok` 为 false、`error.code` 与退出码一致」。
 * 这类检查很容易**看着在管、实际抓不住**。三类违约：
 *
 *   ① 失败时 stdout 空（回到修复前的状态）
 *   ② JSON 合法但 `ok` 不是 false（**说自己是成功**）
 *   ③ `error.code` 与进程退出码**不一致**——最阴的一种：
 *      JSON 看起来完全正常，而消费方按 `error.code` 分支、
 *      脚本却按退出码报告，**两边会给出两个互相矛盾的事实**。
 *
 * ⚠️ **第一版这个脚本三次都判错**，两条原因都值得记：
 *
 * 1. 注入用的正则（`[\s\S]*?\n  \}\);`）会一路吃到**下一个** `});`，
 *    把后面几段代码也删了——门禁确实报红，**但红的原因不是我们想验的那个**
 *    （它变成「脚本语法坏了」）。
 * 2. 改「某个 CLI 的调用点」只能影响一个场景，而门禁读的是**多个场景**。
 *    改 `json-output.mjs` 里 `jsonError` 的那一行才是**唯一的来源**，
 *    四个场景一起变——那才是真实的违约。
 *
 * > **「门禁报红了」不等于「门禁因为你想的原因报红」。**
 * > 所以负向验证必须断言**报的是哪一条**，
 * > 否则门禁会因为一个完全不同的原因红，而你以为验证通过了。
 *
 * 跑法：`npm run verify:json-mutations`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const GATE = join(ROOT, 'scripts/check-json-output.mjs');

/** 门禁的报错文案。判据靠它区分「报对了」与「报了别的」。 */
const PATTERNS = {
  empty: /stdout \*\*完全为空\*\*/,
  notOk: /ok 不是 false/,
  mismatch: /两边会打架/,
};

const REVIEW = 'scripts/wiki-review.mjs';
const OUTPUT_LIB = 'src/lib/cli/json-output.mjs';

const MUTATIONS = [
  {
    name: '① 失败时 stdout 空（只打 stderr）',
    file: REVIEW,
    expect: PATTERNS.empty,
    from: "  failWithJson(asJson ? 'json' : 'text', EXIT_NOT_FOUND, `找不到 ${slugArg}。`, {",
    // 插一行「直接退出」，让 failWithJson 永远不执行
    to:
      '  (console.error(`找不到 ${slugArg}。`), process.exit(EXIT_NOT_FOUND));\n' +
      "  failWithJson(asJson ? 'json' : 'text', EXIT_NOT_FOUND, `找不到 ${slugArg}。`, {",
  },
  {
    // 注入点是 `jsonError` 里那**一行 `ok: false`**——
    // 门禁读到的 `ok` 全来自那**一处**，改它四个场景一起变，那才是真实的违约
    name: '② JSON 合法但 ok 不是 false',
    file: OUTPUT_LIB,
    expect: PATTERNS.notOk,
    from: '    ok: false,\n    error: {',
    to: '    ok: true,\n    error: {',
  },
  {
    /*
     * 注入点是 `failWithJson` 里的 `process.exit(code)`——
     * **第一版改的是调用点的 `EXIT_NOT_FOUND` 那个参数，那不管用**：
     * `failWithJson` 用同一个 `code` 既写 JSON 又退出，所以改参数两边一起变，
     * 永远还是一致的。
     *
     * > 要让它们分叉，只能在**只有一处用到它的地方**下手——
     * > 也就是 `process.exit(code)` 这一行。
     */
    name: '③ error.code 与退出码不一致',
    file: OUTPUT_LIB,
    expect: PATTERNS.mismatch,
    from: '  process.exit(code);',
    to: '  process.exit(code === 5 ? 1 : code);',
  },
];

const originals = new Map();
for (const m of MUTATIONS) {
  const full = join(ROOT, m.file);
  if (!originals.has(full)) originals.set(full, readFileSync(full, 'utf8'));
}

const restore = () => {
  for (const [full, text] of originals) writeFileSync(full, text, 'utf8');
};

const runGate = () => {
  try {
    const out = execFileSync('node', [GATE], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return { red: false, out };
  } catch (e) {
    return { red: true, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

let allGood = true;
console.log('check-json-output 的负向验证');
console.log('─'.repeat(64));

if (runGate().red) {
  console.log('  ✗ 干净状态下门禁就是红的——先修那个，本轮验证没有意义');
  process.exit(1);
}
console.log('  ✓ 干净状态：绿\n');

for (const m of MUTATIONS) {
  const full = join(ROOT, m.file);
  const original = originals.get(full);
  if (!original.includes(m.from)) {
    console.log(`  ✗ ${m.name}：锚点找不到（${m.file} 已漂，这个验证本身该更新了）`);
    allGood = false;
    continue;
  }
  writeFileSync(full, original.replace(m.from, m.to), 'utf8');
  const { red, out } = runGate();
  restore();

  if (!red) {
    console.log(`  ✗ ${m.name} → **仍然绿**，门禁有洞`);
    allGood = false;
  } else if (m.expect.test(out)) {
    console.log(`  ✓ ${m.name} → 报红了（命中预期判据）`);
  } else {
    console.log(`  ✗ ${m.name} → 报红了，但**不是预期的那一条**——这次验证不算数`);
    const other = out.split('\n').filter((l) => l.includes('✗')).join(' / ');
    console.log(`      实际报的是：${other.slice(0, 200)}`);
    allGood = false;
  }
}

if (runGate().red) {
  console.log('\n  ✗ 恢复后仍然红——源码没还原干净，本轮结论不作数');
  process.exit(1);
}
console.log('  ✓ 恢复后：绿（源码已还原）\n');
console.log(
  allGood
    ? '三类违约都真的以预期的方式报了出来——这道门禁是尺子，不是装饰。'
    : '有变异没按预期报出来——门禁或这个验证有问题。',
);
console.log();
process.exit(allGood ? 0 : 1);
