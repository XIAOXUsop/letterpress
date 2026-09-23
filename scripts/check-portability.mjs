#!/usr/bin/env node
/**
 * 可移植性门禁：**核心纯逻辑模块必须能被裸 Node 直接 import。**
 *
 * ── 它量的是什么 ────────────────────────────────────────────────────
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
 * ── 为什么用「真的 import 一遍」而不是读源码找 `.js` ────────────────
 *
 * 因为判据是**传递依赖**：本模块内部没有 `.js`，但它 import 的模块有，
 * 一样加载不了。读单个文件会漏掉这一层。
 * 实测 `graph.ts` 自己一个 `.js` 都没有（它 import 的是 `./wikilink.js`——
 * 有），而 `lint.ts` 同理。**唯一可靠的判据是让解析器自己说。**
 *
 * 用法：`node scripts/check-portability.mjs`
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const LIB = join(ROOT, 'src', 'lib', 'wiki');

/**
 * 这些模块是「核心流程」：链接图、体检、检索、影响分析、slug、摘要。
 * 它们的设计约束是**零耦合**——不读文件、不碰 Astro、不依赖本站配置。
 * 那条约束的价值全靠本门禁兑现：约束写在注释里，没有检查就只是愿望。
 */
const CORE = ['graph.ts', 'lint.ts', 'retrieve.ts', 'impact.ts', 'slug.ts', 'digest.ts'];

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
        `    它是核心纯逻辑模块，应当零耦合。` +
        `内部用 '.js' 后缀 import 的话，bundler 能解析而裸 Node 不能——` +
        `于是 scripts/*.mjs 用不了它。`,
    );
    console.log(`  ✗ ${file}`);
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 个核心模块加载不了。\n`);
  process.exit(1);
}
console.log('\n核心模块全部可被裸 Node 加载。\n');
