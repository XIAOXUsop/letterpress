#!/usr/bin/env node
/**
 * 拿 `knowledge/questions.md` 当尺子，量一遍检索。
 *
 * ── 这个脚本自己最该防的三件事 ──────────────────────────────────────
 *
 * 这个仓库里已经反复出现过「检查是坏的，而且坏得看不出来」。
 * 所以这里先把三种失效模式各堵一道：
 *
 *   1. **量到的集合是空的**——解析器没匹配上格式，于是「0 条问题全部通过」。
 *      先断言条数，再断言每一条都真的被解析出了期望。
 *   2. **一条不检查任何东西的问题**——只写了问句、没写期望命中也
 *      没写「期望判定：无依据」。它会静静地通过。这里单独报出来。
 *   3. **把「没量到」说成「对上了」**——例如语料为空时，
 *      任何查询都返回空集，「不得出现」全部满足。所以语料也要先断言非空。
 *
 * 用法：
 *   node scripts/check-questions.mjs
 *   node scripts/check-questions.mjs --verbose
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { splitPassages, assess } from '../src/lib/wiki/retrieve.ts';
import { readContentDirs } from '../src/lib/wiki/read-page.ts';

const verbose = process.argv.includes('--verbose');
const ROOT = process.cwd();
const QUESTIONS = join(ROOT, 'knowledge', 'questions.md');
const WIKI = join(ROOT, 'src', 'content', 'wiki');
const POSTS = join(ROOT, 'src', 'content', 'posts');

const problems = [];

// ── 语料 ────────────────────────────────────────────────────────────

/*
 * 语料 = wiki **与 posts**，与 `scripts/wiki-ask.mjs` **完全一致**。
 *
 * 2026-09-24 实测：wiki-ask 修好之后能答「七个 agent 里哪几个主动要 markdown」，
 * 而这个金标检查**仍然只量 6 页 wiki**——于是「金标全过」量的东西
 * 与用户实际问到的语料**不是同一份**。
 *
 * > **一个量着 A、跑着 B 的金标，绿灯是没有意义的。**
 * > 这次不是「金标漏了一条问题」，是**金标与被测对象脱节**——
 * > 比漏一条更难发现，因为它连「条数」都显得正常。
 *
 * 解析走 `src/lib/wiki/read-page.ts`（与 wiki-ask、check-impact、wiki-impact 共用）。
 */
const { pages: corpus } = readContentDirs([WIKI, POSTS]);
if (corpus.length === 0) {
  console.error(`${WIKI} 与 ${POSTS} 里一个条目都没有——这个检查什么都没量。`);
  process.exit(1);
}
const passages = corpus.flatMap((d) => splitPassages(d.slug, d.body.trim()));
const known = new Set(corpus.map((d) => d.slug));

if (passages.length < corpus.length) {
  console.error(`切出 ${passages.length} 段却读了 ${corpus.length} 页——切段逻辑有问题。`);
  process.exit(1);
}

// ── 解析金标 ────────────────────────────────────────────────────────

const text = readFileSync(QUESTIONS, 'utf8');
const listOf = (raw) =>
  (raw ?? '').split(/[、,，]/).map((s) => s.trim()).filter(Boolean);

const questions = [];
let category = '';
let current = null;
// 围栏代码块要整段跳过。**这不是洁癖**：文件开头「怎么写一条」那一节里
// 就有一份 `### 问题的原话` 的格式示例，不跳过的话它会被当成一条真题，
// 而它点名的 `slug-a` / `slug-b` 根本不存在——于是金标自己把自己搞红。
// （第一次跑就是这么红的。）
let inFence = false;
const flush = () => {
  if (current) questions.push(current);
  current = null;
};

for (const line of text.split('\n')) {
  if (/^\s*```/.test(line)) {
    inFence = !inFence;
    continue;
  }
  if (inFence) continue;

  const cat = /^##\s+(.*)$/.exec(line);
  if (cat) {
    flush();
    category = cat[1].trim();
    continue;
  }
  const q = /^###\s+(.*)$/.exec(line);
  if (q) {
    flush();
    current = { category, question: q[1].trim(), expect: [], forbid: [], noAnswer: false, hasSpec: false, knownLimit: null };
    continue;
  }
  if (!current) continue;
  const expect = /^期望命中：(.*)$/.exec(line);
  if (expect) {
    current.expect = listOf(expect[1]);
    current.hasSpec = true;
    continue;
  }
  const forbid = /^不得出现：(.*)$/.exec(line);
  if (forbid) {
    current.forbid = listOf(forbid[1]);
    current.hasSpec = true;
    continue;
  }
  const verdict = /^期望判定：(.*)$/.exec(line);
  if (verdict) {
    current.noAnswer = verdict[1].trim() === '无依据';
    current.hasSpec = true;
    continue;
  }
  // 已知局限：这一条**期望就是过不了**。理由必须写下来。
  const known = /^已知局限：(.*)$/.exec(line);
  if (known) {
    current.knownLimit = known[1].trim();
    current.hasSpec = true;
  }
}
flush();

// ── 闸：先证明这把尺子量到了东西 ────────────────────────────────────

if (questions.length === 0) {
  console.error('\n金标里一条问题都没解析出来——检查 `### ` 与「期望命中：」的格式。');
  process.exit(1);
}

const specLess = questions.filter((q) => !q.hasSpec);
if (specLess.length > 0) {
  problems.push(
    `${specLess.length} 条问题没有写任何期望（既没有「期望命中」也没有「期望判定」），` +
      `它们会无条件通过：${specLess.map((q) => q.question).join('、')}`,
  );
}

const unknownSlugs = new Set();
for (const q of questions) {
  for (const slug of [...q.expect, ...q.forbid]) {
    if (!known.has(slug)) unknownSlugs.add(slug);
  }
}
if (unknownSlugs.size > 0) {
  problems.push(
    `金标里点名的页面不存在：${[...unknownSlugs].join('、')}——` +
      `写错名字的金标要么恒真、要么恒假，两种都没有意义`,
  );
}

// ── 逐条跑 ──────────────────────────────────────────────────────────

console.log('\n检索金标');
console.log('─'.repeat(72));

let lastCategory = '';
const knownLimits = [];
for (const q of questions) {
  if (q.category !== lastCategory) {
    console.log(`\n  ${q.category}`);
    lastCategory = q.category;
  }

  const { passages: ranked, supported, reason } = assess(passages, q.question, {
    limit: 8,
    perDoc: 3,
  });
  const got = new Set(ranked.map((r) => r.docId));
  const fails = [];

  // 「无答案」类：期望就是没有依据
  if (q.noAnswer) {
    if (supported) {
      fails.push(`期望「没有依据」，却给出了 ${[...got].join('、')}（${reason}）`);
    }
    // 这一类同时用「不得出现」挡住「反正都返回一遍」的实现
  } else {
    if (!supported) fails.push(`期望有依据，却报了「没有依据」：${reason}`);
    for (const slug of q.expect) {
      if (!got.has(slug)) fails.push(`少了 ${slug}`);
    }
  }

  for (const slug of q.forbid) {
    if (got.has(slug)) fails.push(`不该出现的 ${slug} 出现了`);
  }

  if (fails.length === 0) {
    // **已知局限翻绿了，是问题不是好消息。** 它意味着检索器变了，
    // 而文档里写着的那条局限可能已经不成立——不更新就等于文档在说谎。
    if (q.knownLimit) {
      console.log(`    ⚠ ${q.question}`);
      console.log(`        这条标着「已知局限」的用例**过了**：${q.knownLimit}`);
      console.log('        要么它真的被修好了（请去掉标记并更新 docs），');
      console.log('        要么是门槛被放宽到放它过去（那更糟）。');
      problems.push(`「${q.question}」标着已知局限却通过了——标记或文档需要更新`);
      continue;
    }
    const mark = q.noAnswer ? '∅' : '✓';
    const shown = q.noAnswer ? '（正确地报「没有依据」）' : `→ ${[...got].join('、')}`;
    console.log(`    ${mark} ${q.question}`);
    if (verbose || q.noAnswer) console.log(`        ${shown}`);
  } else if (q.knownLimit) {
    knownLimits.push(`${q.question} —— ${q.knownLimit}`);
    console.log(`    ✗ ${q.question}`);
    console.log(`        （已知局限，不计为失败）${q.knownLimit}`);
  } else {
    console.log(`    ✗ ${q.question}`);
    for (const f of fails) console.log(`        ${f}`);
    problems.push(`${q.question}：${fails.join('；')}`);
  }
}

// ── 汇总 ────────────────────────────────────────────────────────────

const noAnswerCount = questions.filter((q) => q.noAnswer).length;
console.log('\n' + '─'.repeat(72));
console.log(
  `  ${questions.length} 条问题（其中 ${noAnswerCount} 条期望「没有依据」）` +
    ` · 语料 ${corpus.length} 页 / ${passages.length} 段`,
);

if (knownLimits.length > 0) {
  console.log(`\n  ⚠ ${knownLimits.length} 条**已知局限**（金标里写了理由，不计为失败）：`);
  for (const k of knownLimits) console.log(`      ${k}`);
  console.log('    它们列在这里，是为了让这个数字**可见**——一个不被看见的局限，');
  console.log('    下次有人问「检索准吗」时，答案会变成「金标全绿」。');
}

if (problems.length === 0) {
  console.log('\n  检索金标全过。\n');
} else {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log('');
}
process.exitCode = problems.length === 0 ? 0 : 1;
