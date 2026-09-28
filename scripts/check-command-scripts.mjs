#!/usr/bin/env node
/**
 * **命令名与脚本名对不上时，必须在册子里登记，且登记与 `package.json` 逐字一致。**
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 2026-09-28 实测：59 个单文件脚本的命令里（2026-09-29 重数，此前记 48），**8 个的命令名与脚本名对不上**。
 * 照着命令名去 `grep` 脚本会落空——**我当天因此 ENOENT 了两次**。
 *
 * 它不是 bug（`npm run` 照常工作），但它让一种**审计时天天用的查法**失效：
 * 「这条门禁的判据写在哪个文件里」。
 *
 * ── 为什么不改文件名 ────────────────────────────────────────────────
 *
 * 改文件名要同时动 `package.json`、CI、文档与台账里的每一处引用，
 * 而收益仅仅是让一种查法好走。**登记 + 守住**，成本低一个数量级。
 *
 * ── 判据分三条 ──────────────────────────────────────────────────────
 *
 * ① 册子里的每一条都**与 `package.json` 逐字一致**（否则表已腐化）
 * ② **凡是分叉的都必须在册子里**（否则表静默漏登记——**这条是主要价值**）
 * ③ 册子里的每条都要**写明为什么可以分叉**（空白理由 = 没想过 = 迟早乱改）
 *
 * ⚠️ **②为什么是主要的**：①③ 都可能被满足而 ② 被忽略，
 * 于是**新加一个分叉命令时什么都不会报**——
 * 而那张表的价值恰恰在于「照着它一定能找到脚本」。
 *
 * 用法：`node scripts/check-command-scripts.mjs`
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { NAME_DIVERGENCE } from './lib/command-scripts.mjs';

const ROOT = process.cwd();
const problems = [];

console.log('命令名与脚本名');
console.log('─'.repeat(64));

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** 从一条命令里取出它指向的脚本文件（只认单文件形态）。 */
const scriptOf = (cmd) => /node (scripts\/[\w.-]+\.mjs)/.exec(cmd ?? '')?.[1] ?? null;

/**
 * 「对得上」的判据：**脚本名包含命令名去掉前缀后的那个词**。
 *
 * ⚠️ 这个口径同时被门禁与 `lib/command-scripts.mjs` 的注释引用——
 * **换口径就要两处一起换**，否则「登记了但门禁说不分叉」，
 * 报出来的是一条谁也看不懂的错。
 */
const stemOf = (file) => file.split('/').pop().replace(/\.mjs$/, '');
const bareOf = (name) => name.replace(/^(check|verify|wiki|sync|measure|list|migrate):?/, '');
const matches = (name, file) => stemOf(file).includes(bareOf(name)) || file.includes(name);

const registered = new Map(NAME_DIVERGENCE.map(([n, f]) => [n, f]));

// ── ② 主判据：所有分叉都必须登记 ────────────────────────────────────
let diverged = 0;
for (const [name, cmd] of Object.entries(pkg.scripts)) {
  const file = scriptOf(cmd);
  if (!file || matches(name, file)) continue;
  diverged++;
  if (!registered.has(name)) {
    problems.push(
      `**\`${name}\` 的命令名与脚本名 \`${file}\` 对不上，而它没在 \`lib/command-scripts.mjs\` 里登记。**\n`
      + '    → 照着命令名去找脚本会落空（2026-09-28 因此 ENOENT 两次）。\n'
      + '    登记它并写明为什么可以分叉；若其实该同名，那就改脚本名。',
    );
    console.log(`  ✗ ${name} → ${file}（未登记）`);
  }
}

// ── ① 表与 package.json 逐字一致 ────────────────────────────────────
for (const [name, file, why] of NAME_DIVERGENCE) {
  const actual = scriptOf(pkg.scripts[name]);
  if (actual === null) {
    problems.push(
      `\`${name}\` 在册子里，但 \`package.json\` 里没有这个命令了。\n`
      + '    → 册子已经腐化。删掉这条，或者把命令加回来。',
    );
    console.log(`  ✗ ${name}：命令已不存在`);
    continue;
  }
  if (actual !== file) {
    problems.push(
      `\`${name}\` 在册子里写的是 \`${file}\`，而 \`package.json\` 现在指向 \`${actual}\`。\n`
      + '    → **两份事实已经分叉**，而它们不会互相提醒。',
    );
    console.log(`  ✗ ${name}：册子写 ${file}，实际 ${actual}`);
    continue;
  }
  // 顺带：登记的那一条现在还成立吗（它可能已经「对上」了）
  if (matches(name, file)) {
    problems.push(
      `\`${name}\` 仍在册子里，但它的命令名与脚本名**现在已经对得上**了。\n`
      + '    → 册子多了一条不成立的登记；留着会让下一个人以为这里还有分叉。',
    );
    console.log(`  ✗ ${name}：已不再分叉，登记过时`);
  }
}

// ── ③ 每条都要有理由 ────────────────────────────────────────────────
for (const [name, , why] of NAME_DIVERGENCE) {
  if (typeof why !== 'string' || why.trim() === '') {
    problems.push(
      `\`${name}\` 的登记**没写为什么可以分叉**。\n`
      + '    → 空白理由等于「没想过」，而下一个人会照着「统一命名」把它改掉。',
    );
    console.log(`  ✗ ${name}：登记缺理由`);
  }
}

/*
 * ── 自测：先证明这套判据能看见东西 ──────────────────────────────────
 *
 * ⚠️ 与 `check:no-duplicate-lists` 同一个理由：**「没报」既可能是没分叉，
 * 也可能是判据压根没在看。** 这里用一个**临时 package.json** 造三份语料：
 * 未登记的分叉 / 登记与实际不符 / 登记缺理由。
 */
console.log('  自测（临时语料，不碰真 package.json）');
const TEMPLATE = {
  a: { scripts: { 'check:x': 'node scripts/x.mjs', 'check:weird': 'node scripts/other-name.mjs' } },
  b: { scripts: { 'check:x': 'node scripts/x.mjs', 'verify:gates': 'node scripts/renamed.mjs' } },
  c: { scripts: { 'check:x': 'node scripts/x.mjs' } },
};

/** 拿一份假 package.json 跑一遍分叉检测，返回「未登记的分叉」有几个。 */
function unregisteredIn(fake) {
  const reg = new Map(NAME_DIVERGENCE.map(([n, f]) => [n, f]));
  let n = 0;
  for (const [name, cmd] of Object.entries(fake.scripts)) {
    const file = scriptOf(cmd);
    if (!file || matches(name, file)) continue;
    if (!reg.has(name)) n++;
  }
  return n;
}
for (const [key, want, why] of [
  ['a', 1, '未登记的分叉必须被算出来（`check:weird` 没在册子里）'],
  ['b', 0, '已登记但脚本被改名时不算未登记（它要由「逐字一致」那条报，不是这条）'],
  ['c', 0, '没有分叉时必须是 0——**否则这条自测会假装自己有用**'],
]) {
  const got = unregisteredIn(TEMPLATE[key]);
  if (got === want) console.log(`    ✓ ${why}`);
  else {
    problems.push(`**自测不通过**（${why}）：期望 ${want}，实际 ${got}。`);
    console.log(`    ✗ ${why}（期望 ${want}，实际 ${got}）`);
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log(
  `\n${Object.keys(pkg.scripts).length} 个命令，${diverged} 个与脚本名对不上，全部登记且理由非空。\n`,
);
