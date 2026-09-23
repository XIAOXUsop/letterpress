#!/usr/bin/env node
/**
 * 影响分析金标检查：拿 `knowledge/impact-cases.md` 当尺子，量一遍 `computeImpact`。
 *
 * ── 这个脚本自己最该防的三件事 ──────────────────────────────────────
 *
 * 写法照抄 `check-questions.mjs` 的那三条，因为它们是**同一个仓库里
 * 真实发生过的**失效模式：
 *
 *   1. **量到的集合是空的**——金标解析失败，于是「0 条全部通过」。
 *      所以先断言条数，再断言每条都真的解析出了 `source`。
 *   2. **一条不检查任何东西的用例**——只写了 `source`，
 *      `expectDirect` 与 `expectCandidates` 都缺。这会静静通过。
 *      「空期望」是合法且有意义的（真的没人引用），但**必须显式写出来**。
 *   3. **把「没量到」说成「对上了」**——语料为空时任何查询都返回空集，
 *      所有空期望都满足。所以语料也要先断言非空。
 *
 * ── 为什么值得单独一个门禁 ──────────────────────────────────────────
 *
 * `impact.test.ts` 用构造出来的 fixture 量 `computeImpact`，量的是**函数**。
 * 这个脚本量的是**真实内容**：把 `src/content/wiki/` 真的读进来，
 * 拿真实现有的引用关系去对金标。
 *
 * 两者缺一不可：函数对但接线错（页面声明了来源却没进图），
 * 只有这个脚本能抓到——而那正是「查不动≠通过」的另一种形态。
 *
 * 用法：
 *   node scripts/check-impact.mjs
 *   node scripts/check-impact.mjs --verbose
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeImpact } from '../src/lib/wiki/impact.ts';
import { readContentDirs } from '../src/lib/wiki/read-page.ts';
import { loadSources } from '../src/lib/wiki/sources.ts';

const verbose = process.argv.includes('--verbose');
const ROOT = process.cwd();
const CASES = join(ROOT, 'knowledge', 'impact-cases.md');
const WIKI = join(ROOT, 'src', 'content', 'wiki');
const POSTS = join(ROOT, 'src', 'content', 'posts');
const SOURCES = join(ROOT, 'knowledge', 'sources');

const problems = [];

// ── 语料 ────────────────────────────────────────────────────────────

/*
 * 语料 = wiki **与 posts**，读取交给 `src/lib/wiki/read-page.ts`——
 * 与 `scripts/wiki-impact.mjs` **共用同一份**。
 *
 * 之前这里是本脚本自己抄的一套 frontmatter 扫描（含 `related` 的方括号处理），
 * 结果两个命令对同一页给出不同答案：扩展 posts 之后金标说
 * 「google-ai-features 没人引用」、命令说「markdown-for-agents 引用了它」，
 * **而两边都是绿的**。这是本仓库「两套解析」的第三例。
 */
const { pages, counts } = readContentDirs([WIKI, POSTS]);

// 两边都要非空：少一边，这个检查就只量了一半，而输出看上去一样绿。
if ([...counts.values()].some((n) => n === 0)) {
  console.error(
    `${WIKI} 或 ${POSTS} 里一个条目都没有——这个检查只能量一半。` +
      `（wiki ${counts.get(WIKI)} 篇、posts ${counts.get(POSTS)} 篇）`,
  );
  process.exit(1);
}

const registry = loadSources(SOURCES);
if (registry.size === 0) {
  console.error(`${SOURCES} 里一个来源都没登记——这个检查什么都没量。`);
  process.exit(1);
}

// ── 解析金标 ────────────────────────────────────────────────────────

/*
 * 解析金标。
 *
 * ⚠️ **三个字段必须紧邻**（中间不许有空行、不许有散文）。
 * 第一版用的是宽松正则（`\s*` 吞掉任意内容），结果把文档里的
 * `### source: …` 标题和 `>` 引用块也当成了用例——
 * 报出「金标里点名了一个没登记的来源」，而那句话根本不是用例。
 *
 * **判定模式越宽，越容易把非用例当用例。** 而金标一旦这样失准，
 * 它给出的绿灯就毫无意义——比没有金标更糟。
 */
const rawText = readFileSync(CASES, 'utf8');
/*
 * 去掉围栏代码块。**这一步不是可有可无的。**
 *
 * 收紧成「三行紧邻」之后，文档开头那段讲格式的 ``` 代码块
 * 里正好是一组合法格式的三连行，于是它被当成了一条真用例——
 * 报出「金标里点名了 `<来源 id>`，但没登记」。
 *
 * 也就是说：**格式说明本身就是一种误判来源**。
 * 两次踩坑的方向相反：第一次正则太宽（吞散文），
 * 这一次正则够紧却仍被示例骗过。**判定条件不能只看形状，还要看位置。**
 */
const text = rawText.replace(/^```[\s\S]*?^```$/gm, '');
/**
 * 解析金标里的期望列表。**不剥方括号**——金标用「、」分隔，不带括号。
 * 与 `read-page.ts` 里那个分开：那边处理 frontmatter 的 YAML 列表（要剥方括号），
 * 这边处理金标自己的写法（不带括号）。合成一个看着省事，
 * 实则让「哪种输入」这件事变得看不出来。
 */
function caseList(raw) {
  return raw
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const cases = [];
const re = /^source:[ \t]*(.+?)[ \t]*\nexpectDirect:[ \t]*(.*?)[ \t]*\nexpectCandidates:[ \t]*(.*?)[ \t]*$/gm;
for (const m of text.matchAll(re)) {
  cases.push({
    sourceId: m[1].trim(),
    direct: caseList(m[2]),
    candidates: caseList(m[3]),
  });
}

if (cases.length === 0) {
  console.error(`${CASES} 里没解析出任何一条用例——这个检查什么都没量。`);
  process.exit(1);
}
console.log(`影响分析金标\n${'─'.repeat(64)}`);
console.log(`  ${cases.length} 条用例 · ${pages.length} 页语料 · ${registry.size} 个已登记来源\n`);

// ── 逐条比对 ────────────────────────────────────────────────────────

for (const c of cases) {
  if (!registry.has(c.sourceId)) {
    problems.push(
      `${c.sourceId}：金标里点名了这个来源，但 ${SOURCES} 里没登记。` +
        `已登记：${[...registry.keys()].sort().join('、')}`,
    );
    continue;
  }

  const { direct, candidates } = computeImpact(pages, c.sourceId);
  const gotDirect = direct.map((p) => p.slug).sort();
  const gotCandidates = [...candidates.keys()].sort();

  const directOk = JSON.stringify(gotDirect) === JSON.stringify([...c.direct].sort());
  const candOk = JSON.stringify(gotCandidates) === JSON.stringify([...c.candidates].sort());

  if (!directOk) {
    problems.push(
      `${c.sourceId}：直接引用者对不上。` +
        `期望 [${c.direct.sort().join('、') || '（空）'}]，` +
        `实际 [${gotDirect.join('、') || '（空）'}]。` +
        (c.direct.length === 0 ? '（期望为空——若刚补了引用，请同步金标）' : ''),
    );
  }
  if (!candOk) {
    problems.push(
      `${c.sourceId}：候选页对不上。` +
        `期望 [${c.candidates.sort().join('、') || '（空）'}]，` +
        `实际 [${gotCandidates.join('、') || '（空）'}]。`,
    );
  }

  if (verbose || !directOk || !candOk) {
    const mark = directOk && candOk ? '∅' : '✗';
    console.log(`  ${mark} ${c.sourceId}`);
    console.log(`      ① ${gotDirect.join('、') || '（无）'}`);
    console.log(`      ② ${gotCandidates.join('、') || '（无）'}`);
  } else {
    console.log(`  ✓ ${c.sourceId}  ①${gotDirect.length} ②${gotCandidates.length}`);
  }
}

/*
 * ── 每个已登记来源都必须有用例 ──────────────────────────────────────
 *
 * 这条是**负向验证逼出来的**：注入「删掉 rfc9110-accept 那条用例」后，
 * 检查**照样是绿的**（6 条全过，退出码 0）。
 *
 * 原因：金标里有两条 `expectDirect` 为空的用例（google / ahrefs，
 * 引用方是 post、不在 wiki 图内）。删掉一条有内容的用例之后，
 * **7 个已登记来源里有 1 个从未被检查**，而检查报「全过」。
 *
 * > **「全过」不等于「都量过了」。** 这和 check-questions.mjs 里
 * > 「量到的集合是空的」是同一族，但更隐蔽一层——那一条是 0 条时报警，
 * > 这一条是**少了一条也报警不了**，因为剩下的都真的对上了。
 *
 * 修法就是把它写成断言：来源登记表与金标**一一对应**。
 * 新登记一个来源却忘了写用例，门禁会立刻红。
 */
const covered = new Set(cases.map((c) => c.sourceId));
const uncovered = [...registry.keys()].filter((id) => !covered.has(id)).sort();
if (uncovered.length > 0) {
  problems.push(
    `${uncovered.length} 个已登记来源没有金标用例：${uncovered.join('、')}。` +
      `**没被量过的来源，检查是绿的——那不是通过，是没看。**`,
  );
}
const unknown = cases.map((c) => c.sourceId).filter((id) => !registry.has(id));
if (unknown.length > 0) {
  problems.push(`金标里有未登记的来源：${unknown.join('、')}。`);
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处对不上。\n`);
  process.exit(1);
}

console.log('\n影响分析金标全过。\n');
