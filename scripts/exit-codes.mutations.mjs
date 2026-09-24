#!/usr/bin/env node
/**
 * `check-exit-codes` 的负向验证。
 *
 * 判据是「面向用户的 CLI 不许用未归类的 `exit(1)`」。这类检查很容易
 * **看着在管、实际漏一大片**，所以这里依次注入三种漏法，每次都必须真的变红：
 *
 *   ① 写回字面 `process.exit(1)`         → 「未归类」那条必须红
 *   ② 写一个不存在的常量名              → 「认不出来的写法」那条必须红
 *   ③ 写一个存在但未在码表里登记的数字   → 「没有登记」那条必须红
 *
 * ② 与 ③ 是**两种完全不同的失败**：
 * ② 是在本仓库里根本编译不过的东西（import 不到），
 * ③ 是**语法合法、运行时也对，只是「这个码没语义」**——
 * 而 ③ 恰恰是最该被抓住的：**它不会自己暴露**。
 *
 * 跑法：`npm run verify:exit-codes`
 * 退出码 0 = 三次变异都真的报出来了。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const GATE = join(ROOT, 'scripts/check-exit-codes.mjs');
// ⚠️ 不再有固定的 TARGET：每个变异自带 `file`（注入点随实现移动，见 MUTATIONS 处的说明）。

const runGate = () => {
  try {
    const out = execFileSync('node', [GATE], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return { red: false, out };
  } catch (e) {
    return { red: true, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

/*
 * ⚠️ **注入点从 `wiki-review.mjs` 换到了 `wiki-impact.mjs`，中间还绕了一次弯路。**
 *
 * 2026-09-24 迭代 AP：`wiki-review` 的错误出口改走 `failWithJson(...)`，
 * 锚点 `process.exit(EXIT_NOT_FOUND);` 随之消失。
 *
 * 弯路一：改注入点为 `json-output.mjs` 里的 `process.exit(code)`——
 * **那样门禁确实抓不到，而抓不到是对的**：
 * `check-exit-codes` 只管**面向用户的 CLI**（库文件不在名单里）。
 * 这不是门禁有洞，是它的范围本来就窄——而**范围窄是刻意的**
 * （见门禁文件里「门禁脚本的 exit(1) 不在管辖内」那段）。
 *
 * 弯路二：想改注释却只改了正文，于是标题写着「换到了 json-output.mjs」
 * 而实际是 `wiki-impact.mjs`——**注释与代码说的不是一回事**，
 * 与本轮反复出现的那一类同型。判据是「注释里写了而代码没做」的镜像。
 *
 * > 症状本身很有教育意义：三个变异「全部不生效」时，
 * > 脚本**自己报了出来**（「锚点找不到，变异没注入」），
 * > 于是 `verify:all` 是**红的**而不是假绿。
 * >
 * > 那是 `if (!original.includes(find))` 这句的价值：
 * > **锚点漂移必须显式失败，不能静默跳过。**
 * > 否则「没注入」与「注入了但门禁没抓到」在输出里长得一样。
 */
const MUTATIONS = [
  {
    name: '① 写回字面 exit(1)',
    file: 'scripts/wiki-impact.mjs',
    replace: ['  process.exit(EXIT_INVARIANT);', '  process.exit(1);'],
    expect: /未归类的失败/,
  },
  {
    name: '② 写一个不存在的常量名',
    file: 'scripts/wiki-impact.mjs',
    replace: ['  process.exit(EXIT_INVARIANT);', '  process.exit(EXIT_TYPO_HERE);'],
    expect: /认不出来的写法/,
  },
  {
    name: '③ 写一个语法合法但未登记的数字',
    file: 'scripts/wiki-impact.mjs',
    replace: ['  process.exit(EXIT_INVARIANT);', '  process.exit(9);'],
    expect: /没有登记在 exit-codes\.mjs 里/,
  },
];

let allGood = true;
console.log('check-exit-codes 的负向验证');
console.log('─'.repeat(64));

if (runGate().red) {
  console.log('  ✗ 干净状态下门禁就是红的——先修那个');
  process.exit(1);
}
console.log('  ✓ 干净状态：绿\n');

for (const m of MUTATIONS) {
  const [find, to] = m.replace;
  const target = join(ROOT, m.file);
  const original = readFileSync(target, 'utf8');
  if (!original.includes(find)) {
    console.log(`  ✗ ${m.name}：锚点 "${find}" 在 ${m.file} 里找不到（源码已漂，变异没注入）`);
    allGood = false;
    continue;
  }
  writeFileSync(target, original.replace(find, to), 'utf8');
  const { red, out } = runGate();
  writeFileSync(target, original, 'utf8');

  if (red && m.expect.test(out)) {
    console.log(`  ✓ ${m.name} → 红了（命中预期判据）`);
  } else if (red) {
    console.log(`  ✗ ${m.name} → 红了，但命中的是别的判据（不是「${m.expect.source}」）`);
    allGood = false;
  } else {
    console.log(`  ✗ ${m.name} → 仍然绿，门禁有洞`);
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
    ? '三次变异都真的报出来了——这道门禁是尺子，不是装饰。'
    : '有变异没报出来——门禁有洞。',
);
console.log();
process.exit(allGood ? 0 : 1);
