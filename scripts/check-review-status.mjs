#!/usr/bin/env node
/**
 * `wiki:review --list` 的**内容层契约**：它报的复核状态必须与 frontmatter 一致。
 *
 * ── 为什么要有这个 ──────────────────────────────────────────────────
 *
 * 2026-09-24 实测一个**真 bug**：`node scripts/wiki-review.mjs --list`
 * 把 6 个知识页**全部**显示成「未复核」（`○`），而它们的 frontmatter
 * 里明明白白写着 `review: status: reviewed`。
 *
 * 根因：这个脚本自己手写了一份 frontmatter 解析，
 * `frontmatterField(source, 'status')` 用的是 `^status:`（**行首**），
 * 而状态写在 `review:` 块里、**缩进两格**——于是永远匹配不到，读出 `null`。
 *
 * > 同一份解析在 `src/lib/wiki/read-page.ts` 里**是对的**（它解析出了 `reviewed`）。
 * > 两份实现漂开了，而**没有检查比对过它们**。
 * >
 * > 更糟的是：脚本文件里的注释写着
 * > 「**直接 import TS 源，不在这里重写一份算法**」——
 * > 而它紧接着就重写了。**注释承诺了，代码没做**（本轮第五次同型）。
 *
 * 为什么这条值得单独一个门禁：**它是给人做复核判断用的工具，
 * 而它说的「没复核」全是假的。** 工具说谎比没有工具更糟。
 *
 * 用法：`npm run verify:review-status`
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const WIKI = join(ROOT, 'src', 'content', 'wiki');

console.log('wiki:review 报的复核状态与 frontmatter 一致吗');
console.log('─'.repeat(64));

const { readContentPage } = await import(
  pathToFileURL(join(ROOT, 'src', 'lib', 'wiki', 'read-page.ts')).href
);

const files = readdirSync(WIKI).filter((f) => /\.mdx?$/.test(f));
if (files.length === 0) {
  console.error('一个知识页都没有——这个检查没量到东西。');
  process.exit(1);
}

const problems = [];

/** 跑真正的 CLI，解析它 `--list` 打印的那张表。 */
function runList() {
  const out = execFileSync('node', [join(ROOT, 'scripts', 'wiki-review.mjs'), '--list'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  // 行形如 `  ● letterpress              letterpress`
  const marks = new Map();
  for (const line of out.split('\n')) {
    const m = /^\s*([●○])\s+(\S+)/.exec(line);
    if (m) marks.set(m[2], m[1] === '●' ? 'reviewed' : 'unreviewed');
  }
  return marks;
}

let reported;
try {
  reported = runList();
} catch (error) {
  console.error(`跑 wiki-review --list 失败：${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

for (const file of files) {
  const page = readContentPage(WIKI, file);
  const actual = page.review?.status ?? 'unreviewed';
  const shown = reported.get(page.slug) ?? '（没报出来）';
  const ok = shown === actual;
  console.log(`  ${ok ? '✓' : '✗'} ${page.slug.padEnd(22)} frontmatter=${actual.padEnd(10)} CLI 报 ${shown}`);
  if (!ok) {
    problems.push(
      `${page.slug}：frontmatter 是 ${actual}，而 CLI 报 ${shown}。\n` +
        `    这不是显示问题——**wiki:review 是给人做复核判断用的工具**，\n` +
        `    它把「已复核」说成「未复核」会让人以为要重新复核一遍。`,
    );
  }
}

console.log('');
console.log('摘要与 frontmatter 里写的一致吗');
console.log('─'.repeat(64));

/**
 * ⚠️ **这一条是后来补的，而它抓到的东西比第一条严重。**
 *
 * 修完 `status` 之后脚本能跑了，但**三个知识页算出的摘要与 frontmatter 全不一样**——
 * 于是 `--list` 会把它们报成 stale，看起来像「机制坏了」。
 * 真因：`readContentPage` 切出的 body 以一个空行开头（`\n` + 正文），
 * 而摘要要求与 Astro 的 `entry.body` 同口径（**trim 过**）。
 *
 * > 那个 `trim()` 的必要性原先只写在 `wiki-review.mjs` 自己的注释里，
 * > 而那份实现连同注释一起被换掉了——**约定写在调用方，换实现时就丢了**。
 * > 丢失之后症状是**静默算错**，不是报错。
 *
 * 所以判据不能只查状态：**摘要对不上时状态也会「对」**（都显示未复核），
 * 两条一起绿才是最危险的组合。
 */
for (const file of files) {
  const page = readContentPage(WIKI, file);
  const slug = page.slug;
  const declared = page.review?.contentDigest ?? null;
  if (!declared) {
    console.log(`  – ${slug.padEnd(22)} frontmatter 没写 contentDigest（未复核，跳过）`);
    continue;
  }
  const stdout = execFileSync('node', [join(ROOT, 'scripts', 'wiki-review.mjs'), `--slug=${slug}`], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const computed = /当前正文摘要：\s*\n\s*([0-9a-f]{64})/.exec(stdout)?.[1] ?? '（没解析出来）';
  const ok = computed === declared;
  console.log(
    `  ${ok ? '✓' : '✗'} ${slug.padEnd(22)} ${ok ? '摘要一致' : `不一致：frontmatter=${declared.slice(0, 12)}… CLI=${computed.slice(0, 12)}…`}`,
  );
  if (!ok) {
    problems.push(
      `${slug}：脚本算出的摘要与 frontmatter 里写的不一致。\n` +
        `    这会让**所有已复核页面都被报成 stale**，而症状是「机制坏了」而不是「取值口径不对」。\n` +
        `    最可能的原因：body 的 trim 口径与 Astro 的 entry.body 不一致。`,
    );
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处不一致。\n`);
  process.exit(1);
}
console.log(`\n${files.length} 个知识页的复核状态，CLI 与 frontmatter 全部一致。\n`);
