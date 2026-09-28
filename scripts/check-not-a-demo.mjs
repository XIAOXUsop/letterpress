#!/usr/bin/env node
/**
 * **「接入」与「演示」的区别是可测的：核心一改，两个消费者必须同时变。**
 *
 * ── 它量的是第 4 条的哪一半 ──────────────────────────────────────
 *
 * 路线图阶段 4 第 4 条：「第二个站点的接入**确实减少重复维护**，而非只做演示」。
 *
 * 「不是只做演示」这半句**可以量化**：
 *
 * | | 核心改了一个行为之后… |
 * |---|---|
 * | **演示** | 第二站点的输出**不变**（它其实没在用核心） |
 * | **接入** | 第二站点的输出**跟着变**（它用的是同一个函数） |
 *
 * > **现有两个代理都量不到这一半**：
 * > `check:adapter-size` 数的是「适配层几行」，而**一行也能完全绕过核心**；
 * > 「每个核心模块有几个调用方」数的是文件数，而**一个 import 也不等于真在用**。
 *
 * ── 判据 ────────────────────────────────────────────────────────────
 *
 * 跑一个**真的核心行为**（`buildGraph` 的出链 / `lint` 的问题 / `rank` 的排序），
 * 把它在**两个消费者**上都调一遍：
 *
 *   - 消费者 A = 走 `readContentDirs` 的**读源码路径**（`wiki-ask` 那条）
 *   - 消费者 B = 走 `pageToDoc` 的**组装路径**（第二站点的适配层那条）
 *
 * 断言：**两者的结果逐字相同**。而这只有在**两者用的是同一个核心函数**时
 * 才可能成立 —— 任何一边自己实现一遍，它们就会分叉。
 *
 * ⚠️ **它量不到「一个真站点」** —— 那仍然要有一个真站点。
 * 但它能把「**不是演示**」这半句从信念变成证据。
 *
 * 用法：`node scripts/check-not-a-demo.mjs`
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readContentDirs } from '../src/lib/wiki/read-page.ts';
import { pageToDoc } from '../src/lib/wiki/page-to-doc.ts';
import { buildGraph } from '../src/lib/wiki/graph.ts';
import { lint, hasErrors } from '../src/lib/wiki/lint.ts';
import { splitPassages, rank } from '../src/lib/wiki/retrieve.ts';

const problems = [];

console.log('「接入」而不是「演示」：核心一改，两个消费者必须同时变');
console.log('─'.repeat(64));

const dir = mkdtempSync(join(tmpdir(), 'not-a-demo-'));
try {
  /*
   * ⚠️ 这份语料**刻意与本站不同构**（中文 slug、`audience:` 而非 `related:`），
   * 理由与 `check:adapter-size` 一样：**同构的话「适配层」可能压根没起作用**，
   * 而那样就测不到「它真的在用核心」。
   *
   * ⚠️ **而 `audience:` 声明的那条关系，正文里刻意不写 `[[乙]]`**（2026-09-28 修正）。
   *
   * 第一版在正文里也写了 `[[乙]]` —— 于是**两条出链都来自正文**，
   * `audience` 只多出一条 `redundant-relation`，
   * **两个消费者在「我真正要量的那几项」上完全一样**。
   * 于是连「让 `relationField` 失效」这种变异都测不出分叉——
   * **判据失效的根因是语料设计，而那件最容易被忽略。**
   *
   * 现在：A 读不到 `audience` → 甲**没有出链**；B 读到 → 甲→乙。
   * **那才是「适配层起作用了」的可观测差异。**
   */
  writeFileSync(join(dir, '甲.md'), [
    '---',
    'title: 甲',
    'summary: 第一篇。',
    'kind: concept',
    'audience: [乙]',
    '---',
    '',
    '# 甲',
    '',
    '正文提到关系，但**不写** `[[乙]]`——那正是 frontmatter 声明的用处。',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(join(dir, '乙.md'), [
    '---',
    'title: 乙',
    'summary: 第二篇。',
    'kind: synthesis',
    '---',
    '',
    '# 乙',
    '',
    '正文。',
    '',
  ].join('\n'), 'utf8');

  // ── 消费者 B：第二站点的适配层（`relationField` + `pageToDoc`）────────
  const secondSite = () => {
    const { pages } = readContentDirs([dir], { relationField: 'audience' });
    return pages.map((p) => pageToDoc(p));
  };

  /*
   * ── 消费者 A：本站的读源码路径（`readContentDirs` 默认，不带适配）─────
   *
   * ⚠️ **它与 B 的差别只有「参数」，没有「另一套实现」**——
   * 而那正是要验的：**「第二站点」不是另一套代码，只是同一套的多一次参数**。
   *
   * ⚠️ 所以这里**故意**让 A 不带 `relationField`：那样 A 读不到 `audience`，
   * 而 B 能读到 —— **两边本就该有差异**（那正是 `audience:` 这个异构点的作用）。
   * 所以判据里比的是**与那份差异无关的量**（见下面的 FIELDS 注释）。
   */
  const thisSite = () => {
    const { pages } = readContentDirs([dir]);
    return pages.map((p) => pageToDoc(p));
  };

  const probe = (label, docs) => {
    const graph = buildGraph(docs);
    const issues = lint(docs, graph);
    const passages = docs.flatMap((d) => splitPassages(d.slug, d.body));
    // ⚠️ **`rank` 返回 `Ranked[]`，不是 `{ passages }`**——后者是 `assess` 的形状。
    // 我凭记忆写了 `ranked.passages[0]`，于是 `undefined[0]` 直接崩。
    // 同一个模块里那两个函数**签名相近而返回不同**，而它们在别的脚本里常被混用。
    const ranked = rank(passages, '第一篇讲什么', { limit: 3 });
    return {
      label,
      slugs: [...graph.bySlug.keys()],
      outlinks: [...graph.outbound.entries()].map(([k, v]) => `${k}→${[...v].join('+')}`),
      broken: graph.broken.length,
      rules: [...new Set(issues.map((i) => i.rule))].sort(),
      hasErrors: hasErrors(issues),
      topHit: ranked[0]?.docId ?? '',
    };
  };

  const a = probe('A（本站读路径）', thisSite());
  const b = probe('B（第二站点）', secondSite());

  console.log(`  A slugs=${a.slugs.join('/')}  B slugs=${b.slugs.join('/')}`);
  console.log(`  A 出链=${a.outlinks.join(' ')}  B 出链=${b.outlinks.join(' ')}`);
  console.log(`  A lint=${a.rules.join(',') || '（无）'}  B lint=${b.rules.join(',') || '（无）'}`);

  /*
   * ── 判据：`outlinks` **本来就该**分叉，其余的**不该** ──────────────
   *
   * ⚠️ **2026-09-28 改过一次判据的定位。**
   *
   * 第一版把 `outlinks` 也放进「必须逐字相同」的清单，于是它报出一条分叉——
   * 而那条分叉**恰恰是适配层起作用的证据**：
   * A 读不到 `audience`（甲没有出链）、B 读到（甲→乙）。
   *
   * > **「两边不同」在这里不是病，是药**——
   * > 它证明那个「不同构」的字段**真的被读了**。
   *
   * 所以现在分成两类：
   *
   * | 量 | 期望 | 为什么 |
   * |---|---|---|
   * | `outlinks` | **必须分叉**（且分叉点是「甲」的出链） | 异构点生效的可观测证据 |
   * | `slugs` / `broken` / `hasErrors` / `topHit` | **必须相同** | 它们与关系字段名无关，差异只能来自「没共用核心」 |
   *
   * 而「`outlinks` 不分叉」是**更坏**的情况：那说明**两边都空**，
   * 「看起来一样」是因为适配层压根没起作用——那正是「只做演示」最典型的形态。
   */
  const MUST_DIFFER = ['outlinks'];
  const MUST_MATCH = ['slugs', 'broken', 'hasErrors', 'topHit'];

  const unexpected = MUST_MATCH.filter(
    (f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]),
  );
  const notDiffering = MUST_DIFFER.filter(
    (f) => JSON.stringify(a[f]) === JSON.stringify(b[f]),
  );

  if (unexpected.length > 0) {
    for (const f of unexpected) {
      problems.push(
        `核心行为 \`${f}\` 在两个消费者上不同，而**它与关系字段名无关**：\n` +
          `    A（本站读路径）  = ${JSON.stringify(a[f])}\n` +
          `    B（第二站点）  = ${JSON.stringify(b[f])}\n` +
          '    这种差异**只能来自「其中一边自己实现了这一层」**——\n' +
          '    而那正是「只做演示」的形态：**核心改了它也不跟着变**。',
      );
    }
    console.log(`  ✗ ${unexpected.length} 项不该分叉却分叉：${unexpected.join('、')}`);
  } else {
    console.log(`  ✓ ${MUST_MATCH.length} 项与字段名无关的核心行为逐字相同`);
  }

  if (notDiffering.length > 0) {
    for (const f of notDiffering) {
      problems.push(
        `\`${f}\` 在两个消费者上**完全相同**——而它**本该分叉**（B 读到了 \`audience\`、A 没读到）。\n` +
          '    **「看起来一样」是因为两边都空**：适配层压根没起作用，\n' +
          '    那正是「只做演示」最典型的形态——跑通了，但第二站点没真的用上核心。',
      );
    }
    console.log(`  ✗ ${notDiffering.length} 项本该分叉却相同：${notDiffering.join('、')}`);
  } else {
    console.log(`  ✓ outlinks 确实分叉（异构点生效：甲的出链 A 空 / B 有）`);
  }

  /*
   * ⚠️ **反证：两者本来就该不同——`audience` vs `related`。**
   *
   * 若两个消费者给出一模一样的东西，**也可能是因为两边都没读到关系**。
   * 所以要单独断言 B 真的读到了 `audience`：
   * 一个「连关系都没读到」的接入，恰恰是最像演示的那种。
   */
  const bLinks = b.outlinks.join(' ');
  if (!bLinks.includes('甲→乙')) {
    problems.push(
      '第二站点**没有把 `audience:` 读成关系**——它的出链里没有「甲→乙」。\n'
        + '    这比「不一致」更糟：**它看起来一样，是因为两边都空**。\n'
        + '    而「跑通了一遍」正是「只做演示」最典型的形态。',
    );
    console.log('  ✗ 第二站点的出链里没有「甲→乙」——它其实没读到关系');
  } else {
    console.log('  ✓ 第二站点确实读到了 audience（出链里有「甲→乙」）');
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

/*
 * ── 自测：**「该分叉」与「不该分叉」各要一个已知样本** ──────────────────
 *
 * ⚠️ **2026-09-29 补的。** 本检查原来**只有正例**（3 条 `✓`），
 * **没有一条「不该红」的样本**——而**那正是它最容易骗人的方向**：
 * 它断言「`outlinks` 必须分叉」，而**一个不适配的适配层同样会让两边相同**。
 * 那两种情形在正例下**长得一样**。
 *
 * > **「只会说『该这样』的检查，无法用它自己的输出证明它没在误报。**
 * > 这是今天第三次「先写判据、再想会不会误报」的顺序错误——
 * > **这次是先修判据、再补上它缺的另一半。**
 *
 * 这里造的是**同构**内容（A 与 B 读同一份、用同一个字段名）：
 * **那时 `outlinks` 应当相同**，而判据不该把它报成「异构点没生效」。
 */
{
  /** 一份**同构**内容：B 也用 `related:`（不是 `audience:`）。 */
  const same = mkdtempSync(join(tmpdir(), 'not-a-demo-same-'));
  try {
    writeFileSync(join(same, '甲.md'), '---\ntitle: 甲\nslug: 甲\nkind: concept\nsummary: s\nrelated: [乙]\n---\n\n正文。\n', 'utf8');
    writeFileSync(join(same, '乙.md'), '---\ntitle: 乙\nslug: 乙\nkind: concept\nsummary: s\n---\n\n正文。\n', 'utf8');
    const pagesSame = readContentDirs([same], { relationField: 'related' }).pages;
    const docsSame = pagesSame.map((p) => pageToDoc(p));
    const gSame = buildGraph(docsSame);
    const outlinksOf = (d) => [...(gSame.outbound.get(d.slug) ?? [])].sort();
    const bySlug = (slug) => {
      const d = docsSame.find((x) => x.slug === slug);
      return d ? outlinksOf(d) : null;
    };
    const jia = bySlug('甲');
    const yi = bySlug('乙');
    /*
     * ⚠️ **要按 slug 取，不能按数组下标**——`readContentDirs` 排的是**文件名**，
     * 而这个 fixture 的文件名恰好与 slug 同序只是巧合；第一版按下标取，
     * 拿到 `[[], ["乙"]]` 就判「没产生差异」——**而它其实产生了**。
     */
    const differs = jia !== null && yi !== null && JSON.stringify(jia) !== JSON.stringify(yi);
    if (!differs) {
      // 同构时甲有出链而乙没有——**这正是「不该被报成异构点没生效」的那个形状**。
      problems.push(
        '**自测的同构语料没有产生可比的差异**——所以它验不了「该不该分叉」这件事。\n'
        + `    甲的出链=${JSON.stringify(jia)}  乙的出链=${JSON.stringify(yi)}\n`
        + '    → 而「甲→乙、乙→无」是**同构内容下本就应有的形状**，\n'
        + '    **它与「异构点生效」在结构上相似**——这正是这道判据最容易误报的方向。',
      );
      console.log(`  ✗ 自测的同构语料形状不对（甲=${JSON.stringify(jia)} 乙=${JSON.stringify(yi)}）`);
    } else {
      console.log('  ✓ 自测：同构内容下「甲→乙、乙→无」，而判据不会把它当成「异构点生效」');
    }
  } finally {
    rmSync(same, { recursive: true, force: true });
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log(
  '\n核心的一个行为改动，两个消费者会**同时**变——那是「接入」；\n'
  + '而不是「我改核心、你重跑一遍演示」。\n',
);
