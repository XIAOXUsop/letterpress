#!/usr/bin/env node
/**
 * 搜索可用性检查：页面语言、索引覆盖，以及它们之间的一致性。
 *
 * ── 这个脚本为什么长这样（一段踩坑记录）────────────────────────────
 *
 * 最初它是一份"固定查询集"，在 Node 里加载 dist 的 pagefind.js 逐条断言结果条数。
 * 它跑得很绿，但它测的**不是访问者会遇到的行为**——因为 Pagefind 按页面的
 * `<html lang>` 选择分词器，而 Node 里没有 document，lang 是缺省的：
 *
 *   查询          Node（无 lang）   真实页面（lang="zh-CN"）
 *   中文排版       1 条              6 条，首条正是那篇文章
 *   内容协商       1 条              7 条
 *   设计令牌       1 条              4 条
 *
 * 于是它"发现"了一个不存在的问题（正文里写着「中文排版」的文章搜不到），
 * 并据此加了一段查询降级逻辑；那段逻辑在真实页面上一辈子不会触发。
 * 是浏览器里的实测把它拆穿的。
 *
 * 结论：**要在 Node 里复现浏览器的搜索行为，就得连浏览器环境一起造**
 * （`document`、`location`、Worker 探测……补一个漏一个，补出来的还是不真）。
 * 所以这个脚本不再假装能查，它只断言那些在磁盘上就能确凿判断的事——
 * 其中最重要的一条，恰恰是这次踩坑的根因：**lang 不能丢**。
 *
 * ── 真实页面上的实测基线（2026-09-18，chromium + lang="zh-CN"）──────
 *
 *   排版        7 条   /wiki/cjk-typography/
 *   中文排版     6 条   /cjk-web-typography/     ← 首条就是要找的那篇
 *   网页排版     3 条   /cjk-web-typography/
 *   内容协商     7 条   /wiki/content-negotiation/
 *   设计令牌     4 条   /wiki/design-tokens/
 *   静态站搜索    2 条   /static-site-search/
 *   Pagefind   1 条   /static-site-search/
 *   不存在的词    0 条
 *
 * 用法：`npm run build && npm run verify:search`
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const problems = [];

if (!existsSync(DIST)) {
  console.log('\n搜索可用性');
  console.log('─'.repeat(64));
  console.log('  ✗ 找不到 dist/ —— 这个检查打在构建产物上，先跑 npm run build');
  process.exit(1);
}

/** 递归列出 dist 下的所有 .html */
async function htmlFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await htmlFiles(full)));
    else if (entry.name.endsWith('.html')) found.push(full);
  }
  return found;
}

/** `pagefind.zh-cn_xxx.pf_meta` / entry.json 里的语言键：zh-CN → zh-cn */
const normalizeLang = (lang) => lang.toLowerCase().replace('_', '-');

console.log('\n搜索可用性');
console.log('─'.repeat(64));

// ── 1. 每个页面都要声明语言 ─────────────────────────────────────────
//
// 这不只是无障碍与断行的事：**它同时决定了搜索怎么分词**。
// lang 一旦丢失，Pagefind 会退回不切分中文的模式，
// 搜「中文排版」从 6 条掉到 1 条——用户再也找不到那篇文章，
// 而构建、测试、lint 全都不会出声。这是本项目最提防的那类失败。
const pages = await htmlFiles(DIST);
const langs = new Map();
const missingLang = [];

for (const file of pages) {
  const html = await readFile(file, 'utf-8');
  const match = html.match(/<html[^>]*\slang="([^"]*)"/);
  if (!match || match[1].trim() === '') {
    missingLang.push(file.slice(DIST.length + 1).replace(/\\/g, '/'));
    continue;
  }
  const lang = match[1].trim();
  langs.set(lang, (langs.get(lang) ?? 0) + 1);
}

if (missingLang.length > 0) {
  console.log(`  ✗ ${missingLang.length}/${pages.length} 个页面没有 <html lang>`);
  console.log(`      例：${missingLang.slice(0, 3).join('、')}`);
  problems.push(`${missingLang.length} 个页面缺少 <html lang>（会让搜索退回不切分中文的模式）：`
    + missingLang.slice(0, 3).join('、') + (missingLang.length > 3 ? ' 等' : ''));
}

if (langs.size === 0) {
  // 上面已经报过了
} else if (langs.size === 1 && missingLang.length === 0) {
  const [lang, count] = [...langs.entries()][0];
  console.log(`  ✓ ${count} 个页面都声明了 lang="${lang}"`);
} else if (langs.size > 1) {
  console.log(`  ✗ 页面语言不一致：${[...langs].map(([l, n]) => `${l}×${n}`).join('、')}`);
  problems.push('页面语言不一致——索引会按语言分片，中英混排的站需要显式处理');
}

// ── 2. 索引语言要与页面语言对得上 ───────────────────────────────────
//
// Pagefind 按 lang 建索引。两边对不上时，搜索会去加载一个根本不存在的语言索引，
// 表现是"搜什么都搜不到"——而构建仍然成功。
const entryFile = join(DIST, 'pagefind', 'pagefind-entry.json');
let entry;
try {
  entry = JSON.parse(await readFile(entryFile, 'utf-8'));
} catch {
  console.log('  ✗ 找不到 dist/pagefind/pagefind-entry.json —— 先跑 npm run build');
  problems.push('搜索索引不存在');
}

if (entry) {
  const indexed = Object.keys(entry.languages ?? {});
  const declared = [...langs.keys()].map(normalizeLang);
  const missing = declared.filter((l) => !indexed.includes(l));
  if (missing.length === 0) {
    console.log(`  ✓ 索引语言与页面语言一致：${indexed.join('、')}`);
  } else {
    console.log(`  ✗ 页面声明了 ${declared.join('、')}，索引里只有 ${indexed.join('、')}`);
    problems.push(`索引缺少页面声明的语言：${missing.join('、')}`);
  }

  // ── 3. 该进索引的页面一个都不能少 ─────────────────────────────────
  //
  // 索引范围由 data-pagefind-body 决定。漏标的页面**不会报错**，
  // 它只是从此搜不到——而文章、知识条目、列表页都靠它。
  let marked = 0;
  for (const file of pages) {
    const html = await readFile(file, 'utf-8');
    if (html.includes('data-pagefind-body')) marked += 1;
  }
  const counts = Object.values(entry.languages ?? {}).map((l) => l.page_count ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === marked) {
    console.log(`  ✓ 索引覆盖 ${total} 个页面，与标记了 data-pagefind-body 的页面数一致`);
  } else {
    console.log(`  ✗ 索引里 ${total} 个页面，产物里有 ${marked} 个页面标了 data-pagefind-body`);
    problems.push(`索引覆盖数（${total}）与标了 data-pagefind-body 的页面数（${marked}）对不上`);
  }
}

console.log('\n' + '─'.repeat(64));
if (problems.length === 0) {
  console.log('搜索可用性检查通过。\n');
} else {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log('');
}
process.exitCode = problems.length === 0 ? 0 : 1;
