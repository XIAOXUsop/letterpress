#!/usr/bin/env node
/**
 * `docs/onboarding-a-new-site.md` 里的**实测数字**必须与现在跑出来的一致。
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 那份文档教人「接一个新站点」，里面有两张表：
 * 「只读 wiki → 3 条断链 / wiki+posts → 0 条断链」与
 * 「`summary` 留空 → lint 10 条 / 补上 → 4 条」。
 *
 * **它们是实测的**（2026-09-28）。而实测数字与文档脱钩这件事，
 * 本项目已经吃过好几次亏：`README` 的测试条数漂过（127→132、263→272），
 * `docs/content-negotiation.md` 写着已被删掉的词表对照。
 *
 * > **文档里的实测数字也是断言。** 不核对它，它就只是一个曾经为真的说法。
 *
 * ── 判据为什么是「重跑」而不是「抄数字」 ────────────────────────────
 *
 * 把 11 / 0 / 2 这些常量抄进本脚本，只会让**脚本与文档各写一份**，
 * 两份一起漂。`verify-negotiation.mjs` 已经是这个模式
 * （它重跑一遍再比对 `docs/content-negotiation.md` 里的表）——
 * 这里沿用同一口径：**数字由代码现算，文档里的是被核对的一方。**
 *
 * 用法：`npm run check:onboarding-doc`
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readContentPage } from '../src/lib/wiki/read-page.ts';
import { pageToDoc } from '../src/lib/wiki/page-to-doc.ts';
import { buildGraph } from '../src/lib/wiki/graph.ts';
import { lint, hasErrors } from '../src/lib/wiki/lint.ts';
import { frontmatterField } from '../src/lib/wiki/frontmatter.ts';

const ROOT = process.cwd();
const DOC = join(ROOT, 'docs', 'onboarding-a-new-site.md');
const WIKI = join(ROOT, 'src', 'content', 'wiki');
const POSTS = join(ROOT, 'src', 'content', 'posts');

console.log('接线文档里的实测数字');
console.log('─'.repeat(64));

/** 读一个目录下全部内容，组装成 `Doc`。与文档里那段代码同形。 */
const readDocs = (dirs, withSummary) =>
  dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => /\.mdx?$/.test(f))
      .map((file) => {
        const full = join(dir, file);
        return pageToDoc(readContentPage(dir, file), {
          summary: withSummary
            ? frontmatterField(readFileSync(full, 'utf8'), 'summary') ?? ''
            : '',
        });
      }),
  );

/*
 * ⚠️ **语料为空时必须红。**
 * 「0 页 → 0 断链」与「11 页 → 0 断链」在这张表里长得一样，
 * 而前者说明**什么都没跑**——`src/content/` 搬走就会这样。
 * 这是本项目第四次撞上「空集合通过」，前三种形态见
 * `check-portability.mjs` 的注释。
 */
const counts = [WIKI, POSTS].map((d) => {
  try {
    return readdirSync(d).filter((f) => /\.mdx?$/.test(f)).length;
  } catch {
    return 0;
  }
});
if (counts.some((n) => n === 0)) {
  console.error(`src/content/wiki(${counts[0]}) / posts(${counts[1]}) 有一个是空的——这个检查什么都没量。`);
  process.exit(1);
}

/*
 * ⚠️ **下面的判据是「从文档表格里解析数字」，不是拿脚本里的常量核对。**
 *
 * 第一版把期望值（6 / 3 / 11 / 0 / 10 / 4）硬编码在脚本里，
 * 文档只是 `readFileSync` 进来却**从未被使用**——
 * 于是**改文档不会红，改代码才会红**。判据完全跑偏了：
 * 它核的是「代码还对不对」，而声称要核的是「文档还对不对」。
 *
 * > **一个从不读被测对象的检查，不能声称在检查它。**
 *
 * 现在真正解析 `docs/onboarding-a-new-site.md` 的两张 Markdown 表格，
 * 拿表里的数字与实测值逐格比对。**文档里没有这个表格 → 直接红**
 * （那说明文档被重写了而判据没跟上）。
 */
const problems = [];

/** 被核对的文档本身。**判据的全部数字都要从它里面取出来。** */
const text = readFileSync(DOC, 'utf8');

/** 从文档里取出某个表格单元格（按行首匹配，列按 `|` 切）。 */
function cell(lineStartsWith, col) {
  const line = text.split('\n').find((l) => l.startsWith(lineStartsWith));
  if (!line) return null;
  const cells = line.split('|').map((s) => s.trim());
  return cells[col] ?? null;
}

/** 把单元格里的数字取出来（`6`、`**3**`、`3 条`、`\`false\`` 都行）。 */
function num(cellText) {
  if (cellText === null) return null;
  const m = /-?\d+/.exec(cellText.replace(/[`*]/g, ''));
  return m ? Number(m[0]) : null;
}
function bool(cellText) {
  if (cellText === null) return null;
  const s = cellText.replace(/[`*]/g, '');
  return /true/i.test(s) ? true : /false/i.test(s) ? false : null;
}

/** 一格一格地核：文档里没有就红（而不是拿默认值蒙过去）。 */
function checkRow(label, fromDoc, measured) {
  if (fromDoc === null || fromDoc === undefined) {
    problems.push(`文档表格里找不到「${label}」的数字——判据没跟上文档的改写`);
    console.log(`  ✗ ${label}：文档表格里取不到这个值`);
    return;
  }
  if (String(fromDoc) !== String(measured)) {
    problems.push(`${label}：文档写 ${fromDoc}，实测 ${measured}`);
    console.log(`  ✗ ${label}：文档写 ${fromDoc}，实测 ${measured}`);
  } else {
    console.log(`  ✓ ${label}：文档写 ${fromDoc}，实测 ${measured}`);
  }
}

const wikiOnly = readDocs([WIKI], true);
const both = readDocs([WIKI, POSTS], true);
const gWiki = buildGraph(wikiOnly);
const gBoth = buildGraph(both);
const noSummary = lint(wikiOnly.map((d) => ({ ...d, summary: '' })), buildGraph(wikiOnly));
const withSummary = lint(wikiOnly, gWiki);

// ── 表 ①：只读一个目录 vs 读两个目录 ────────────────────────────────
/*
 * ⚠️ 列索引从 **2** 起：Markdown 表格行按 `|` 切开后，
 * 第 0 段是行首 `|` 之前的空串，第 1 段才是行标签。
 * （第一版按「人眼看到的第几列」写，从 1 起，于是全部取到 undefined——
 *  判据红了，但红在「找不到」而不是「对不上」，差点被当成文档写错了。）
 */
console.log('  表①：只读一个目录 vs 读两个目录');
checkRow('只读 wiki 的页数', num(cell('| **只读 `wiki`**', 2)), wikiOnly.length);
checkRow('只读 wiki 的断链数', num(cell('| **只读 `wiki`**', 3)), gWiki.broken.length);
checkRow('只读 wiki 的 hasErrors', bool(cell('| **只读 `wiki`**', 5)), hasErrors(lint(wikiOnly, gWiki)));
checkRow('两目录齐读的页数', num(cell('| **`wiki` + `posts`**', 2)), both.length);
checkRow('两目录齐读的断链数', num(cell('| **`wiki` + `posts`**', 3)), gBoth.broken.length);
checkRow('两目录齐读的 hasErrors', bool(cell('| **`wiki` + `posts`**', 5)), hasErrors(lint(both, gBoth)));

// ── 表 ②：summary 留空 vs 补上 ──────────────────────────────────────
/*
 * ⚠️ 用 `startsWith('| ' + 标签)` 而不是 `includes(标签)`：
 * `includes('不传')` 会连**正文里那句**「不传 `relations` 时……」一起匹配上，
 * 而那一行不是表格行——`split('|').pop()` 拿到的是整句话。
 */
console.log('');
console.log('  表②：summary 留空 vs 补上');
checkRow('`summary` 留空时 lint 条数', num(cell('| `\'\'`（不传）', 2)), noSummary.length);
checkRow('补上 summary 后 lint 条数', num(cell('| 从 frontmatter 读', 2)), withSummary.length);

/*
 * ⚠️ **「留空比补上多报」这个关系本身也要断言。**
 * 只核绝对数字的话，一次「两边都变成 2」也能过——
 * 而文档的**论点**正是那 6 条的差距。
 */
if (noSummary.length <= withSummary.length) {
  problems.push(
    `空 summary 不再比补上多报 lint（${noSummary.length} vs ${withSummary.length}）——` +
      `文档整节的前提是「留空会多报 6 条」，前提没了就该重写那一节`,
  );
  console.log(`  ✗ 空 summary 不再触发额外规则（${noSummary.length} vs ${withSummary.length}）`);
} else {
  console.log(`  ✓ 空 summary 确实多报 ${noSummary.length - withSummary.length} 条`);
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处对不上。\n`);
  process.exit(1);
}
console.log('\n接线文档里的实测数字与现在跑出来的一致。\n');
