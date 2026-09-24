#!/usr/bin/env node
/**
 * 绝对化措辞盘点：列出测试名与注释里那些**可被证伪的声称**。
 *
 * ── 它要解决什么 ────────────────────────────────────────────────────
 *
 * 迭代 S 抓到：`accept.test.ts` 有一条 `it('宁可高估也不低估（向上取整）')`，
 * 而实现上方刚被改正过的注释明写「**实测是反的，它一直在低估**」。
 * 断言本身没错，**错的是名字声称的性质**。
 *
 * 那一类缺陷的特征是：**测试名比实现强**。
 * 而本项目反复出现的正是「声称的比做到的强」——
 * 「em 保证字数」「写入不会丢」「保证跨平台一致」都栽在这个形状上。
 *
 * ── 为什么它**只列不判** ────────────────────────────────────────────
 *
 * 「宁可漏给」「至少 90%」这类措辞**本身是对的**——
 * 它们是经人工核对的实测基线（见 `cover.test.ts` / `og.test.ts`）。
 * 所以本脚本**不能把它们判为错误**，只能**列出来供人核对**。
 *
 * > **一个会误报的检查比没有检查更糟**：它训练人忽略输出。
 * > 所以这里退出码恒为 0——**它的产物是一份清单，不是一个判定。**
 * > 真正会红的检查是别的（见 `check-portability.mjs` 的两条）。
 *
 * 用法：`node scripts/list-overclaims.mjs`
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

/**
 * 可被证伪的措辞。分两类：
 * - **绝对化**：宣称「总是/永不」，几乎总是错的；
 * - **比较级声称**：宣称比某个基线强，需要实测支撑。
 */
const PATTERNS = [
  { re: /永不|永远不会|绝对不会|完全不会|从不/g, kind: '绝对化' },
  { re: /总是|一定会| invariably|总是会/g, kind: '绝对化' },
  { re: /宁可[^\s，。；]{0,8}(?:也不|也不)/g, kind: '比较级声称' },
  { re: /不低于|不小于|至少要?有|保证[^\s，。；]{0,10}(?:一致|正确|不变)/g, kind: '比较级声称' },
  { re: /已被实测|实测证明/g, kind: '实测声称' },
];

const files = [];
for (const sub of ['src/lib', 'scripts']) {
  for (const entry of readdirSync(join(ROOT, sub), { withFileTypes: true, recursive: true })) {
    // 排除本文件：它的文档里就写着那些反例，而反例符合模式
    if (entry.isFile() && /\.(ts|mjs|astro)$/.test(entry.name) && !entry.name.endsWith('list-overclaims.mjs')) {
      files.push(join(entry.parentPath ?? entry.path, entry.name));
    }
  }
}

const found = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    // 只看测试名与文档注释——它们是「声称」，不是实现
    const isClaim =
      /^\s*(?:it|test|describe)\s*\(/.test(line) || /^\s*(?:\*|\/\/)/.test(line);
    if (!isClaim) return;
    for (const { re, kind } of PATTERNS) {
      for (const m of line.matchAll(re)) {
        found.push({
          file: relative(ROOT, file).replace(/\\/g, '/'),
          line: i + 1,
          kind,
          phrase: m[0],
          text: line.trim().slice(0, 96),
        });
      }
    }
  });
}

const byKind = new Map();
for (const f of found) {
  if (!byKind.has(f.kind)) byKind.set(f.kind, []);
  byKind.get(f.kind).push(f);
}

console.log('绝对化措辞盘点（列出供人工核对，不判定对错）');
console.log('─'.repeat(72));
console.log(`  扫了 ${files.length} 个文件，找到 ${found.length} 处声称\n`);

for (const [kind, items] of byKind) {
  console.log(`  【${kind}】${items.length} 处`);
  for (const f of items) console.log(`    ${f.file}:${f.line}  「${f.phrase}」`);
  console.log('');
}

console.log('  这些**不一定错**——「宁可漏给」「至少 90%」是经核对的实测基线。');
console.log('  本脚本的产物是一份清单：**列出可被证伪的声称，让人去核对**。');
console.log('  退出码恒为 0——一个会误报的检查比没有检查更糟，');
console.log('  它训练人忽略输出。\n');
