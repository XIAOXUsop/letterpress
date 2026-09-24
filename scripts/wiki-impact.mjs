#!/usr/bin/env node
/**
 * 来源变更的影响分析：**输出三组，绝不混为一谈**。
 *
 * ── 它回答的问题 ────────────────────────────────────────────────────
 *
 * 「我登记的某个来源出了新版，哪些页面要动？」
 *
 * 在此之前这个问题没有答案：引用只是一串链接，链接里不带版本，
 * 所以"哪些页面引了这个来源"和"哪些页面引了这个来源的**这一版**"
 * 分不开。而这正是版本登记存在的全部理由。
 *
 * ── 三组的区别是**这一页最要紧的东西** ──────────────────────────────
 *
 *   1. **直接引用者**——明确引用了这个来源的**这个版本**。确定性最高：
 *      来源一变，这些页面必然要复查。
 *   2. **可能受影响者**——直接引用者的**一跳邻居**。它们**只是候选**：
 *      相邻不等于受影响。把这两组合并输出，就等于把"必然"降级成"可能"，
 *      读者会以为整片都要改，然后学会无视这个工具。
 *   3. **仓库辅助载体**——`docs/` 与代码注释里的关联说明。它们**不在
 *      发布集合里**，所以最容易漏；但也正因为不在发布集合里，
 *      它们**不会**因为漏改而在线上出错——所以只列出来，不标级别。
 *
 * ── 它**不做**什么 ──────────────────────────────────────────────────
 *
 * - **不联网**：只说"已登记的这个版本被谁引用了"，不去看远端有没有新版。
 *   判断远端是否变化是另一件事（需要网络、需要登录、也不可靠）。
 * - **不改任何文件**：只输出清单。按路线图，应用修改要校验生成时的
 *   文件 hash，目标变了就停下重规划——那是下一步的事。
 *
 * 用法：
 *   node scripts/wiki-impact.mjs --source css-values-4
 *   node scripts/wiki-impact.mjs --source css-values-4 --revision WD-20240312
 *   node scripts/wiki-impact.mjs --list
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadSources } from '../src/lib/wiki/sources.ts';
import { computeImpact, isDisjoint } from '../src/lib/wiki/impact.ts';
import { readContentDirs } from '../src/lib/wiki/read-page.ts';
import { EXIT_EMPTY_INPUT, EXIT_INVARIANT, EXIT_NOT_FOUND } from '../src/lib/cli/exit-codes.mjs';

const args = process.argv.slice(2);
const getArg = (name) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const sourceId = getArg('source');
const revision = getArg('revision');
const listOnly = args.includes('--list');

const WIKI_DIR = join(process.cwd(), 'src', 'content', 'wiki');
const POSTS_DIR = join(process.cwd(), 'src', 'content', 'posts');
const DOCS_DIR = join(process.cwd(), 'knowledge', 'sources');
const registry = loadSources(DOCS_DIR);

if (registry.size === 0) {
  console.error(`\n${DOCS_DIR} 里一个来源都没登记——这一步什么都分析不了。`);
  process.exit(EXIT_EMPTY_INPUT);
}

if (listOnly || !sourceId) {
  console.log('\n已登记的来源');
  console.log('─'.repeat(64));
  for (const [id, src] of [...registry].sort()) {
    const revs = src.revisions.map((r) => r.id).join('、');
    console.log(`  ${id.padEnd(22)} ${src.title}`);
    console.log(`  ${''.padEnd(22)} 版本：${revs}`);
  }
  console.log('\n  用 --source=<id> 看它被谁引用了。\n');
  process.exit(0);
}

const source = registry.get(sourceId);
if (!source) {
  console.error(`\n没登记过 "${sourceId}"。已登记：${[...registry.keys()].sort().join('、')}`);
  process.exit(EXIT_NOT_FOUND);
}
if (revision && !source.revisions.some((r) => r.id === revision)) {
  console.error(
    `\n"${sourceId}" 没有登记过版本 "${revision}"。` +
      `已登记：${source.revisions.map((r) => r.id).join('、')}`,
  );
  process.exit(EXIT_NOT_FOUND);
}

/*
 * 语料 = wiki **与 posts**，读取交给 `src/lib/wiki/read-page.ts`。
 *
 * 此前只扫 wiki，于是「google / ahrefs 没人引用」其实是**这一层没进语料**
 * ——它们的引用方是 post。这四份来源正是文章里那些日期化规范 URL 的登记对象，
 * 而日期化 URL 写出来就是为了不被移动版本顶掉，**不登记等于白写**。
 */
const { pages } = readContentDirs([WIKI_DIR, POSTS_DIR]);

// 计算交给 `src/lib/wiki/impact.ts`——那里有 14 条测试覆盖它，
// 包括阶段 3 的「预埋来源变更召回率 100%」。**这份逻辑原先写在本文件顶层，
// 因此零测试**：verify.test.ts 只把这个文件当作「存不存在」的一个素材。
// 复制一份到测试里再验一遍，等于验了个副本——所以是抽出去共用，不是不动。
const { direct, candidates: neighbors } = computeImpact(pages, sourceId, revision);
const directSlugs = new Set(direct.map((p) => p.slug));

// 仓库辅助载体：docs/ 与代码注释里提到这个来源的地方
const repoMentions = [];
function scanRepo(dir, depth = 0) {
  if (depth > 3 || !existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      scanRepo(full, depth + 1);
    } else if (/\.(?:md|css|ts|mjs|astro)$/.test(entry.name)) {
      if (full.includes(join('knowledge', 'sources'))) continue; // 登记表自己不算
      const text = readFileSync(full, 'utf8');
      if (text.includes(sourceId) || text.includes(source.url)) {
        const rel = full.slice(process.cwd().length + 1).replace(/\\/g, '/');
        // 已在 ① 里列过的页面不在这里重复——**三组必须互不重叠**。
        // 重叠会让人以为"还有别的地方要改"，而那正是这个工具要消除的困惑。
        // 下面还有一道 `isDisjoint` 断言兜底：这里是过滤，断言是保证。
        const asSlug = rel
          .replace(/^src\/content\/wiki\//, '')
          .replace(/\.mdx?$/, '');
        if (rel.startsWith('src/content/wiki/') && directSlugs.has(asSlug)) continue;
        repoMentions.push(rel);
      }
    }
  }
}
scanRepo(join(process.cwd(), 'docs'));
scanRepo(join(process.cwd(), 'src'));

// 三组互不重叠是**断言**，不是约定。原先这里是内联的一个 `if (... ) continue`，
// 靠写代码的人记得加——而重叠的后果是读者以为「还有别的地方要改」，
// 恰好是这个工具要消除的困惑。改成断言后，重叠会直接中止。
if (!isDisjoint({ direct, candidates: neighbors }, repoMentions)) {
  console.error('\n① 与 ③ 出现重叠：同一篇 wiki 页既被算作直接引用者，又出现在仓库辅助载体里。');
  console.error('这会让读者以为「还有别的地方要改」。请修 scanRepo 的收集范围。');
  process.exit(EXIT_INVARIANT);
}

// ── 输出 ────────────────────────────────────────────────────────────
const revLabel = revision ? `@${revision}` : '（全部版本）';
console.log(`\n${source.title}`);
console.log(`  ${sourceId}${revLabel}  ·  ${source.url}`);
console.log('─'.repeat(64));

console.log(`\n① 直接引用者（${direct.length}）——来源一变，这些页面**必然**要复查`);
if (direct.length === 0) {
  console.log('    （没有页面引用它）');
}
for (const p of direct) {
  for (const r of p.sources.filter((x) => x.sourceId === sourceId)) {
    console.log(`    ${p.slug}  ·  ${r.revision}${r.locator ? `  ·  ${r.locator}` : ''}`);
  }
}

console.log(`\n② 可能受影响者（${neighbors.size}）——**只是候选**，相邻不等于受影响`);
if (neighbors.size === 0) {
  console.log('    （没有相邻页面）');
}
for (const [slug, via] of [...neighbors].sort()) {
  console.log(`    ${slug}  （经 ${via}）`);
}

console.log(`\n③ 仓库辅助载体（${repoMentions.length}）——不在发布集合里，但别漏`);
if (repoMentions.length === 0) {
  console.log('    （docs/ 与 src/ 里没有提到它）');
}
for (const f of repoMentions.sort()) console.log(`    ${f}`);

console.log(
  '\n注：**不判断远端有没有出新版**——那需要联网，而本命令只读已登记的事实。\n' +
    '    ①②③ 的确定性依次递减，**不要合并看待**。\n',
);
