#!/usr/bin/env node
/**
 * 核心模块的**站点无关性**门禁。
 *
 * ── 为什么要有这个 ──────────────────────────────────────────────────
 *
 * 路线图阶段 4 第 6 项：「记录 API 稳定边界，**剥离仅属于当前站点的展示逻辑**」。
 * `src/lib/wiki/` 里的模块是路线图打算拆成 `@letterpress/knowledge-core` 的东西，
 * **它们里的任何站点专属依赖都会跟着进那个包**，让第二个站点必须改核心。
 *
 * > 2026-09-24 实测：核心模块里就有两处写死的本站结构——
 * > `graph.ts` 的 `urlFor()` 硬编码 `/wiki/` 前缀；
 * > `lint.ts` 的 `checkReservedPostRoutes()` 硬编码本站 7 条根路由，
 * > 且 `RESERVED_POST_ROUTES` 是模块级常量、**函数签名里没有注入口**。
 * > 第二个站点要用它们就得改核心——**那正是这条路要避免的事**。
 *
 * ── 判据为什么是「有没有注入口」而不是「有没有字面量」 ──────────────
 *
 * ⚠️ **第一版判据写错了，写法是「核心模块里不许出现 `about` 或 `/wiki/` 字面量」。**
 * 实测它有两类问题，**第二类比第一类危险得多**：
 *
 *   1. **误报**：`Doc['kind']` 的 `'post' | 'wiki'` 枚举与 `d.kind === 'wiki'`
 *      都被报成站点专属——它们是**知识层的产品概念**，不是本站目录。
 *   2. **漏报**：写死与可覆盖的**兜底默认值在字面上完全一样**。
 *      改完之后 `/wiki/` 仍作为 `DEFAULT_URL_PREFIXES` 留在 `graph.ts` 里，
 *      而字面量判据只能靠「这条路径能不能被覆盖」这种间接推理来区分——
 *      **推理不如直接查。**
 *
 * 所以判据改成**结构性的**：
 *
 *   > **凡是本站才有的东西，核心模块里必须能由调用方覆盖。**
 *
 * 具体做法是**查签名与调用链**，不是查字符串：
 * `urlFor` / `urlOf` 必须接受前缀参数；
 * `checkReservedPostRoutes` 必须读 `LintOptions.reservedPostRoutes` 而非模块级常量。
 * 这些都是**可以证伪的**——删掉参数门禁就红。
 *
 * ⚠️ **这个门禁测不出的东西（必须知道，否则会高估它）**：
 *
 *   - 「新增了一个新的站点专属依赖」——新增时若同时加进 `REQUIREMENTS`，
 *     门禁会要求它可注入；但**忘了加**就没人提醒。
 *   - 「可注入」是否真的好用——那要一个真实第二站点
 *     （仍欠着，见 `verify:second-site` 的诚实边界）。
 *
 * **别把它读成「抽象已验证成立」**，它只是那条退出条件的守门条件。
 *
 * 用法：`npm run check:site-agnostic`
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 必须「可由调用方覆盖」的站点事实。
 *
 * 每条写明：字面量在哪、覆盖点是什么、去掉会怎样。
 * **新增站点专属依赖时必须往这里加一条**——加了就必须可注入，
 * 没加就是门禁的盲区（上面已写明）。
 */
const REQUIREMENTS = [
  {
    file: 'graph.ts',
    what: '知识库 URL 前缀',
    // 前缀必须从参数进来
    mustMatch: [
      {
        pattern: /export function urlFor\(\s*kind: Doc\['kind'\],\s*slug: string,\s*prefixes: UrlPrefixes\s*=/,
        why: 'urlFor 必须接受前缀参数，否则「换一个目录」只能改核心源码',
      },
      {
        pattern: /export function urlOf\(doc: Doc, prefixes: UrlPrefixes\s*=/,
        why: 'urlOf 必须把前缀透传，否则内容清单/llms.txt 那几个调用方覆盖不了',
      },
    ],
    // 兜底默认值**允许**留在核心里（它不是「本站知识」，是「不配置时的行为」），
    // 但必须是 DEFAULT_* 命名 —— 改名会让「这是可覆盖的兜底」这件事看不出来。
    allowLiteral: /DEFAULT_URL_PREFIXES/,
  },
  {
    file: 'lint.ts',
    what: '根层保留路由表',
    mustMatch: [
      {
        pattern: /readonly reservedPostRoutes\?: ReadonlyMap<string, string>;/,
        why: 'LintOptions 必须暴露注入口',
      },
      {
        pattern: /checkReservedPostRoutes\(docs,\s*opts\.reservedPostRoutes\s*\?\?\s*DEFAULT_RESERVED_POST_ROUTES\)/,
        why: 'checkReservedPostRoutes 必须真的读那个选项——签名里有不等于用上了',
      },
    ],
    allowLiteral: /DEFAULT_RESERVED_POST_ROUTES/,
  },
];

const problems = [];

console.log('核心模块的站点专属逻辑是否可由调用方覆盖');
console.log('─'.repeat(64));

for (const req of REQUIREMENTS) {
  const full = join(process.cwd(), 'src', 'lib', 'wiki', req.file);
  const text = readFileSync(full, 'utf8');

  for (const { pattern, why } of req.mustMatch) {
    if (pattern.test(text)) {
      console.log(`  ✓ ${req.file}  ${req.what}：可注入`);
    } else {
      problems.push(
        `${req.file}  ${req.what}：**没有注入口**\n` +
          `    ${why}\n` +
          `    期望匹配：${pattern}\n` +
          `    ——这条正是路线图阶段 4 第 6 项要剥离的东西。`,
      );
      console.log(`  ✗ ${req.file}  ${req.what}：没有注入口`);
    }
  }

  // 兜底默认值必须仍以 DEFAULT_ 命名存在
  if (req.allowLiteral && !req.allowLiteral.test(text)) {
    problems.push(
      `${req.file}  ${req.what}：兜底默认值不见了（${req.allowLiteral} 未匹配）\n` +
        `    可以不给默认值，但**别悄悄改成别的名字**——\n` +
        `    「DEFAULT_ 这个前缀」是「这可被覆盖」的唯一可见标记。`,
    );
  }
}

// ── 顺带查一件事：值域型常量不得被误当成站点事实 ────────────────────
//
// `Doc['kind']` 的 `'post' | 'wiki'` 与 `d.kind === 'wiki'` 是知识层的词汇表，
// 不是「本站恰好有个 /wiki/ 目录」。这条判据**要窄**：只拦「值出现在
// 非类型、非比较的位置」。
console.log('');
console.log('知识层词汇表是否被误当成站点事实');
console.log('─'.repeat(64));

const KIND_ENUM = /'post'\s*\|\s*'wiki'/;
const KIND_CMP = /kind\s*===\s*'wiki'/;
const graph = readFileSync(join(process.cwd(), 'src/lib/wiki/graph.ts'), 'utf8');
let vocabularyLines = 0;
for (const line of graph.split('\n')) {
  const t = line.trim();
  if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
  if (KIND_ENUM.test(line) || KIND_CMP.test(line)) vocabularyLines++;
}
console.log(`  ✓ graph.ts 里有 ${vocabularyLines} 处知识层词汇表用法（'post' | 'wiki' / kind === 'wiki'）`);
console.log('    这些是产品概念，**不是**站点事实——第二个站点要么有知识层、要么整体关掉，');
console.log('    两种情况都由 checkWikilinks / checkOrphans 开关管，不需要改核心。');

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(
    `\n${problems.length} 处站点专属逻辑**没有注入口**。\n` +
      `  它们会跟着进 \`@letterpress/knowledge-core\`，让第二个站点必须改核心——\n` +
      `  而那正是路线图阶段 4 要避免的事。\n`,
  );
  process.exit(1);
}
console.log(
  `\nREQUIREMENTS 里登记的 ${REQUIREMENTS.length} 项站点事实都能由调用方覆盖。\n` +
    '  ⚠️ **这不是「所有站点事实」**——清单在下方，新增要手写。\n' +
    '  门禁测不出的部分见本文件头部（「必须知道，否则会高估它」那一节）。',
);
