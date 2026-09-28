#!/usr/bin/env node
/**
 * **读路径与构建路径必须对「post 拿不到什么」保持同一口径。**
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 本仓库有**两条**从内容到 `Doc` 的路：
 *
 * | 路径 | 入口 | 运行环境 |
 * |---|---|---|
 * | 构建期 | `src/lib/content.ts` 的 `toDoc`（拿 `astro:content` 的 `CollectionEntry`） | Astro / bundler |
 * | 读源码 | `readContentDirs` + `pageToDoc`（读 `.md` 文件） | **裸 Node**（`scripts/*.mjs`） |
 *
 * 它们**必须给出同一个 `Doc`**，否则：
 * - 同一页在**构建产物**与 **CLI 回答**里关系不同；
 * - `wiki:ask` 的 `docId` 是订阅者做增量同步的键，而那两条出口都发它。
 *
 * ── 实测出的缺口（2026-09-28）────────────────────────────────────────
 *
 * `content.ts` 里有 **4 处** `kind === 'wiki' ? … : …`：
 * `related` / `review` / `original` / `wikiKind`。
 * 而 `pageToDoc` 起初**一处都没对齐**——post 照样有关系、照样有 `wikiKind`。
 *
 * 为什么一直没发作：**本站 posts 里 0 篇写这些字段**
 * （实测 `src/content/posts/*.md` 无 `^related:`、无 `kind:`）。
 * 而「新站点会在文章里写关系」是很正常的一件事。
 *
 * > **「本站没有这种数据」与「这条路径正确」是两件事。**
 * > 前者让后者从未被测过，而两者在输出里长得一样。
 *
 * ── 判据 ────────────────────────────────────────────────────────────
 *
 * 两条：
 * ① **数**构建侧 `kind === 'wiki' ?` 的处数 —— 它是基准；
 * ② **真跑** `pageToDoc` 的两种 `docKind`，逐项断言哪些字段出现。
 *
 * ⚠️ **不靠 grep `page-to-doc.ts` 里有没有同样的字符串**：
 * 两边的写法可以完全不同（一处是三元、一处是条件展开），
 * 而**行为一致才是契约**。所以第 ② 条走运行时。
 *
 * 用法：`node scripts/check-two-paths.mjs`
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pageToDoc } from '../src/lib/wiki/page-to-doc.ts';
import { readContentDirs, readContentPage } from '../src/lib/wiki/read-page.ts';
import { buildGraph } from '../src/lib/wiki/graph.ts';

const ROOT = process.cwd();
const problems = [];

console.log('读路径与构建路径的 post 口径');
console.log('─'.repeat(64));

// ── ① 构建侧有几处「post 拿不到」判定 ──────────────────────────────
/*
 * 这几个是**知识层专属**的：构建侧对 `post` 一律给 `undefined`。
 * 加一个进来，就必须同时更新构建侧与本门禁的名单——
 * **这正是它存在的意义：两份名单不可能悄悄漂开**。
 *
 * ⚠️ 它必须定义在**使用之前**：第一版定义在使用之后，
 * 于是 `gates !== WIKI_ONLY.length` 那句在运行时是 TDZ 报错。
 * （`const` 不会「取到旧值」，只会抛——所以症状是崩，不是假绿。）
 */
const WIKI_ONLY = ['wikiKind', 'review', 'declaredRelations', 'original'];

const contentTs = readFileSync(join(ROOT, 'src', 'lib', 'content.ts'), 'utf8');
const gates = [...contentTs.matchAll(/kind === 'wiki' \?/g)].length;

/**
 * ⚠️ **判据必须是「精确相等」，不是「大于 0」。**
 *
 * 第一版只判 `gates === 0`，于是把构建侧 `related` 那处判定删掉
 * （4 → 3）时它照样报「✓ 构建侧有 3 处判定」——
 * **基准掉了一格，而它把这当成正常。**
 *
 * > 「基准还在」与「基准没变过」是两件事。
 * > 而这条门禁的全部价值就在后者：它存在的理由是**两边不能各改一处**。
 */
if (gates === 0) {
  problems.push(
    "src/lib/content.ts 里一处 `kind === 'wiki' ?` 都没有——"
    + '要么实现变了，要么路径不对。**基准消失了，判据就恒真。**',
  );
  console.log('  ✗ 构建侧找不到 `kind === \'wiki\' ?` 判定');
} else if (gates !== WIKI_ONLY.length) {
  problems.push(
    `构建侧有 ${gates} 处 \`kind === 'wiki' ?\`，而本门禁的名单是 ${WIKI_ONLY.length} 项`
    + `（${WIKI_ONLY.join(' / ')}）。\n`
    + '    **两边必须一一对应**——构建侧多一处或少一处，说明有人改了它而没改这里，'
    + '或者改了两边但只改了一边。',
  );
  console.log(`  ✗ 构建侧 ${gates} 处 vs 名单 ${WIKI_ONLY.length} 项——对不上`);
} else {
  console.log(`  ✓ 构建侧 ${gates} 处判定与名单 ${WIKI_ONLY.length} 项一一对应`);
}

// ── ② 运行时：post 拿不到哪些字段 ───────────────────────────────────
// （`WIKI_ONLY` 已定义在上面——它必须与构建侧的处数一一对应）
const page = {
  slug: 'a',
  title: '甲',
  kind: 'synthesis',
  body: '正文。',
  sources: [{ sourceId: 's1', revision: 'v1', locator: '§1' }],
  related: ['b'],
  review: { status: 'reviewed', checkedAt: '2026-01-01', contentDigest: 'd' },
  original: { reason: '本站自己的实践，外部无对应来源' },
};

const wikiDoc = pageToDoc(page, { docKind: 'wiki' });
const postDoc = pageToDoc(page, { docKind: 'post' });

for (const field of WIKI_ONLY) {
  const inWiki = field === 'declaredRelations'
    ? (wikiDoc.declaredRelations ?? []).length > 0
    : Object.prototype.hasOwnProperty.call(wikiDoc, field);
  const inPost = field === 'declaredRelations'
    ? (postDoc.declaredRelations ?? []).length > 0
    : Object.prototype.hasOwnProperty.call(postDoc, field);

  if (!inWiki) {
    problems.push(`wiki 侧没有 \`${field}\`——固件或实现变了，本门禁的名单要更新`);
    console.log(`  ✗ ${field}：wiki 侧就没有，判据已失效`);
  } else if (inPost) {
    problems.push(
      `post 侧仍然带着 \`${field}\`，而构建侧对它给的是 \`undefined\`。\n`
      + `    → 同一页在构建产物与 CLI 回答里形状不同。\n`
      + `    改 page-to-doc.ts，让它与 content.ts 的 \`kind === 'wiki' ?\` 同一口径。`,
    );
    console.log(`  ✗ ${field}：post 侧仍带着（应与构建侧一致地缺席）`);
  } else {
    console.log(`  ✓ ${field}：post 侧缺席，与构建侧一致`);
  }
}

/*
 * ⚠️ **反向：post 侧也不能少字段。**
 * 只查「该没有的没有」的话，一次「post 只剩 3 个键」也能过——
 * 而那会让 `slug` / `body` 全丢，**比多一个键坏得多**。
 */
const wikiKeys = Object.keys(wikiDoc);
const postKeys = Object.keys(postDoc);
const missingOnPost = wikiKeys.filter((k) => !WIKI_ONLY.includes(k) && !postKeys.includes(k));
if (missingOnPost.length > 0) {
  problems.push(`post 侧少了本该有的字段：${missingOnPost.join('、')}——只该少那 ${WIKI_ONLY.length} 个知识层专属字段`);
  console.log(`  ✗ post 侧少了：${missingOnPost.join('、')}`);
} else {
  console.log(`  ✓ post 侧只少那 ${WIKI_ONLY.length} 个，其余 ${postKeys.length} 个键都在`);
}

/*
 * ⚠️ **第三态：wiki 侧必须真的有关系。**
 * 若 `pageToDoc` 因为某次重构不再给 `declaredRelations`，
 * 上面那条会判「wiki 侧没有 → 判据失效」而红——
 * 但那是**信号不是死循环**，所以额外确认它确实是「有值」而非「键在但空」。
 */
if ((wikiDoc.declaredRelations ?? []).length === 0) {
  problems.push("wiki 侧的 declaredRelations 是空的——本门禁已经量不到东西了");
}

/*
 * ── ③ 核心**不许猜** docKind ──────────────────────────────────────
 *
 * ⚠️ **2026-09-28 加。** 一个很自然的想法是「让核心自己判断」：
 * 本站 wiki 全写 `kind:` 而 posts 全不写（实测 6/6 vs 0/5），
 * 看起来足够判别。
 *
 * **但那是本站的 schema 巧合，不是通则**：
 * ① `knowledge/fixtures/second-site/` 那 9 篇**也都写 `kind:`**——
 *    而它们所在的目录既不是 posts 也不是 wiki；
 * ② 一个新站点若两个目录都写 `kind:`，核心就分不出来；
 * ③ 而**判错的后果是静默的**：`post` 被当成 `wiki` 时，
 *    关系照样连进图、构建产物却没有——分歧回到今天这个问题的起点。
 *
 * 所以 `docKind` 必须**由调用方给**，核心不猜。
 */
const guessed = pageToDoc(page, {});          // 不给 docKind
const explicitlyWiki = pageToDoc(page, { docKind: 'wiki' });
if (guessed.kind !== 'wiki' || explicitlyWiki.kind !== 'wiki') {
  problems.push('不传 docKind 时应当默认 wiki——那不是「猜」，是显式的缺省');
} else {
  const guessedKeys = Object.keys(guessed).sort();
  const explicitKeys = Object.keys(explicitlyWiki).sort();
  if (guessedKeys.join() !== explicitKeys.join()) {
    problems.push(
      '不传 docKind 与显式传 wiki 的键集合不同——那说明默认值不再是 wiki，'
      + '而调用方没传时就在走另一条路',
    );
    console.log('  ✗ 不传 docKind 与显式传 wiki 的键集合不同');
  } else {
    console.log('  ✓ 不传 docKind 等价于显式 wiki（缺省是显式的，不是猜出来的）');
  }
}

/*
 * ── ④ 读路径必须**真的读到** `draft`，且草稿不进图 ───────────────────
 *
 * ⚠️ **2026-09-28 实测的第 6 处分歧。** `readContentPage` 原先**不读 `draft`**，
 * 于是 `pageToDoc` 恒给 `false`、`buildGraph` 的 `filter((d) => !d.draft)`
 * 形同虚设——**草稿会进 CLI 的检索与影响分析，而构建产物里没有它。**
 *
 * 为什么没被发现：**`verify:formats` 的草稿隔离探针只验构建产物**
 * （页面 / 孪生 / OG / manifest 里没有它），**读路径无人问**；
 * 而**本站 0 篇草稿**，所以连"有草稿时会怎样"都没人试过。
 *
 * > 与前五处「post 口径」不同：**这一处只要有一篇草稿就会发作。**
 * > 「本站没有这种数据」在这里**不是理由，是缺口本身**。
 *
 * 所以这里用**真文件**跑一遍——合成对象量不到「解析」这一层。
 */
{
  const dir = mkdtempSync(join(tmpdir(), 'two-paths-draft-'));
  try {
    writeFileSync(
      join(dir, 'draft-page.md'),
      '---\ntitle: 草稿页\nsummary: 未完成。\ndraft: true\n---\n\n没写完。\n',
      'utf8',
    );
    writeFileSync(join(dir, 'live-page.md'), '---\ntitle: 正式页\nsummary: 写完了。\n---\n\n正文。\n', 'utf8');

    const { pages } = readContentDirs([dir]);
    const docs = pages.map((p) => pageToDoc(p));
    const inGraph = [...buildGraph(docs).bySlug.keys()];

    if (pages.length !== 2) {
      problems.push(`临时语料只读到 ${pages.length} 页（期望 2）——判据没量到东西`);
      console.log('  ✗ 临时语料读到的页数不对');
    } else if (!inGraph.includes('live-page') || inGraph.includes('draft-page')) {
      problems.push(
        `草稿没有从链接图里被滤掉（图里有：${inGraph.join('、') || '空'}）。\n`
        + '    读路径读不到 `draft` 时，`buildGraph` 的过滤形同虚设，'
        + '**草稿会进 CLI 的检索与影响分析，而构建产物里没有它**。',
      );
      console.log(`  ✗ 草稿没被滤掉（图里有：${inGraph.join('、') || '空'}）`);
    } else {
      console.log('  ✓ 读路径读到 draft，草稿不进链接图（与构建产物同口径）');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/*
 * ── ⑤ 单读与多读对**同一页**必须逐字段一致 ───────────────────────
 *
 * ⚠️ **2026-09-28 加。** 那之前 `readContentDirs` 把 `summary` / `original` /
 * `slug` / `date` / `tags` **全部重算了一遍**——**同一个字段两个真值**，
 * 改一处，另一处悄悄不同。`check:field-coverage` 抓到它的后果时，
 * 差异恰好是「两个方向各缺一半」，而**没有任何门禁比对过这两条路**。
 *
 * 现在 `readContentPage` 读全了、`readContentDirs` 只做它做不到的事。
 * 那条「只做做不到的事」很容易在下次重构时又长回来——
 * **所以把「两条路逐字段相同」变成门禁。**
 *
 * ⚠️ 比的是**本站真实内容**，不是临时造的固件：
 * 固件只能证明「这个形状一致」，而真实内容里那些**没写的字段**才是分歧高发处
 * （`undefined` vs `''` vs 键不存在，三种都「看起来对」）。
 */
{
  const dirs = [join(ROOT, 'src', 'content', 'wiki'), join(ROOT, 'src', 'content', 'posts')];
  let compared = 0;
  const diffs = [];
  for (const dir of dirs) {
    let files;
    try {
      files = readdirSync(dir).filter((f) => /\.mdx?$/.test(f));
    } catch {
      continue; // 目录不存在（不是本站布局）——跳过而不是当成 0 页
    }
    const { pages } = readContentDirs([dir]);
    const bySlug = new Map(pages.map((p) => [p.slug, p]));
    for (const file of files) {
      const single = readContentPage(dir, file);
      const multi = bySlug.get(single.slug);
      if (!multi) {
        diffs.push(`${single.slug}：多读那条里找不到它`);
        continue;
      }
      compared++;
      for (const k of Object.keys(single)) {
        const a = JSON.stringify(single[k]);
        const b = JSON.stringify(multi[k]);
        if (a !== b) diffs.push(`${single.slug}.${k}：单读 ${a} vs 多读 ${b}`);
      }
    }
  }
  if (compared === 0) {
    problems.push('一条内容都没比到——「单读 vs 多读」这条判据此刻量不到任何东西');
    console.log('  ✗ 没有可比的内容');
  } else if (diffs.length > 0) {
    problems.push(
      `单读与多读对同一页给出不同结果（${diffs.length} 处）：\n`
      + diffs.slice(0, 8).map((d) => `      ${d}`).join('\n'),
    );
    console.log(`  ✗ 单读 vs 多读：${diffs.length} 处不一致`);
  } else {
    console.log(`  ✓ 单读与多读对 ${compared} 页逐字段一致`);
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处对不上。\n`);
  process.exit(1);
}
console.log(`\n读路径与构建路径对「post 拿不到什么」是同一口径（${WIKI_ONLY.length} 项），`
  + '且读路径真的读得到 draft。\n');