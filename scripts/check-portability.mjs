#!/usr/bin/env node
/**
 * 可移植性门禁：**核心纯逻辑模块必须能被裸 Node 直接 import**，
 * 且**不得出现「可选链只保护了左边、没保护字段本身」的写法**。
 *
 * ── 第一条：可加载性 ────────────────────────────────────────────────
 *
 * 路线图阶段 4 有一条退出条件：「一个全新的真实内容集能在**不复制内部代码**
 * 的情况下使用核心流程」。而「能使用」的第一步是**能加载**。
 *
 * 2026-09-24 实测：`src/lib/wiki/` 下六个零耦合模块里，
 * **`graph.ts` 与 `lint.ts` 不能被裸 Node 加载**——
 * 它们内部用 `.js` 后缀 import（TS 惯例，bundler 才解析得了），
 * 于是 `import('./graph.ts')` 报 `Cannot find module '.../wikilink.js'`。
 * `retrieve` / `impact` / `slug` / `digest` 则可以。
 *
 * > 后果很具体：维护脚本（`scripts/*.mjs`，裸 Node）能用检索、影响分析、
 * > slug、摘要，**却用不了链接图与 lint**——而后者是知识层的地基。
 * > 想用就得先跑 bundler，于是「纯逻辑、可直接复用」这件事就打了折。
 *
 * **为什么用「真的 import 一遍」而不是读源码找 `.js`**：
 * 判据是**传递依赖**——本模块内部没有 `.js`，但它 import 的模块有，
 * 一样加载不了。读单个文件会漏掉这一层。
 * 实测 `graph.ts` 自己 import 的是 `./wikilink.js`（有）。
 * **唯一可靠的判据是让解析器自己说。**
 *
 * ── 第二条：可选链漏保护 ────────────────────────────────────────────
 *
 * 迭代 N 实测：`computeImpact` 在 `refs` 缺失时崩（`undefined.some`）。
 * 根因不是写错，是**类型标必填而实际可为 undefined**，
 * 且所有调用方都老实填了空数组——
 * **默认值救了它，于是脱节长期没被发现**。
 *
 * 同型形状：`a?.related.includes(x)` **只保护了 `a` 为 null**，
 * 没保护 `related` 为 undefined，抛的是 `undefined.includes`。
 * 修完那处后全库扫了一遍，**只此一处**。写成门禁是因为
 * 这类 bug 的特征就是「现在不崩、将来某次重构会崩」。
 *
 * 用法：`node scripts/check-portability.mjs`
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const LIB = join(ROOT, 'src', 'lib', 'wiki');

/**
 * 核心流程：链接图、体检、检索、影响分析、slug、摘要。
 * 设计约束是**零耦合**——不读文件、不碰 Astro、不依赖本站配置。
 * 那条约束的价值全靠本门禁兑现：写在注释里而没有检查，就只是愿望。
 */
const CORE = ['graph.ts', 'lint.ts', 'retrieve.ts', 'impact.ts', 'slug.ts', 'digest.ts'];

/** 会被误写成「可选链 + 直接调方法」的字段名。 */
const OPTIONAL_FIELDS = [
  'related',
  'sources',
  'refs',
  'review',
  'declaredRelations',
  'slug',
  'title',
  'body',
];
const OPTIONAL_CHAIN_TRAP = new RegExp(
  `\\?\\.(${OPTIONAL_FIELDS.join('|')})\\.\\w+\\(`,
  'g',
);

const problems = [];

console.log('核心模块可加载性（裸 Node）');
console.log('─'.repeat(64));

for (const file of CORE) {
  const full = join(LIB, file);
  try {
    await import(pathToFileURL(full).href);
    console.log(`  ✓ ${file}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message.split('\n')[0] : String(error);
    problems.push(
      `${file} 不能被裸 Node 加载：${msg}\n` +
        `    它是核心纯逻辑模块，应当零耦合。内部用 '.js' 后缀 import 的话，` +
        `bundler 能解析而裸 Node 不能——于是 scripts/*.mjs 用不了它。` +
        `改成 '.ts' 后缀即可（Node 22+ 原生剥离类型；**无后缀不行**）。`,
    );
    console.log(`  ✗ ${file}`);
  }
}

// ── 可选链漏保护 ──────────────────────────────────────────────────────

const files = [];
for (const sub of ['src/lib', 'scripts']) {
  for (const entry of readdirSync(join(ROOT, sub), { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && /\.(ts|mjs|astro)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      files.push(join(entry.parentPath ?? entry.path, entry.name));
    }
  }
}

console.log('');
console.log('可选链是否保护了字段本身');
console.log('─'.repeat(64));

// ⚠️ **必须排除本文件**：它的文档里就写着 `a?.related.includes(x)` 这个反例，
// 而反例本身符合模式——不排除的话门禁会把自己判为违规（实测过）。
const SELF = 'check-portability.mjs';

for (const file of files) {
  if (file.endsWith(SELF)) continue;
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(OPTIONAL_CHAIN_TRAP)) {
    const line = text.slice(0, m.index).split('\n').length;
    problems.push(
      `${relative(ROOT, file)}:${line}  \`${m[0]}\`\n` +
        `    可选链只保护了左边为 null，没保护该字段本身为 undefined。` +
        `写成 \`a?.${m[1]}?.method(...)\` 才对。`,
    );
  }
}
console.log(`  ✓ 没有「可选链没保护字段本身」的写法（扫了 ${files.length} 个文件）`);

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处问题。\n`);
  process.exit(1);
}
console.log('\n核心模块全部可被裸 Node 加载，且没有「可选链漏保护」的写法。\n');
