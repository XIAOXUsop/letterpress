#!/usr/bin/env node
/**
 * CLI 错误码门禁：**面向用户的 4 个 CLI 不得使用未归类的 `exit(1)`。**
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 路线图阶段 4 第 3 项要「稳定错误码」。2026-09-24 实测：
 * 4 个 CLI 的 14 处非零退出只用 `1` 和 `2`，而语义至少 5 类——
 * 其中「**内部不变式被破坏**（本工具的 bug）」与「用户拼错参数」共用 `exit(1)`，
 * 消费方没法区分「我该改用法」和「这个工具坏了」。
 *
 * ── 判据为什么是「这些文件」而不是「所有 scripts/」 ────────────────
 *
 * **门禁脚本的 `exit(1)` 是对的**，不该被改：
 * 它们是二元的（红 / 绿），退出码只回答「过没过」，
 * 细分语义只对**读输出的人**有意义，而门禁的输出就在屏幕上。
 * 把它们一起管进来就是**误报**——而一个会误报的检查比没有检查更糟。
 *
 * > 名单是**显式枚举**的，不是按命名模式扫的。
 * > 模式扫（`/^wiki-/`）会在有人加 `wiki-foo.mjs` 时**静默漏掉**它，
 * > 显式枚举则会因为「新 CLI 没进名单」被下面的对照检查抓住。
 *
 * ── 判据为什么查「有没有漏归类的 1」而不是「每个码对不对」 ──────────
 *
 * 「这个 slug 不存在该用 5 还是 4」是**语义判断**，脚本判不了，
 * 硬编成表只会变成第二份需要同步的真相。
 * 而「**你用了 `exit(1)`**」是机械可判的：要么归了类，要么没归。
 * 前者靠人判断并写在注释里，后者靠本门禁。
 *
 * 用法：`npm run check:exit-codes`
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXIT_MEANINGS,
  EXIT_USAGE,
  EXIT_ENVIRONMENT,
  EXIT_EMPTY_INPUT,
  EXIT_NOT_FOUND,
  EXIT_INVARIANT,
} from '../src/lib/cli/exit-codes.mjs';

const ROOT = process.cwd();
/** 常量名 → 码。用来识别 `process.exit(EXIT_USAGE)` 这种**已归类**的写法。 */
const NAME_TO_CODE = new Map(
  Object.entries({
    EXIT_USAGE,
    EXIT_ENVIRONMENT,
    EXIT_EMPTY_INPUT,
    EXIT_NOT_FOUND,
    EXIT_INVARIANT,
  }),
);

/**
 * 面向用户的 CLI。**新增 CLI 必须加进这里**——
 * `check-gate-list` 不知道哪些脚本是 CLI，本表是唯一名单。
 */
const USER_CLIS = [
  { file: 'scripts/wiki-ask.mjs', doc: '自然语言问答 → context pack' },
  { file: 'scripts/wiki-review.mjs', doc: '取一条知识页的当前正文摘要' },
  { file: 'scripts/wiki-impact.mjs', doc: '来源变更影响分析' },
  { file: 'scripts/sync-content.mjs', doc: '内容镜像同步' },
];

const problems = [];

console.log('CLI 退出码是否都已归类');
console.log('─'.repeat(64));

for (const cli of USER_CLIS) {
  const full = join(ROOT, cli.file);
  if (!existsSync(full)) {
    problems.push(`名单里的 ${cli.file} 不存在——删掉它或修好路径`);
    console.log(`  ✗ ${cli.file}：文件不存在`);
    continue;
  }
  const text = readFileSync(full, 'utf8');
  const lines = text.split('\n');

  const found = [];
  lines.forEach((line, i) => {
    const m = /process\.exit\(([^)]+)\)/.exec(line);
    if (!m) return;
    const arg = m[1].trim();
    let code;
    if (/^\d+$/.test(arg)) {
      code = Number(arg);
    } else if (NAME_TO_CODE.has(arg)) {
      // 已归类的常量名：合格
      found.push({ line: i + 1, code: NAME_TO_CODE.get(arg), via: arg });
      return;
    } else if (arg === '0') {
      found.push({ line: i + 1, code: 0 });
      return;
    } else {
      problems.push(
        `${cli.file}:${i + 1}  process.exit(${arg}) —— **认不出来的写法**\n` +
          `    只能是字面数字，或 exit-codes.mjs 里导出的常量之一。`,
      );
      return;
    }
    found.push({ line: i + 1, code });
    if (code === 1) {
      problems.push(
        `${cli.file}:${i + 1}  process.exit(1) —— **未归类的失败**\n` +
          `    ${cli.doc}\n` +
          `    请挑一个具体码（${Object.keys(EXIT_MEANINGS)
            .filter((c) => c !== '0' && c !== '1')
            .map((c) => `${c}=${EXIT_MEANINGS[c].split('：')[0]}`)
            .join('、')}）。\n` +
          `    若确实是「以前没归类过」，先在 src/lib/cli/exit-codes.mjs 里给它一个位置。`,
      );
    }
    if (code !== 0 && !Object.prototype.hasOwnProperty.call(EXIT_MEANINGS, code)) {
      problems.push(`${cli.file}:${i + 1}  process.exit(${code}) —— 这个码没有登记在 exit-codes.mjs 里`);
    }
  });

  const codes = [...new Set(found.map((f) => f.code))].sort((a, b) => a - b);
  console.log(
    `  ${codes.includes(1) ? '✗' : '✓'} ${cli.file}  退出码 ${codes.join('/') || '（无）'}` +
      `（${found.length} 处）`,
  );
}

// ── 码表本身的自检 ──────────────────────────────────────────────────
console.log('');
console.log('码表自检');
console.log('─'.repeat(64));

const codes = Object.keys(EXIT_MEANINGS).map(Number).sort((a, b) => a - b);
if (codes[0] !== 0) problems.push('码表里没有 0（成功）');
if (!codes.includes(1)) problems.push('码表里没有 1（未归类的失败）——它是「漏归类」的可见信号，不能少');
for (let i = 1; i < codes.length; i++) {
  if (codes[i] !== codes[i - 1] + 1) {
    problems.push(`码表不连续：${codes[i - 1]} 之后是 ${codes[i]}，中间的码没有语义`);
  }
}
if (codes.length > 10) {
  problems.push(`码表超过 10 个（实际 ${codes.length}）——预留段只有 10–99，语义该合并了`);
}
console.log(`  ✓ ${codes.length} 个码：${codes.join('、')}（0 成功、1 未归类、2–9 具体语义）`);

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处问题。\n`);
  process.exit(1);
}
console.log('\nCLI 的每个非零退出都已归类，且没有用未归类的 1。\n');
