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
import { execFileSync } from 'node:child_process';
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

/*
 * ── 转述：README 与 docs/cli.md 里那几处「异构内容集」的数字 ──────────
 *
 * ⚠️ **2026-09-28 加。** 上面核的是这份文档自己的表格，
 * 而 **README 与 `docs/cli.md` 里也抄了同一批数字**
 * （几篇、几条断言、几种破坏、适配层多少行）——
 * 2026-09-28 实测它们写的是 **6 篇 / 18 条 / 7 种 / 20 行**，
 * 实际是 **9 / 20 / 8 / 3**。**漂了很久没人发现，因为没有任何东西核它。**
 *
 * > **一个数字在三个地方写着，就要有三处都能被核对。**
 * > 否则修了一处，另两处继续骗人——而读者读到的是**任意一处**。
 */
console.log('');
console.log('  转述：README / docs/cli.md 里的异构内容集数字');

const FIXTURE = join(ROOT, 'knowledge', 'fixtures', 'second-site');
const fixtureCount = readdirSync(FIXTURE).filter((f) => /\.mdx?$/.test(f)).length;

/** 数一个门禁输出里 `✓` 的条数——那才是「断言数」，不是脚本里写了多少条。 */
function countPassing(script) {
  const out = execFileSync('node', [join(ROOT, 'scripts', script)], { encoding: 'utf8' });
  return (out.match(/^ {2}✓ /gm) ?? []).length;
}
const assertionCount = countPassing('check-second-site-real.mjs');

const cliText = readFileSync(join(ROOT, 'docs', 'cli.md'), 'utf8');
const readmeText = readFileSync(join(ROOT, 'README.md'), 'utf8');

/**
 * 文档里必须出现「实测值 + 明确的词」，否则就是没写或写旧了。
 *
 * ⚠️ **只匹配数字，不要求闭合的 `**`**——第一版写的是 `\*\*20 条断言\*\*`，
 * 而 README 里那句末尾跟着一个斜体星号（`…负向验证*`），
 * 于是判据红了而文档是对的。**判据自己红、被测对象对**，那是最坏的一种失败。
 */
function checkMention(name, text, pattern, actual) {
  if (pattern.test(text)) {
    console.log(`  ✓ ${name}：写的是 ${actual}`);
  } else {
    problems.push(
      `${name} 没写当前的实测值 ${actual}——它要么没提，要么还写着旧数字`,
    );
    console.log(`  ✗ ${name}：找不到 ${actual}`);
  }
}

checkMention('docs/cli.md 的 fixture 篇数', cliText, new RegExp(`\\*\\*${fixtureCount} 篇\\*\\*`), fixtureCount);
checkMention('README 的 fixture 篇数', readmeText, new RegExp(`\\*\\*${fixtureCount} 篇\\*\\*`), fixtureCount);
checkMention('README 的断言条数', readmeText, new RegExp(`${assertionCount} 条断言`), assertionCount);

/*
 * ⚠️ **2026-09-28 加：文档提到的每个 `npm run <名字>` 都必须真的存在。**
 *
 * 实测抓到一处：`docs/cli.md` 那一行写的是 `npm run check:portability`，
 * 而真实名字是 **`verify:portability`**——照着文档敲会得到
 * `npm ERR! Missing script: "check:portability"`。
 *
 * > 它一直没人发现，是因为**没人照着敲那一行**
 * > （`verify:all` 第 12 步跑的是正确名字，而所有门禁都绿）。
 * > **文档里的命令名是一次转述，转述就会漂。**
 *
 * ⚠️ 只核 `docs/cli.md` 与 `README.md`——它们是**命令清单**所在的地方。
 * 正文里举例写的 `npm run xxx` 可能在讲「假如有这样一个命令」，不判。
 */
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const defined = new Set(Object.keys(pkg.scripts));
  const ghosts = new Set();
  for (const [name, text] of [['docs/cli.md', cliText], ['README.md', readmeText]]) {
    for (const m of text.matchAll(/npm run ([a-z][a-z0-9:_-]*)/g)) {
      if (!defined.has(m[1])) ghosts.add(`${name} → npm run ${m[1]}`);
    }
  }
  if (ghosts.size > 0) {
    problems.push(
      `文档里提到的命令在 package.json 里不存在：\n`
      + [...ghosts].map((g) => `      ${g}`).join('\n') + '\n'
      + '    **照着文档敲会得到 `Missing script`。** 改文档，别改 package.json——'
      + '文档转述命令名时最容易写成「自己以为的那个」。',
    );
    console.log(`  ✗ 文档提到 ${ghosts.size} 个不存在的命令`);
  } else {
    const total = [...cliText.matchAll(/npm run ([a-z][a-z0-9:_-]*)/g)].length
      + [...readmeText.matchAll(/npm run ([a-z][a-z0-9:_-]*)/g)].length;
    console.log(`  ✓ 文档提到的 ${total} 处命令都真实存在`);
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处对不上。\n`);
  process.exit(1);
}
console.log('\n接线文档与各处转述里的实测数字，与现在跑出来的一致。\n');
