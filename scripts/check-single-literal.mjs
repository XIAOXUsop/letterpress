#!/usr/bin/env node
/**
 * **同一份清单不许在两处各写一遍。**
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 2026-09-28 一天之内在 `letterpress` 找到**四处**「同一件事两处实现」：
 *
 * | # | 重复的东西 | 漂开的后果 |
 * |---|---|---|
 * 1 | frontmatter 解析（`wiki-impact.mjs` / `check-impact.mjs` 各一份逐行扫描） | 两个命令对同一页给出不同的引用集，**两边都绿** |
 * 2 | `urlFor` 的 URL 前缀（`graph.ts` / remark 插件各一份） | 站内链接与页面路由对不上——**死链** |
 * 3 | `readContentDirs` 与 `readContentPage` 各算一遍 `summary` / `original` | 同一个字段两个真值，差异是「两个方向各缺一半」 |
 * 4 | `DOC_GLOBS` 与 `ROOTS`（两份逐字相同的文档清单） | 两道门禁扫不同的东西，**而读者只看到一道的结论** |
 *
 * > **共同形态：漂开时不报错。** 每处都要靠人偶然发现，
 * > 而发现成本随项目变大而上升——所以第 4 处是在**已经找到第 3 处之后**
 * > 才用一条 grep 找到的。
 *
 * ── 判据 ────────────────────────────────────────────────────────────
 *
 * **已登记的清单不许在别处再写一遍字面量。**
 * `SHARED_LITERALS` 是登记处，每条写清**它是什么、为什么该只有一处**。
 * 扫全部 `.ts` / `.mjs`，报出「除登记处以外还出现的地方」。
 *
 * ⚠️ **它量的是「字面量又出现了」，不是「逻辑又实现了」。**
 * 后者量不到（那要读懂每个函数）——但**字面量是绝大多数漂开的载体**，
 * 而漏报的代价（悄悄多一处真值）高于误报的代价（多写一行注释）。
 *
 * 用法：`node scripts/check-single-literal.mjs`
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const problems = [];

/**
 * 登记：**这个字面量只允许在这里出现。**
 *
 * ⚠️ 加一条之前先答：**它漂开的后果是什么？** 答不上来就别登记——
 * 那只是一次重构，不是门禁。
 */
const SHARED_LITERALS = [
  {
    literal: "'README.md', 'AGENTS.md', 'docs', 'src/content'",
    where: 'scripts/lib/doc-roots.mjs',
    what: '「哪些文件算文档」的清单',
    why: '两份拷贝时，check-doc-refs 与 check-anchor-links 会扫不同的东西，'
      + '而读者只看到其中一道的结论',
  },
  {
    // 「解析 frontmatter 里的 sources / review / original」没有单一字面量——
    // 它的实现标志是**逐行扫块**（`for (const line of block.split`）。
    // 所以这条走 `implOf` 而不是 `literal`。
    implOf: (t) => /for \(const line of block\.split/.test(t),
    where: 'src/lib/wiki/read-page.ts',
    what: 'frontmatter 块（sources / review / original）的逐行解析',
    why: '两份实现时 wiki:impact 与 check:impact 会对同一页给出不同的引用集，'
      + '**而两个命令都是绿的**',
  },
];

console.log('同一份清单不许写两遍');
console.log('─'.repeat(64));

// 扫全部源码
const files = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) {
      if (!['node_modules', '.git', 'dist', '.astro', '.verify', 'public'].includes(e.name)) walk(p);
    } else if (/\.(ts|mjs|astro)$/.test(e.name)) {
      files.push(p);
    }
  }
};
for (const d of ['src', 'scripts']) walk(join(ROOT, d));

if (files.length === 0) {
  console.error('一个源码文件都没扫到——这个检查什么都没量。');
  process.exit(1);
}
console.log(`  扫了 ${files.length} 个文件\n`);

/*
 * ⚠️ **必须排除本文件。**
 *
 * `SHARED_LITERALS` 里就写着那个字面量（那是**登记处**），
 * 而本文件自己也是被扫的 `.mjs`——于是它把自己判成「第二处」。
 *
 * 第一次跑就是这样红的。**判据自己红了，而被测对象是对的。**
 *
 * 排除的办法是**按文件名**（与 `check-portability` 排除自己的做法一致），
 * 不是靠「字符串等于自己」这种自指判断。
 */
/*
 * ⚠️ **必须排除「故意弄坏」的那些。**
 *
 * ① 本文件自己——`SHARED_LITERALS` 里就写着那个字面量（那是**登记处**），
 *    而本文件自己也是被扫的 `.mjs`——于是它把自己判成「第二处」。
 * ② `*.mutations.mjs`——**那些脚本的职责就是把某个写法复制一份**，
 *    所以它们必然含被登记的字面量。**它们不是真值，是测试夹具。**
 *
 * ⚠️ ① 第一次跑就抓到了（2026-09-28）；
 * ② 是写完 `new-gates.mutations.mjs` 之后立刻撞上的——
 * **新增一个变异脚本就会触发**，而那正是这个门禁该报的「第二处」，
 * 只是那处**不是漂开，是夹具**。
 *
 * 排除的办法是**按文件名模式**，不是自指判断。
 */
const SELF = 'check-single-literal.mjs';
const scanned = files.filter((f) => !f.endsWith(SELF) && !f.endsWith('.mutations.mjs'));
if (scanned.length === 0) {
  console.error('排除自己之后一个文件都不剩——这个检查什么都没量。');
  process.exit(1);
}

for (const item of SHARED_LITERALS) {
  if (!item.where) continue; // 允许多处的条目不进判据
  /*
   * 两种匹配：**字面量**（`literal`）与**实现标志**（`implOf`）。
   * 后者用于「那段解析没有单一字面量，但它的写法可以认」的情况——
   * 2026-09-28 已修的第一处（frontmatter 块解析）就是这种。
   */
  const matches = (text) => (item.literal ? text.includes(item.literal) : item.implOf(text));
  const hits = scanned
    .filter((f) => matches(readFileSync(f, 'utf8')))
    .map((f) => relative(ROOT, f).split(sep).join('/'));

  if (hits.length === 0) {
    problems.push(
      `登记的清单「${item.what}」在 \`${item.where}\` 里找不到了——\n`
      + '    要么它被改名 / 挪走（那要更新这条登记），要么它**真的没了**'
      + '（那两道门禁正扫不到东西，而它们会绿）。',
    );
    console.log(`  ✗ ${item.what}：登记处已经找不到了`);
  } else if (hits.length > 1) {
    problems.push(
      `「${item.what}」出现在 ${hits.length} 处：${hits.join('、')}\n`
      + `    登记处是 \`${item.where}\`。\n`
      + `    **漂开的后果**：${item.why}\n`
      + '    把多余的改成 import 登记处；若那处确实该有一份自己的，'
      + '**先答「漂开的后果是什么」再改这条登记**。',
    );
    console.log(`  ✗ ${item.what}：${hits.length} 处（${hits.join('、')}）`);
  } else {
    console.log(`  ✓ ${item.what}：只在 ${hits[0]}`);
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log(`\n${SHARED_LITERALS.filter((i) => i.where).length} 份登记的清单都只有一处。\n`);
