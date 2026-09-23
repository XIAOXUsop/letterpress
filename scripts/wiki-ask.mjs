#!/usr/bin/env node
/**
 * 把一个自然语言问题，编译成一份**可复用、可核对**的 context pack。
 *
 * ── 它要解决的问题 ──────────────────────────────────────────────────
 *
 * 「把整站塞给模型」有两个代价，第二个更要命：
 *
 *   1. **贵**——6 页还行，60 页就不行了。
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

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { frontmatterField } from '../src/lib/wiki/frontmatter.ts';
import { splitPassages, assess, MIN_COVERAGE } from '../src/lib/wiki/retrieve.ts';
import { readContentPage } from '../src/lib/wiki/read-page.ts';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const full = args.includes('--all');
const question = args.filter((a) => !a.startsWith('--')).join(' ').trim();

if (question === '') {
  console.error('\n给一个问题。例：node scripts/wiki-ask.mjs "为什么行宽用 em 不用 ch"\n');
  process.exit(2);
}

const ROOT = process.cwd();

// ── 读内容 ──────────────────────────────────────────────────────────

function bodyOf(source) {
  const end = source.indexOf('\n---', 3);
  if (end === -1) return '';
  return source.slice(source.indexOf('\n', end + 1) + 1).trim();
}

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
      console.error(`读不到 ${dir}——请在仓库根目录运行。`);
      process.exit(1);
    }
    if (files.length === 0) {
      console.error(`${dir} 里一个条目都没有——这个命令只能检索一半的内容。`);
      process.exit(1);
    }
    for (const file of files) pages.push(readContentPage(dir, file));
  }
  return pages;
}

const docs = loadCorpus();

const bySlug = new Map(docs.map((d) => [d.slug, d]));

// ── 检索 ────────────────────────────────────────────────────────────

const passages = docs.flatMap((d) => splitPassages(d.slug, d.body));
if (passages.length === 0) {
  console.error('切不出任何段落——检索器会永远报「没有依据」，先查 splitPassages。');
  process.exit(1);
}

const { passages: ranked, supported, reason } = assess(passages, question, {
  limit: full ? 20 : 6,
  perDoc: 2,
});

// ── 关系路径 ────────────────────────────────────────────────────────
//
// 「这段和主命中是什么关系」——没有它，模型会以为捞回来的几页
// 是彼此无关的碎片，从而漏掉它们之间的推论。

const primary = ranked[0]?.docId;
function relationTo(slug) {
  if (slug === primary) return '主命中';
  const a = bySlug.get(primary);
  const b = bySlug.get(slug);
  if (a?.related.includes(slug)) return `← ${primary} 声明`;
  if (b?.related.includes(primary)) return `→ 声明了 ${primary}`;
  // 正文互链（`[[…]]`）也算一条真实的关系
  const linkRe = new RegExp(`\\[\\[\\s*${slug}\\s*\\]\\]`, 'i');
  if (a && linkRe.test(a.body)) return `← ${primary} 正文`;
  if (b && new RegExp(`\\[\\[\\s*${primary}\\s*\\]\\]`, 'i').test(b.body)) {
    return `→ 正文引用了 ${primary}`;
  }
  return '无直接关系';
}

function snippet(text) {
  if (full) return text;
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  return lines.slice(0, 6).join('\n');
}

if (asJson) {
  console.log(JSON.stringify({
    question,
    supported,
    reason,
    minCoverage: MIN_COVERAGE,
    passages: ranked.map((r) => {
      const doc = bySlug.get(r.docId);
      return {
        id: r.id,
        docId: r.docId,
        title: doc?.title ?? r.docId,
        heading: r.heading,
        score: Number(r.score.toFixed(4)),
        coverage: Number(r.coverage.toFixed(4)),
        matched: r.matched,
        relation: relationTo(r.docId),
        updated: doc?.updated ?? '',
        review: doc?.review ?? null,
        sources: doc?.sources ?? [],
        text: snippet(r.text),
      };
    }),
  }, null, 2));
  process.exit(0);
}

// ── 人读的输出 ──────────────────────────────────────────────────────

console.log(`\n问题：${question}`);
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
  const doc = bySlug.get(r.docId);
  const flags = [];
  if (doc?.review) flags.push(`复核：${doc.review.status}${doc.review.checkedAt ? ` ${doc.review.checkedAt}` : ''}`);
  if (doc?.updated) flags.push(`正文更新：${doc.updated}`);
  if (doc?.sources?.length) {
    flags.push(`来源：${doc.sources.map((s) => `${s.sourceId}@${s.revision}`).join('、')}`);
  }

  console.log(`\n${i + 1}. ${doc?.title ?? r.docId}  ·  ${r.docId}`);
  console.log(`   ${r.heading || '（正文开头）'}`);
  console.log(`   覆盖 ${(r.coverage * 100).toFixed(0)}%  ·  ${relationTo(r.docId)}`
    + (flags.length ? `  ·  ${flags.join('  ·  ')}` : ''));
  console.log(`   命中：${r.matched.slice(0, 8).join(' ')}`);
  for (const line of snippet(r.text).split('\n')) console.log(`   │ ${line}`);
}

console.log('\n' + '─'.repeat(72));
console.log('  以上是**材料**，不是结论。每一段的版本与复核状态都在上面，');
console.log('  引用时请连着出处一起引——只引正文会把「已过期」当成「已确认」。\n');
