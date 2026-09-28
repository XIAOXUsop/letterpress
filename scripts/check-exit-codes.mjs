#!/usr/bin/env node
/**
 * CLI 错误码门禁：**面向用户的 CLI 不得使用未归类的 `exit(1)`。**
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 路线图阶段 4 第 3 项要「稳定错误码」。2026-09-24 实测：
 * 那时纳入范围的 4 个 CLI，14 处非零退出只用 `1` 和 `2`，而语义至少 5 类——
 * 其中「**内部不变式被破坏**（本工具的 bug）」与「用户拼错参数」共用 `exit(1)`，
 * 消费方没法区分「我该改用法」和「这个工具坏了」。
 *
 * ── 判据为什么是「这些文件」而不是「所有 scripts/」 ────────────────
 *
 * ⚠️ **2026-09-28：名单改成「从 package.json 推导」，本表只列豁免。**
 * 原先手写的 4 个漏了 3 个真实 CLI（`migrate:manifest` / `measure` /
 * `list:overclaims`）——**「新增 CLI 必须加进这里」靠自觉，于是它被漏了**。
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

const problems = [];

/**
 * 面向用户的 CLI。**新增 CLI 必须加进这里**——
 * `check-gate-list` 不知道哪些脚本是 CLI，本表是唯一名单。
 *
 * ⚠️ **2026-09-28：这张表不再是唯一依据——它变成「豁免名单」。**
 *
 * 原先它**只列这 4 个**，而 `package.json` 里用户可运行的 CLI 实际有 **7 个**：
 * 多出来的 `migrate:manifest`（已合规，3 个 `EXIT_*`）、
 * `measure`（用了裸 `exit(1)`）、`list:overclaims`（退出码恒为 0）。
 * **「新增 CLI 必须加进这里」靠自觉，于是它被漏了。**
 *
 * 现在改成：**从 `package.json` 推导**哪些是用户可运行的 CLI
 * （不是 `check:` / `verify:` 门禁、也不是 `dev` / `build` / `test` / `clean` 那一类基础设施），
 * 本表只列**需要豁免的**——每个都要写明理由。
 */
const EXEMPT = new Map([
  ['scripts/measure.mjs',
    '**量产物给人看的工具**（`docs/cli.md` 里写明「判定由 check-formats 里对应的门禁做」）。'
    + '它 exit(1) 的那两处是「构建失败」与「Pagefind 索引失败」——那是**环境问题**，'
    + '而码表里没有对应项（`EXIT_ENVIRONMENT` 指的是「目录读不到」那一类）。'
    + '⚠️ **这是豁免不是认可**：真要细分，该加的是「构建/索引失败」这个码。'],
  ['scripts/bundle-and-verify.mjs',
    '**`npm run verify` 的内部实现**（package.json 里 `verify` 调它，'+
    '而 `verify` 本身是基础设施命令）。它 `process.exit(code ?? 1)` 是'+
    '**把子进程的码原样传出**——那不是「未归类的失败」，是转发。'],
  ['scripts/list-overclaims.mjs',
    '**列出可被证伪的声称供人工核对，退出码恒为 0**（台账 `NOT_IN_ALL` 里已登记这条）。'
    + '它不判定对错——对错由各门禁判。给它一个非 0 退出码会让「列出清单」变成「门禁」。'],
]);

const USER_CLIS = (() => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const INFRA = new Set(['dev', 'start', 'build', 'build:noindex', 'preview', 'test', 'test:watch', 'check', 'clean']);
  const found = [];
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    if (INFRA.has(name) || /^(check|verify):/.test(name) || name === 'verify:all') continue;
    const m = /node (scripts\/[\w.-]+\.mjs)/.exec(cmd);
    if (m) found.push(m[1]);
  }
  /*
   * ⚠️ **推导出来的必须与手写的一致**——不一致说明推导规则漏了或多了，
   * 而那正是「名单会漂」的信号。所以手写的那 4 个仍然作为**交叉验证**保留。
   */
  const HANDWRITTEN = [
    'scripts/wiki-ask.mjs',
    'scripts/wiki-review.mjs',
    'scripts/wiki-impact.mjs',
    'scripts/sync-content.mjs',
  ];
  for (const f of HANDWRITTEN) {
    if (!found.includes(f)) {
      problems.push(
        `手写名单里的 ${f} 不在「从 package.json 推导出来的 CLI」里——\n`
        + '    要么它在 package.json 里不再是用户可运行命令（那要删掉手写那条），\n'
        + '    要么推导规则漏了它（那要修规则）。**两份名单不一致 = 至少一份是错的。**',
      );
    }
  }
  return [...new Set(found)].sort().map((file) => ({
    file,
    doc: EXEMPT.get(file) ?? '（从 package.json 推导）',
    exempt: EXEMPT.has(file),
  }));
})();


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

  /*
   * ⚠️ **豁免项只核对「它用了哪些码」，不判「该不该归类」**——
   * 豁免的理由已经写在 `EXEMPT` 里，而**豁免不是认可**
   * （`measure` 那条明说了「真要细分该加一个码」）。
   * 仍然要报的是「用了码表里没有的码」——那与豁免无关。
   */
  const exempt = cli.exempt === true;

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
      if (exempt) {
        // 豁免项：写法再怪也**照记不误报**，但要在输出里看得见。
        found.push({ line: i + 1, code: null, via: arg });
        return;
      }
      problems.push(
        `${cli.file}:${i + 1}  process.exit(${arg}) —— **认不出来的写法**\n` +
          `    只能是字面数字，或 exit-codes.mjs 里导出的常量之一。`,
      );
      return;
    }
    found.push({ line: i + 1, code });
    if (code === 1 && !exempt) {
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

  // 豁免项可能有 `code: null`（写法怪但已豁免）——过滤掉，别让 join 变 null。
  const codes = [...new Set(found.map((f) => f.code).filter((c) => c !== null))].sort((a, b) => a - b);
  /*
   * ⚠️ **豁免项不显示成 ✗**——它没有失败，只是「不在归类的适用范围」。
   * 显示成 ✗ 会让读输出的人以为有东西坏了，而退出码明明是 0。
   * **结论行与实际判定必须一致。**
   */
  const mark = exempt ? '·' : (codes.includes(1) ? '✗' : '✓');
  console.log(
    `  ${mark} ${cli.file}  退出码 ${codes.join('/') || '（无）'}` +
      `（${found.length} 处${exempt ? '，豁免：' + cli.doc.split('。')[0] : ''}）`,
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
