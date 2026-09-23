#!/usr/bin/env node
/**
 * 编排门禁：`verify:all` 里声明的每一步，都必须真实存在且可执行。
 *
 * ── 它要解决什么 ────────────────────────────────────────────────────
 *
 * 2026-09-24 实测的缺口：**没有任何东西检查「`verify:all` 的 13 步都跑了」**。
 * 删掉一步，它照样绿——而那一步可能是 `verify:questions` 或
 * `verify:formats` 这种**唯一**在守某类缺陷的门禁。
 *
 * > **编排是最容易出事的地方**：13 个 `&&` 串起来，
 * > 少一个不会有任何报错——`npm run` 只看最后一个的退出码。
 *
 * 这条检查量三件事：
 *   1. 步骤数量与 `knowledge/gate-negatives.md` 里记的一致（防「悄悄少一步」）；
 *   2. 每一步引用的 `npm run <name>` 在 `package.json` 里**有定义**；
 *   3. 每一步对应的脚本文件**真的存在**。
 *
 * ⚠️ **它量的是「声明的完整性」，不是「有效性」**——
 * 一门禁存在且被编排，**不代表它有效**。那件事记在
 * `knowledge/gate-negatives.md`（负向验证记录）里，两者缺一不可。
 *
 * 用法：`node scripts/check-gate-list.mjs`
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const problems = [];

// ── 期望的步骤清单 ────────────────────────────────────────────────────
//
// **这份清单是本检查的核心价值**：它让「少了一步」变成一件可检测的事。
// 增删步骤时**必须同步改这里**，否则门禁会红——那正是它该做的。
const EXPECTED = [
  ['npm run check', '类型与内容检查'],
  ['npm run verify:gates', '**编排自身**（本检查）——它必须排在最前面'],
  ['npm test', '单元测试'],
  ['npm run verify', '端到端契约（打在真实产物上）'],
  ['npm run verify:testcount', '测试条数对账'],
  ['npm run verify:search', '搜索可用性前提'],
  ['npm run verify:questions', '检索金标（22 条）'],
  ['npm run verify:impact', '影响分析金标（9 条）'],
  ['npm run verify:answers', '**答案能定位到证据**（阶段 3 退出条件 ③）'],
  ['npm run verify:portability', '核心模块可加载性 + 可选链形状'],
  ['npm run verify:second-site', '第二份异构内容集'],
  ['npm run verify:anchors', '锚点契约'],
  ['npm run verify:reproducible', '跨时区可复现构建'],
  ['npm run verify:base', '子路径部署'],
  ['npm run verify:formats', '内容发布探针 + 产物级断言'],
  ['npm run check:refs', '**文档里提到的路径都存在**（放最后：verify:formats 会清 dist，本检查要 dist 才判产物）'],
];

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const scripts = pkg.scripts ?? {};
const all = scripts['verify:all'] ?? '';

// ── 1. 步骤数量 ─────────────────────────────────────────────────────
const steps = all
  .split('&&')
  .map((s) => s.trim())
  .filter(Boolean);

console.log('门禁编排检查');
console.log('─'.repeat(64));
console.log(`  verify:all 声明了 ${steps.length} 步，期望 ${EXPECTED.length} 步`);

if (steps.length !== EXPECTED.length) {
  problems.push(
    `verify:all 有 ${steps.length} 步，而期望 ${EXPECTED.length} 步。` +
      `**少一步不会有任何报错**——npm 只看最后一个的退出码。` +
      `多出来的：${steps.filter((s) => !EXPECTED.some(([e]) => e === s)).join('、') || '（无）'}`,
  );
}

// ── 2. 每一步顺序与内容 ─────────────────────────────────────────────
for (const [i, [expected, why]] of EXPECTED.entries()) {
  const actual = steps[i];
  if (actual === expected) continue;
  problems.push(
    `第 ${i + 1} 步是「${actual ?? '（不存在）'}」，期望「${expected}」（${why}）。` +
      `\n    顺序也有意义：check/test 在最前，构建类门禁在后。`,
  );
}

// ── 3. 每一步引用的脚本存在 ─────────────────────────────────────────
for (const step of steps) {
  const m = /^npm run ([\w:-]+)$/.exec(step);
  if (!m) {
    if (step !== 'npm test') {
      problems.push(`步骤「${step}」不是本检查认识的形态（应为 \`npm run <name>\` 或 \`npm test\`）`);
    }
    continue;
  }
  const name = m[1];
  if (typeof scripts[name] !== 'string' || scripts[name].trim() === '') {
    problems.push(`步骤「${step}」引用的脚本在 package.json 里没有定义`);
    continue;
  }
  // 形如 `node scripts/check-x.mjs` 的，检查文件真的在
  const fileMatch = /node (scripts\/[\w.-]+\.mjs)/.exec(scripts[name]);
  if (fileMatch && !existsSync(join(ROOT, fileMatch[1]))) {
    problems.push(`「${name}」指向的脚本文件不存在：${fileMatch[1]}`);
  }
}

// ── 4. 反向：定义了但没进编排的门禁 ─────────────────────────────────
const inAll = new Set(
  steps.map((s) => /^npm run ([\w:-]+)$/.exec(s)?.[1]).filter(Boolean),
);
/*
 * 这些是**故意不进**编排的，每条都要写明理由——
 * 「故意不加」与「忘了加」在输出里长得一样，只有把理由写下来才能区分。
 */
const NOT_IN_ALL = new Map([
  // 编排自身
  ['verify:all', '它就是编排本身，不能包含自己'],
  ['verify:only', '被 verify:all 的第 3 步调用，单独跑没有产物可查'],
  // 需要外部环境的
  ['verify:online', '对着 GitHub Pages 上的 Demo 跑；Pages 跑不了内容协商，'
    + '基线本身就是红的（README 已写明是限制），不适合做门禁'],
  // 交互式 / 人工触发
  ['wiki:review', '交互式：它**不写回文件**，只打印该粘进 frontmatter 的片段。'
    + '「我复核过了」是人的承诺，不能由脚本自动完成'],
  ['wiki:impact', '只读的人工报告：列三组影响面。它不判定对错，'
    + '判定由 verify:impact（金标）负责'],
  ['wiki:ask', '交互式问答：输入是自然语言问题，没有固定输入就没法当门禁。'
    + '它的可测部分已抽成 src/lib/wiki/context-pack.ts（15 条测试）'],
  // 人工核对的清单类
  ['measure', '量产物给**人**看，判定由 check-formats 里对应的门禁做'],
  ['list:overclaims', '列出可被证伪的声称供人工核对，**退出码恒为 0**'],
]);
for (const name of Object.keys(scripts)) {
  if (!/^(verify|wiki):/.test(name)) continue;
  if (inAll.has(name) || NOT_IN_ALL.has(name)) continue;
  problems.push(
    `门禁「${name}」存在但**不在 verify:all 里**。` +
      `若它是人工触发的（例如 verify:online），请把它加进 NOT_IN_ALL 并写明理由——` +
      `否则「忘了加进编排」和「故意不加」在输出里长得一样。`,
  );
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处问题。\n`);
  process.exit(1);
}
console.log(`  ✓ ${steps.length} 步齐全、顺序正确、脚本都存在`);
console.log('  ✓ 没有「定义了却不在编排里」的门禁\n');
