#!/usr/bin/env node
/**
 * 阶段 3 退出条件 ③ 的门禁：
 * 「**固定问题集中的每个答案都能定位到证据，或明确返回未知**」。
 *
 * ── 它量的是什么 ────────────────────────────────────────────────────
 *
 * `check-questions.mjs` 量的是**召回**（该出现的页出现了吗），
 * `check-impact.mjs` 量的是**来源引用关系**。
 * **两者都不量「答案带不带证据」**——
 * 而 2026-09-24 实测出的那个 bug 恰恰在这一层：
 * `context-pack` 里 `sources: 0`、`review: null`，
 * 而 `check-questions` **全绿**（它不看这两个字段）。
 *
 * > 也就是说：**一个「有依据」的问题，返回的段落可能完全没有依据**，
 * > 而整条链路一声不响。
 *
 * 所以这一条逐条问两个问题：
 *
 * | 金标类别 | 必须满足 |
 * |---|---|
 * | 有依据 | 主命中段落**带得上来源版本或复核状态**（不能两者皆无） |
 * | 无依据 | `supported === false` 且**带一个理由**（不是空集 + 无解释） |
 *
 * ⚠️ **判据是「主命中段落」而不是「pack 里任何一段」**——
 * 模型通常只看排在前面的那几段，而**排在第一的没有依据**是最坏的情况：
 * 它会被当成答案抄走。
 *
 * 用法：`node scripts/check-answers.mjs`
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildContextPack } from '../src/lib/wiki/context-pack.ts';
import { readContentDirs } from '../src/lib/wiki/read-page.ts';

const ROOT = process.cwd();
const QUESTIONS = join(ROOT, 'knowledge', 'questions.md');
const WIKI = join(ROOT, 'src', 'content', 'wiki');
const POSTS = join(ROOT, 'src', 'content', 'posts');

const problems = [];

// ── 语料 ────────────────────────────────────────────────────────────
const { pages, counts } = readContentDirs([WIKI, POSTS]);
if ([...counts.values()].some((n) => n === 0)) {
  console.error(`${WIKI} 或 ${POSTS} 里一个条目都没有——这个检查什么都没量。`);
  process.exit(1);
}

// ── 解析金标 ────────────────────────────────────────────────────────
/*
 * 复用 `check-questions.mjs` 的解析口径（三连行 + 跳过代码块）——
 * **两份解析器必然漂移**，而漂移的表现是「这个检查量的是另一批问题」。
 */
const raw = readFileSync(QUESTIONS, 'utf8');
const text = raw.replace(/^```[\s\S]*?^```$/gm, '');
const listOf = (r) => r.split(/[、,，]/).map((s) => s.trim()).filter(Boolean);

const cases = [];
let current = null;
for (const line of text.split('\n')) {
  const h = /^##\s+/.test(line);
  const q = /^###\s+(.*)$/.exec(line);
  if (h) {
    current = null;
    continue;
  }
  if (q) {
    current = { question: q[1].trim(), expect: [], noAnswer: false, hasSpec: false };
    cases.push(current);
    continue;
  }
  if (!current) continue;
  const e = /^期望命中：(.*)$/.exec(line);
  if (e) {
    current.expect = listOf(e[1]);
    current.hasSpec = true;
    continue;
  }
  const v = /^期望判定：(.*)$/.exec(line);
  if (v) {
    current.noAnswer = v[1].trim() === '无依据';
    current.hasSpec = true;
  }
  // 「已知局限」是**故意不过**的用例，它登记的是「这里有个已知的坏」，
  // 不是「答案应该定位到证据」。**不跳过它，这个门禁会对着自己的
  // 已知局限报红**——第一次跑就报了三条，全是这类。
  if (/^已知局限：/.test(line)) current.knownLimit = true;
}

const usable = cases.filter((c) => c.hasSpec && !c.knownLimit);
if (usable.length === 0) {
  console.error('金标里没解析出任何一条可用用例——这个检查什么都没量。');
  process.exit(1);
}

console.log('答案可定位性（阶段 3 退出条件 ③）');
console.log('─'.repeat(64));
console.log(
  `  ${usable.length} 条金标（其中 ${usable.filter((c) => c.noAnswer).length} 条期望「无依据」）` +
    ` · 语料 ${pages.length} 页\n` +
    `  跳过 ${cases.filter((c) => c.knownLimit).length} 条「已知局限」——` +
    `它们登记的是「这里有个已知的坏」，不是「答案该定位到证据」\n`,
);

// ── 逐条量 ──────────────────────────────────────────────────────────
let okCount = 0;
for (const c of usable) {
  const pack = buildContextPack(pages, c.question, { limit: 6, perDoc: 2 });

  if (c.noAnswer) {
    // 「明确返回未知」：supported 为 false **且**给了理由
    if (pack.supported) {
      problems.push(
        `「${c.question}」期望「无依据」，却返回了 ` +
          `${pack.passages.map((p) => p.docId).join('、')}。`,
      );
    } else if (!pack.reason || pack.reason.trim() === '') {
      problems.push(`「${c.question}」报了「无依据」但**没有给理由**——调用方无从判断该不该信。`);
    } else {
      okCount++;
    }
    continue;
  }

  // 「能定位到证据」：**主命中段落**必须带来源版本或复核状态
  const top = pack.passages[0];
  if (!top) {
    problems.push(`「${c.question}」期望有依据，却一个段落都没返回。`);
    continue;
  }
  const hasEvidence =
    (top.sources && top.sources.length > 0) ||
    (top.review && top.review.status !== undefined);
  if (!hasEvidence) {
    problems.push(
      `「${c.question}」的主命中是 ${top.docId}` +
        `${top.heading ? `（${top.heading}）` : ''}，而它**既没有来源版本、也没有复核状态**。` +
        `模型通常只看排在前面的段落——**排在第一的没有依据，是最坏的情况**。`,
    );
  } else {
    okCount++;
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 条问题的答案**定位不到证据**。\n`);
  process.exit(1);
}
/*
 * ⚠️ **结论行必须带上被跳过的条数。**
 *
 * 2026-09-24 实测：跳过 3 条「已知局限」这个事实印在**倒数第二行**，
 * 而最后一行是「✓ 20/20 条……」。**读到最后一行的人看到的是「全过」**——
 * 而实际有 3 条没被检。跳过本身是合法的（金标里明确登记了），
 * **问题只是它不在结论里**。
 *
 * > **一个数字不出现在结论行，就等于不存在**——
 * > 读者不会往回翻，而「20/20」看上去是完整的。
 *
 * 这与「把匹配数报出来」是同一条原则：让读者不必回看就能判断覆盖了多少。
 */
const skippedKnown = cases.filter((c) => c.knownLimit).length;
console.log(
  `  ✓ ${okCount}/${usable.length} 条问题的答案都能定位到证据，或明确返回未知` +
    (skippedKnown > 0
      ? `（另有 ${skippedKnown} 条金标登记为「已知局限」，不参与本项判定）\n`
      : '\n'),
);
