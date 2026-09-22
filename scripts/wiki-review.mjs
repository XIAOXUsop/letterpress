#!/usr/bin/env node
/**
 * 取一条知识页的**当前**正文摘要，并打印可直接粘进 frontmatter 的片段。
 *
 * ── 它为什么必须存在 ────────────────────────────────────────────────
 *
 * `contentDigest` 的机制是：复核时把**当时**的摘要写进 frontmatter，
 * 构建时现算一个比对，对不上就是 stale。
 *
 * 那就必须有个地方能拿到"现在的值"——否则作者只能去读构建报错里的
 * 前 16 位（那是截断过的），或者干脆复制错。**一个需要人肉抄哈希的流程
 * 会立刻退化成猜**，然后所有人学会无视它。
 *
 * ── 它**不做**什么 ──────────────────────────────────────────────────
 *
 * **不自动写回文件。** 它只打印。
 *
 * 原因是这个动作带有承诺的重量："我复核过了"。让一个脚本自动填上日期与
 * 摘要，等于把"人工复核"变成一次回车——那正是这套机制要防的事
 * （README 里那句「模型不能替人工填最终 reviewed」是同一个道理）。
 *
 * 用法：
 *   node scripts/wiki-review.mjs --slug cjk-typography
 *   node scripts/wiki-review.mjs --list          # 列出所有知识页与状态
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// **直接 import TS 源**，不在这里重写一份算法。
// Node 22.12+ 能剥掉类型标注直接跑；重写一份的代价是"两处不一致时
// 这条命令会一本正经地说谎"，而它存在的全部意义就是给出正确的值。
import { contentDigest } from '../src/lib/wiki/digest.ts';

const args = process.argv.slice(2);
const slugArg = args.find((a) => a.startsWith('--slug='))?.slice('--slug='.length)
  ?? (args.indexOf('--slug') !== -1 ? args[args.indexOf('--slug') + 1] : undefined);
const listOnly = args.includes('--list');

const WIKI = join(process.cwd(), 'src', 'content', 'wiki');

// ── 与 remark-wikilink.ts 同源的取值方式（这份是脚本，不能 import TS）──────
function frontmatterField(source, field) {
  if (!source.startsWith('---')) return null;
  const end = source.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = source.slice(3, end);
  const m = new RegExp(`^${field}:[ \\t]*(.*)$`, 'm').exec(block);
  if (!m) return null;
  const raw = (m[1] ?? '').trim();
  if (raw === '') return null;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

/**
 * 取出正文。
 *
 * ⚠️ **必须 `trim()`**——Astro 的 `entry.body` 是**去过首尾空白**的。
 *
 * 这条是靠实测定下来的，不是看文档看来的：让构建打印它实际看到的 body，
 * 长度 2166；而直接从文件切出来是 2168（前后各一个换行）。
 * 差两个字符，摘要就完全对不上——**症状是"所有已复核页面都报 stale"**，
 * 看起来像机制坏了，其实只是取值口径差一个 trim。
 *
 * 另一处同源的口径差异：`kind`。`Doc.kind` 是**文档类型**（恒为 wiki），
 * 而 frontmatter 的 `kind` 是**知识类型**（concept/…）。摘要要的是后者。
 * 两个都写错的话，摘要永远对不上，而**看代码看不出来**。
 */
function bodyOf(source) {
  const end = source.indexOf('\n---', 3);
  if (end === -1) return '';
  return source.slice(source.indexOf('\n', end + 1) + 1).trim();
}

function parse(file) {
  const source = readFileSync(join(WIKI, file), 'utf8');
  const kind = frontmatterField(source, 'kind') ?? 'concept';
  const title = frontmatterField(source, 'title') ?? '';
  const summary = frontmatterField(source, 'summary') ?? '';
  const relatedRaw = frontmatterField(source, 'related') ?? '';
  const related = relatedRaw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    file,
    slug: file.replace(/\.mdx?$/, ''),
    title,
    status: frontmatterField(source, 'status') ?? null,
    // 传一个够 digest 用的最小 Doc——slug/draft/explicitSlug 不参与摘要计算
    digest: contentDigest({
      kind: 'wiki',
      wikiKind: kind,
      slug: file.replace(/\.mdx?$/, ''),
      title,
      summary,
      body: bodyOf(source),
      // ⚠️ 字段名是 `declaredRelations`，**不是** `related`。
      // 传错键的话 `?? []` 会静静兜成空数组——摘要照样算得出，
      // 只是永远对不上，而症状是"所有已复核页面都报 stale"，
      // 看起来像机制坏了。这个坑我踩过一次，写在这里。
      declaredRelations: related,
      explicitSlug: false,
      draft: false,
    }),
  };
}

let files;
try {
  files = readdirSync(WIKI).filter((f) => /\.mdx?$/.test(f));
} catch {
  console.error(`读不到 ${WIKI}——请在仓库根目录运行。`);
  process.exit(1);
}
if (files.length === 0) {
  console.error(`${WIKI} 里一个条目都没有——这一步什么都没检查。`);
  process.exit(1);
}

const pages = files.map(parse);

if (listOnly || !slugArg) {
  console.log('\n知识页与复核状态');
  console.log('─'.repeat(64));
  for (const p of pages.sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
    const mark = p.status === 'reviewed' ? '●' : '○';
    console.log(`  ${mark} ${p.slug.padEnd(24)} ${p.title}`);
  }
  console.log('\n  用 --slug=<名字> 取某一页的当前摘要。\n');
  process.exit(0);
}

const page = pages.find((p) => p.slug === slugArg || p.file === slugArg);
if (!page) {
  console.error(`\n找不到 ${slugArg}。现有：${pages.map((p) => p.slug).sort().join('、')}`);
  process.exit(1);
}

console.log(`\n${page.title}（${page.slug}）\n`);
console.log('  当前正文摘要：');
console.log(`    ${page.digest}`);
console.log('\n  把下面这段粘进 frontmatter（**日期请改成你实际复核的那天**）：\n');
console.log('  review:');
console.log('    status: reviewed');
console.log(`    checkedAt: ${new Date().toISOString().slice(0, 10)}`);
console.log(`    contentDigest: ${page.digest}`);
console.log('\n  ⚠️ 这个脚本**不替你写回文件**——"我复核过了"是一个承诺，');
console.log('      不该由一次回车作出。粘之前请真的读一遍正文。\n');
