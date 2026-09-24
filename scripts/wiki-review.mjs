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

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
/*
 * ⚠️ **这里原来写着「直接 import TS 源，不在这里重写一份算法」——
 * 而下面紧接着就重写了 `frontmatterField` 与 `bodyOf`。**
 * 注释与实际代码不一致会误导维护者。
 *
 * 重写的代价不是「多几行代码」，是**它会一本正经地说谎**：
 * `frontmatterField(source, 'status')` 用 `^status:` 匹配**行首**，
 * 而状态写在 `review:` 块里、**缩进两格** —— 于是读出 `null`，
 * `--list` 把 6 个知识页**全报成未复核**，而它们的 frontmatter 明明白白写着
 * `review: status: reviewed`。
 *
 * > 同一份解析在 `read-page.ts` 里**是对的**。两份实现漂开了，
 * > 而没有任何检查比对过它们。
 * > 症状之所以能活这么久：它报的是「未复核」——
 * > **一个听起来很合理的默认值**，没人会去质疑。
 *
 * 修法不是补 `  status:` 的正则，是**删掉这份实现**，用 `readContentPage`。
 */
import { contentDigest } from '../src/lib/wiki/digest.ts';
import { readContentPage } from '../src/lib/wiki/read-page.ts';
import { frontmatterField } from '../src/lib/wiki/frontmatter.ts';
import { EXIT_EMPTY_INPUT, EXIT_ENVIRONMENT, EXIT_NOT_FOUND } from '../src/lib/cli/exit-codes.mjs';
import { failWithJson, jsonOk } from '../src/lib/cli/json-output.mjs';

const args = process.argv.slice(2);
const slugArg = args.find((a) => a.startsWith('--slug='))?.slice('--slug='.length)
  ?? (args.indexOf('--slug') !== -1 ? args[args.indexOf('--slug') + 1] : undefined);
const listOnly = args.includes('--list');
const asJson = args.includes('--json');

const WIKI = join(process.cwd(), 'src', 'content', 'wiki');

/**
 * 摘要用的 `Doc`。**只填参与摘要的字段**——
 * `slug` / `draft` / `explicitSlug` 不参与计算（见 `digestInput`）。
 */
function digestDoc(page, summary) {
  return {
    kind: 'wiki',
    wikiKind: page.kind,
    slug: page.slug,
    title: page.title,
    summary,
    // ⚠️ `readContentPage` 的 `body` **已经 trim 过**，
    // 与 Astro 的 `entry.body` 口径一致（差一个 trim 摘要就永远对不上）。
    body: page.body,
    // ⚠️ 字段名是 `declaredRelations`，**不是** `related`。
    // 传错键的话 `?? []` 会静静兜成空数组——摘要照样算得出，
    // 只是永远对不上，而症状是「所有已复核页面都报 stale」，
    // 看起来像机制坏了。这个坑我踩过一次，写在这里。
    declaredRelations: page.related,
    explicitSlug: false,
    draft: false,
  };
}

/*
 * ── 为什么是**两个**模块，不是一个 ──────────────────────────────────
 *
 * 第一版只用了 `readContentPage`，崩在 `toLf(undefined)`：
 * 它**不返回 `summary`**——它是给检索用的，检索不需要摘要。
 * 于是改用 `frontmatterField` 补上，而那份只认**顶层**字段
 * （它的注释明说「忽略缩进，避免取到 tags 之类的子项」），
 * 读 `status` 依然读不到。
 *
 * > 所以分工是：`frontmatter.ts` 取顶层标量（title / summary），
 * > `read-page.ts` 取嵌套块（`review:` / `sources:` / `related:`）。
 * > **两个都要，一个都不够。** 而这正是原先那份手写实现想糊过去的复杂度。
 */
function parse(file) {
  const page = readContentPage(WIKI, file);
  const source = readFileSync(join(WIKI, file), 'utf8');
  const summary = frontmatterField(source, 'summary') ?? '';
  return {
    file,
    slug: page.slug,
    title: page.title,
    // ✅ 从 `review` 块里读（read-page 解析嵌套块），不是从行首的 `status:`。
    status: page.review?.status ?? null,
    digest: contentDigest(digestDoc(page, summary)),
  };
}

let files;
try {
  files = readdirSync(WIKI).filter((f) => /\.mdx?$/.test(f));
} catch {
  console.error(`读不到 ${WIKI}——请在仓库根目录运行。`);
  process.exit(EXIT_ENVIRONMENT);
}
if (files.length === 0) {
  console.error(`${WIKI} 里一个条目都没有——这一步什么都没检查。`);
  process.exit(EXIT_EMPTY_INPUT);
}

const pages = files.map(parse);

if (listOnly || !slugArg) {
  if (asJson) {
    // 逐页给出状态与摘要——`check-review-status.mjs` 靠 `--list` 那张表做对账，
    // 这里是它读的那些值的**来源**。让 JSON 也带上，两条出口就不会漂。
    console.log(
      JSON.stringify(
        jsonOk({
          pages: [...pages]
            .sort((a, b) => (a.slug < b.slug ? -1 : 1))
            .map((p) => ({
              slug: p.slug,
              title: p.title,
              status: p.status ?? 'unreviewed',
              contentDigest: p.digest,
            })),
        }),
      ),
    );
    process.exit(0);
  }

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
  failWithJson(asJson ? 'json' : 'text', EXIT_NOT_FOUND, `找不到 ${slugArg}。`, {
    hint: '用 --list 看现有的条目。',
    valid: pages.map((p) => p.slug).sort(),
  });
}

if (asJson) {
  /*
   * ⚠️ **不输出 `checkedAt`。**
   *
   * 人读的输出里有一行 `checkedAt: <今天>`（那正是「你实际复核的那天」，
   * 填当前日期是对的）。但**它不能进 JSON**：
   *
   * > JSON 输出要能被 diff、能被缓存、能被断言。
   * > 带当天日期的话，**同一天之外的每一次运行结果都不同**——
   * > 而内容一个字都没变。这与本项目「可复现构建」是同一条主张。
   *
   * 所以 JSON 只给**可复现的部分**（slug / 状态 / 当前摘要 / 该填什么），
   * **日期由人自己填**——反正「我复核过了」是人的承诺。
   */
  console.log(
    JSON.stringify(
      jsonOk({
        slug: page.slug,
        title: page.title,
        status: page.status ?? 'unreviewed',
        contentDigest: page.digest,
        // 给的是**待粘贴的形状**，日期留空由人填
        frontmatterSnippet: {
          review: { status: 'reviewed', checkedAt: '<你实际复核的那天>', contentDigest: page.digest },
        },
      }),
    ),
  );
  process.exit(0);
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
