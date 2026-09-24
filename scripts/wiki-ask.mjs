#!/usr/bin/env node
/**
 * 把一个自然语言问题，编译成一份**可复用、可核对**的 context pack。
 *
 * ── 它要解决的问题 ──────────────────────────────────────────────────
 *
 * 「把整站塞给模型」有两个代价，第二个更要命：
 *
 *   1. **贵**——11 页（wiki + posts）还行，600 页就不行了。
 *   2. **说不清出处**——模型给出的每句话，你都不知道它读的是哪一版、
 *      那一页有没有被复核过、那个结论是不是已经被同一页的勘误推翻了。
 *
 * 所以这里的产物不是一个字符串，而是一份**带元数据的清单**：
 * 每一段都附上文档 ID、来源版本、复核状态、以及它和主命中文档的关系路径。
 * 路线图 §3 要的就是这五样。
 *
 * ── 它**不**做什么 ──────────────────────────────────────────────────
 *
 * - **不生成答案。** 它只挑选与排列。把「选材料」和「下结论」分开，
 *   是因为这两步的可验证性完全不同：选错了可以对照金标查出来，
 *   而结论错了只能靠人读。混在一起就没法自动化验证了。
 * - **不联网、不调模型。** 见 `src/lib/wiki/retrieve.ts` 里为什么不用向量。
 * - **不假装是站内搜索。** 站内搜索跑在浏览器里（Pagefind 按 `<html lang>`
 *   选分词器），Node 里复现不出来——这条教训写在 `check-search.mjs` 里。
 *   这里是另一条路径：agent 来问问题时该递什么过去。
 *
 * 用法：
 *   node scripts/wiki-ask.mjs "中文正文的理想行宽是多少"
 *   node scripts/wiki-ask.mjs --json "…"     # 给机器读
 *   node scripts/wiki-ask.mjs --all "…"      # 不截断，打全段
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MIN_COVERAGE } from '../src/lib/wiki/retrieve.ts';
import { readContentPage } from '../src/lib/wiki/read-page.ts';
import { buildContextPack } from '../src/lib/wiki/context-pack.ts';
import { EXIT_EMPTY_INPUT, EXIT_ENVIRONMENT, EXIT_USAGE } from '../src/lib/cli/exit-codes.mjs';
import { failWithJson, jsonOk } from '../src/lib/cli/json-output.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const full = args.includes('--all');
const question = args.filter((a) => !a.startsWith('--')).join(' ').trim();

if (question === '') {
  failWithJson(asJson ? 'json' : 'text', EXIT_USAGE, '给一个问题。', {
    hint: '例：node scripts/wiki-ask.mjs "为什么行宽用 em 不用 ch"',
  });
}

const ROOT = process.cwd();

// ── 读内容 ──────────────────────────────────────────────────────────

/*
 * 语料 = wiki **与 posts**。
 *
 * 2026-09-24 实测的缺口：这里只扫 wiki，于是问「七个 agent 里哪几个主动要
 * markdown」得到「无依据」——而答案明明白白写在 markdown-for-agents.md 里
 * （「七个里三个主动要」）。**报「无依据」比答错更坏**：它让调用方以为
 * 知识库里没有这件事，而实际上有一整页在讲它。
 *
 * 这与迭代 I 修掉的 wiki:impact 缺口**完全同构**：只读 wiki，
 * 于是 articles 层的证据在两个工具里都「不存在」。
 *
 * 解析一律走 `src/lib/wiki/read-page.ts`——原先这里自己抄了一份
 * `parseRefs` / `parseReview` / `parseList`，而 check-impact 与 wiki-impact
 * 各自还有一份。**四份拷贝里任何一份漏改，症状都是「工具之间答案不一致」，
 * 而每个都跑、都绿。**
 */
const WIKI_DIR = join(ROOT, 'src', 'content', 'wiki');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');

function loadCorpus() {
  const pages = [];
  for (const dir of [WIKI_DIR, POSTS_DIR]) {
    let files;
    try {
      files = readdirSync(dir).filter((f) => /\.mdx?$/.test(f)).sort();
    } catch {
      failWithJson(asJson ? 'json' : 'text', EXIT_ENVIRONMENT, `读不到 ${dir}。`, {
        hint: '请在仓库根目录运行。',
      });
    }
    if (files.length === 0) {
      failWithJson(asJson ? 'json' : 'text', EXIT_EMPTY_INPUT, `${dir} 里一个条目都没有。`, {
        hint: '这个命令只能检索一半的内容——空的那一半会给出误导性的结果。',
      });
    }
    for (const file of files) pages.push(readContentPage(dir, file));
  }
  return pages;
}

const docs = loadCorpus();

const bySlug = new Map(docs.map((d) => [d.slug, d]));

// ── 检索 ────────────────────────────────────────────────────────────

/*
 * 计算交给 `src/lib/wiki/context-pack.ts`——那里有 15 条测试覆盖它，
 * 包括路线图 §3 要求的五样（文档 ID、片段、来源版本、状态、关系路径）。
 *
 * **这份逻辑原先整个写在本文件顶层，且顶层就有 `process.exit`**，
 * 所以它无法被 import，也就无法被单测——与迭代 G 之前的 wiki-impact
 * 同一个处境。抽出之后两边共用一份实现：**复制一份到测试里再验一遍
 * 等于验了个副本，而副本会漂。**
 */
const pack = buildContextPack(docs, question, {
  limit: full ? 20 : 6,
  perDoc: 2,
  fullText: full,
});
const { passages: ranked, supported, reason } = {
  passages: pack.passages,
  supported: pack.supported,
  reason: pack.reason,
};

if (asJson) {
  /*
   * ⚠️ **加 `ok` 是为了形状固定。**
   * 消费方要能写「先 `JSON.parse`，再看 `ok`」——
   * 而不必在解析之前先判断「这次是不是成功」
   * （很多运行时会丢掉退出码，stdout 里的 JSON 总是拿得到的）。
   *
   * 而「无依据」是**成功不是失败**（`supported: false`），
   * 所以它的 `ok` 仍是 true——**那是一条结论，不是一次错误**。
   */
  console.log(JSON.stringify(jsonOk(pack), null, 2));
  process.exit(0);
}

// ── 人读的输出 ──────────────────────────────────────────────────────

console.log(`
问题：${question}`);
console.log('─'.repeat(72));

if (!supported) {
  console.log('\n  知识层里没有能支撑这个问题的内容。\n');
  console.log(`  理由：${reason}`);
  if (ranked[0]) {
    console.log(`  最接近的一段是 ${ranked[0].docId} · ${ranked[0].heading || '（正文开头）'}`
      + `（覆盖 ${(ranked[0].coverage * 100).toFixed(0)}%，门槛 ${(MIN_COVERAGE * 100).toFixed(0)}%）`);
  }
  console.log('\n  ⚠️ 这一条是**结论**，不是失败。知识库里没有就该说没有——');
  console.log('     硬凑一段出来，读的人分不清「没有」和「有但记错了」。\n');
  process.exit(0);
}

for (const [i, r] of ranked.entries()) {
  const flags = [];
  if (r.review) flags.push(`复核：${r.review.status}${r.review.checkedAt ? ` ${r.review.checkedAt}` : ''}`);
  if (r.updated) flags.push(`正文更新：${r.updated}`);
  if (r.sources.length > 0) {
    flags.push(`来源：${r.sources.map((x) => `${x.sourceId}@${x.revision}`).join('、')}`);
  }

  console.log(`\n${i + 1}. ${r.title}  ·  ${r.docId}`);
  console.log(`   ${r.heading || '（正文开头）'}`);
  console.log(`   覆盖 ${(r.coverage * 100).toFixed(0)}%  ·  ${r.relation}`
    + (flags.length ? `  ·  ${flags.join('  ·  ')}` : ''));
  console.log(`   命中：${r.matched.slice(0, 8).join(' ')}`);
  for (const line of r.text.split('\n')) console.log(`   │ ${line}`);
}

console.log('\n' + '─'.repeat(72));
console.log('  以上是**材料**，不是结论。每一段的版本与复核状态都在上面，');
console.log('  引用时请连着出处一起引——只引正文会把「已过期」当成「已确认」。\n');
