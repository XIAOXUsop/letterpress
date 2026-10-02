#!/usr/bin/env node
/**
 * 文档里的锚点链接（`file.md#锚点`）逐个核实。
 *
 * ── 为什么单独一个门禁 ──────────────────────────────────────────────
 *
 * GitHub 生成的中文标题锚点可能与手写链接不一致，因此逐条核对。
 *
 * > **锚点会随标题改动而漂移，而链接不会自动跟。**
 * > 改一个标题，别处三个链接就静默失效——而 GitHub 不会报错，
 * > 点下去只是「滚到页面顶部」。
 *
 * ── slug 规则必须与 GitHub 一致 ────────────────────────────────────
 *
 * 本脚本用的规则**已用线上 HTML 逐条核实过**（小写 → 去标点 → 空格转连字符）。
 * 若 GitHub 改了规则，这里会误报——**那时该改的是本脚本，不是那些链接**。
 *
 * 用法：`npm run check:anchors`
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, extname, relative, sep } from 'node:path';
import { DOC_ROOTS } from './lib/doc-roots.mjs';

const ROOT = process.cwd();
const norm = (p) => p.split(sep).join('/');

/**
 * GitHub 的标题 slug 规则。
 *
 * ⚠️ 只保留**字母数字、下划线、连字符、空格与 CJK**，
 * 其余（含 `「」` `（）` `#`）删除；空白折叠成单个连字符。
 */
function ghSlug(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\- ]/gu, '')
    .replace(/\s+/g, '-');
}

// ── 收集文档 ────────────────────────────────────────────────────────
// ⚠️ 清单在 `scripts/lib/doc-roots.mjs`——2026-09-28 从这里与
// check-doc-refs.mjs 各一份的拷贝抽成一处（两份逐字相同，漂开则两道门禁扫不同东西）。
const ROOTS = DOC_ROOTS;
const docs = [];
for (const entry of ROOTS) {
  const full = join(ROOT, entry);
  if (!existsSync(full)) continue;
  if (statSync(full).isFile()) {
    docs.push(full);
    continue;
  }
  const walk = (dir, depth = 0) => {
    if (depth > 4) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (['.md', '.mdx'].includes(extname(e.name))) docs.push(p);
    }
  };
  walk(full);
}

if (docs.length === 0) {
  console.error('一份文档都没扫到——这个检查什么都没量。');
  process.exit(1);
}

// ── 收集每份文档的标题锚点 ──────────────────────────────────────────
const anchors = new Map();
for (const f of docs) {
  const text = readFileSync(f, 'utf8');
  const set = new Set();
  for (const m of text.matchAll(/^#{1,4}\s+(.*)$/gm)) {
    set.add(ghSlug(m[1]));
    // GitHub 对重复标题追加 -1 / -2
    set.add(`${ghSlug(m[1])}-1`);
  }
  anchors.set(norm(relative(ROOT, f)), set);
}

// ── 逐个核实 ────────────────────────────────────────────────────────
//
// ⚠️ **两类锚点，此前只核了后一类**（2026-09-29 实测）：
//
//   ① **同页锚点** `](#深入)`——指向**本文件**里的某个标题。
//      README 的主导航就靠它，而它**一处都没被核过**。
//   ② **跨文件** `](./other.md#frag)`——指向另一份文档的标题。
//
// 只核 ② 的话，README 那行 `[文档](#深入)` 写错也**没有任何东西会红**，
// 而它是**对外的门面**——读者点「文档」落到页面顶部，不会以为链接坏了，
// 只会以为「这里没有文档」。
const problems = [];
let sameCount = 0;
let crossCount = 0;

for (const f of docs) {
  const text = readFileSync(f, 'utf8');
  const selfAnchors = anchors.get(norm(relative(ROOT, f)));

  text.split('\n').forEach((line, i) => {
    // 同页锚点：`](#frag)` —— 前面不能是别的路径（那样会被 ② 抓到）
    for (const m of line.matchAll(/\]\(#([^)\s]+)\)/g)) {
      sameCount++;
      const frag = m[1].toLowerCase();
      if (selfAnchors && selfAnchors.has(frag)) continue;
      problems.push(
        `${norm(relative(ROOT, f))}:${i + 1}  \`#${m[1]}\`（**同页锚点**）\n` +
          `      本文件的标题锚点：` +
          `${[...(selfAnchors ?? [])].filter((x) => !x.endsWith('-1')).join('、') || '（一个标题都没有）'}`,
      );
    }

    // 跨文件锚点：`](path.md#frag)`
    for (const m of line.matchAll(/\]\(([^)#\s]+\.md)#([^)\s]+)\)/g)) {
      crossCount++;
      const [, target, frag] = m;
      const p = norm(relative(ROOT, join(dirname(f), target)));
      const have = anchors.get(p);
      if (!have) continue; // 文件不在扫描范围内，不判
      if (have.has(frag.toLowerCase())) continue;
      problems.push(
        `${norm(relative(ROOT, f))}:${i + 1}  \`${target}#${frag}\`\n` +
          `      该文件的标题锚点：${[...have].filter((x) => !x.endsWith('-1')).join('、')}`,
      );
    }
  });
}

const total = sameCount + crossCount;

console.log('文档里的锚点链接');
console.log('─'.repeat(64));
console.log(
  `  扫了 ${docs.length} 份文档、${total} 处锚点链接` +
    `（同页 ${sameCount} / 跨文件 ${crossCount}；slug 规则与 GitHub 一致）\n`,
);

/*
 * ⚠️ **「一处都没扫到」必须失败**——与其它检查同一条原则。
 *
 * 2026-09-29 之前这里没有这条守卫，而那时的实际情况是
 * **总数只有 1**（只有跨文件那一类）——一个印着「✓」的行，
 * 底下是一个几近为零的覆盖面。**一个几乎不量东西的检查，
 * 和没有这个检查是一回事，而它的绿还会让人以为有人管着。**
 */
if (total === 0) {
  console.error('  ✗ 一处锚点链接都没扫到——这一步什么都没验证，不能报通过');
  console.error('    若文档里确实一处都没有，请删掉这道门禁，而不是留着它报绿。');
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(
    `\n${problems.length} 处锚点链接**点不到**。\n` +
      `  改一个标题会让别处的链接静默失效——GitHub 不报错，\n` +
      `  点下去只是「滚到页面顶部」。\n`,
  );
  process.exit(1);
}
console.log('  ✓ 每一处锚点链接都能落到真实的标题上\n');
