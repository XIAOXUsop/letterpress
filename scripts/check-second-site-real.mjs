#!/usr/bin/env node
/**
 * 第二份**真实**内容集：读 `knowledge/fixtures/second-site/` 里的文件，
 * 跑一遍核心流程。
 *
 * ── 它与 `check-second-site.mjs` 差在哪 ─────────────────────────────
 *
 * 那个探针用**硬编码的合成 docs 数组**。它测的是「核心函数在特定形状下对不对」，
 * 比如纯英文 slug、`kind: 'entity'`、一处刻意的断链。
 *
 * ⚠️ **合成语料证明不了路线图要的那一条。** 阶段 4 的退出条件是
 * 「一个**全新的真实内容集**能在**不复制内部代码**的情况下使用核心流程」——
 * 而合成数组是**我写出来的**，它天然符合我已经知道的形状。
 * 「我会用它」与「别人写的、我没预先设计过的东西也能用」是两件事。
 *
 * 所以这里用**文件**：内容是异构的，且**异构点事先写在 README 里**。
 *
 * ── 异构点（每一项都对应一个具体风险，不是随手改） ──────────────────
 *
 * | 维度 | 本站 | fixture | 会咬人的地方 |
 * |---|---|---|---|
 * | slug 语言 | 全 ASCII | **中文** | `slugify` / `containsCjk` 的 CJK 分支 |
 * | slug 来源 | 多数靠文件名 | **每篇显式 `slug:`** | `resolveSlug` 的显式分支 |
 * | 章节标题 | 手写小节名 | **`## §1` 编号** | 段落切分与 `heading` 提取 |
 * | 关系字段 | `related:` | **`audience:`**（映射层要翻译） | 「字段名不叫 related」 |
 * | 知识类型 | 5 concept / 1 entity | **2 synthesis / 3 concept / 1 entity** | `wikiKind` 的分布 |
 * | 同名标题 | 无 | **两篇都叫「导出」** | `ambiguousTitles` 规则 |
 * | 孤儿页 | 无 | **3 篇** | `orphan-page` 规则 |
 *
 * ── 它第一次跑就抓到三件事 ──────────────────────────────────────────
 *
 * ① `readContentPage` **不返回 `summary`**（它是给检索用的，检索不需要摘要），
 *    而 `Doc.summary` 是**必填 `string`**、`lint` 直接 `.trim()` →
 *    不补就崩。**这是迭代 N 那个「类型说是必填、实际可能是 undefined」的同型复发**，
 *    而它在本站 467 条测试里从没出现过——因为站内两个调用方都老实填了。
 *
 * ② 我第一版探针读了 `graph.ambiguous`（= 引用打向歧义标题的**引用**），
 *    而要看的是 `graph.ambiguousTitles`（= 同名标题本身）——
 *    读错字段让我一度以为 `buildGraph` 回归了。
 *    **探针也会写错，而症状与「实现有 bug」一模一样。**
 *
 * ③ 映射层若不处理 `audience:`，`[[审计日志]]` 就没有入链 →
 *    它被误判成孤儿页。**这不是 fixture 的问题，是适配层必须做的翻译。**
 *
 * 用法：`npm run verify:second-site-real`
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
/*
 * ⚠️ **不要写 `import { type X }`**——裸 Node 只擦除**类型标注**，
 * 不解析 inline type import 语法（实测报 `SyntaxError: Unexpected identifier`）。
 * 仓库里其余 `scripts/*.mjs` 一律不写 type import，这里跟着。
 */
import { buildGraph } from '../src/lib/wiki/graph.ts';
import { lint } from '../src/lib/wiki/lint.ts';
import { computeImpact, isDisjoint } from '../src/lib/wiki/impact.ts';
import { readContentPage } from '../src/lib/wiki/read-page.ts';
import { frontmatterField } from '../src/lib/wiki/frontmatter.ts';
import { resolveSlug } from '../src/lib/wiki/slug.ts';
import { pageToDoc } from '../src/lib/wiki/page-to-doc.ts';
import { splitPassages, rank } from '../src/lib/wiki/retrieve.ts';
import { buildContextPack } from '../src/lib/wiki/context-pack.ts';

const ROOT = process.cwd();
const DIR = join(ROOT, 'knowledge', 'fixtures', 'second-site');

console.log('第二份真实内容集（读文件，不是合成数组）');
console.log('─'.repeat(64));

const files = readdirSync(DIR).filter((f) => /\.mdx?$/.test(f));
if (files.length === 0) {
  console.error('fixture 目录里没有内容——这个检查没量到东西。');
  process.exit(1);
}

/*
 * ── 映射层：一个真实站点的适配器要做的事 ──────────────────────────
 *
 * **这就是阶段 4 第 5 项要验的那一步。**
 * 它需要两个读取器，因为字段分在两处：
 *   - `readContentPage` 解析**嵌套块**（`review:` / `sources:`）与正文；
 *   - `frontmatterField` 解析**顶层标量**（`summary:`）。
 * （迭代 AO 同一个结论：两个都要，一个都不够。）
 *
 * 而 `audience:` 是**这个站点自己的字段名**——核心不认识它，
 * 适配层负责翻译成 `related`。**这正是「剥离站点展示逻辑」要留的口子。**
 */
const pages = files.map((file) => {
  const page = readContentPage(DIR, file);
  const source = readFileSync(join(DIR, file), 'utf8');
  return {
    page,
    summary: frontmatterField(source, 'summary') ?? '',
    // ⚠️ **这 5 行是这个适配层里唯一「站点专属」的部分。**
    // 站点把关系声明叫 `audience`，核心只认 `related`。
    // 其余的接线（补 summary、拼 Doc、填显式字段）由 `pageToDoc` 提供——
    // **那不是适配，是每站都要重写一遍的接线**（迭代 AS 实测：27 行里 22 行是它）。
    audience: (frontmatterField(source, 'audience') ?? '')
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
});

const docs = pages.map(({ page, summary, audience }) =>
  pageToDoc(page, { summary, relations: audience }));

console.log(`  读了 ${docs.length} 篇：${docs.map((d) => d.slug).join('、')}\n`);

const graph = buildGraph(docs);
const issues = lint(docs, graph);

/* ── 影响分析：另一套字段形状 ─────────────────────────────────────── */
const impactPages = docs.map((d) => ({
  slug: d.slug,
  title: d.title,
  sources: d.sources ?? [],
  related: d.declaredRelations ?? [],
}));

/* ── 检索与 context pack ─────────────────────────────────────────── */
const passages = docs.flatMap((d) => splitPassages(d.slug, d.body));
/*
 * ⚠️ 签名是 `rank(passages, query, options)`——**passages 在前**，且**没有 docs 参数**。
 * 我第一版按「先 query 后 passages」写，于是 `passages.map is not a function`。
 * 与 `computeImpact(pages, sourceId)` 正好相反——**同仓库两个 API 顺序不同**。
 */
const ranked = rank(passages, '谁能看到机密内容');
/*
 * ⚠️ **字段名必须与 `PackDoc` 逐字一致**——它要的是 `slug`，**不是** `docId`。
 *
 * 我第一版传了 `docId`（那是 `Passage` 的字段名），于是 `docId` 全是 undefined，
 * **而断言照样通过**——因为它查的是 `sources`/`review`，
 * 那两个走的是 `PageSourceRef` / `PageReview`，与 `docId` 无关。
 *
 * > **同一个字段名在三个地方叫三个样**（`Doc.slug` / `Page.slug` / `Passage.docId`），
 * > 传错不会报错、只会静默丢值——**与迭代 AO 那次完全同型**，
 * > 而那次是 `refs` vs `sources` 导致证据全丢。
 *
 * 判据因此加了「每篇都有非空 docId」，见下面那条断言。
 */
const pack = buildContextPack(
  pages.map(({ page }) => ({
    slug: page.slug,
    title: page.title,
    updated: page.updated,
    sources: page.sources,
    review: page.review,
    related: page.related,
    body: page.body,
  })),
  '谁能看到机密内容',
);

const byRule = (rule) => issues.filter((i) => i.rule === rule);

/*
 * ── slug 探针 ──────────────────────────────────────────────────────
 *
 * fixture 里有一篇 `Export Notes.md`：**文件名 ≠ slugify(文件名)**。
 * 它是唯一一个能让「read-page 与构建侧的 slug 不一致」显形的样本。
 *
 * 判据是**两侧各自算一遍再比**：
 *   - 左边：`readContentPage` 实际返回的 slug；
 *   - 右边：`resolveSlug(title, slug 字段, 文件名)`——构建侧用的就是它。
 *
 * > 直接断言「slug 是字符串」是**恒真**的，测不到任何东西。
 * > 那是我第一版的写法——变异验证之前根本发现不了。
 */
const SLUG_PROBE_FILE = 'Export Notes.md';
const SLUG_PROBE = (() => {
  if (!files.includes(SLUG_PROBE_FILE)) {
    return { ok: false, why: `fixture 里没有 ${SLUG_PROBE_FILE}——这条断言测不到东西` };
  }
  const page = readContentPage(DIR, SLUG_PROBE_FILE);
  const source = readFileSync(join(DIR, SLUG_PROBE_FILE), 'utf8');
  const title = frontmatterField(source, 'title') ?? '';
  const explicit = frontmatterField(source, 'slug');
  const expected = resolveSlug(title, explicit, SLUG_PROBE_FILE.replace(/\.mdx?$/, ''));
  return {
    ok: page.slug === expected,
    got: page.slug,
    expected,
  };
})();
/**
 * 某篇文档的 slug 是否与**构建侧算法**一致。
 *
 * ⚠️ **不能用「slug 反查文件名」**——显式 `slug:` 存在时两者本就不同，
 * 那正是这个缺口本身。必须**拿自己的文件名**去算。
 */
function SLUG_MATCHES_BUILD(doc) {
  const file = files.find((f) => {
    const src = readFileSync(join(DIR, f), 'utf8');
    const expected = resolveSlug(
      frontmatterField(src, 'title') ?? '',
      frontmatterField(src, 'slug'),
      f.replace(/\.mdx?$/, ''),
    );
    return expected === doc.slug;
  });
  return file !== undefined;
}

if (!SLUG_PROBE.ok) {
  console.log(
    `  ⚠ slug 探针：read-page 给出「${SLUG_PROBE.got}」，构建侧会给出「${SLUG_PROBE.expected}」` +
      `
    （${SLUG_PROBE.why ?? '两者不一致——CLI / 检索的 docId 会与 manifest 对不上'}）`,
  );
}

/*
 * ── 断言 ──────────────────────────────────────────────────────────
 *
 * 每条都对着 fixture README 里声明的那个异构点，
 * **不是对着「跑起来没崩」**。
 */
const checks = [
  ['全部文档有 summary（映射层补的，不是 readContentPage 给的）',
    docs.every((d) => typeof d.summary === 'string' && d.summary.length > 0)],

  /*
   * ⚠️ 第一版写 `docs.some(d => /[一-龥]/.test(d.slug))`——**只要求「至少一篇是中文」**。
   * 于是把**任意一篇**改成 ASCII，断言照样绿（5 篇还剩中文）。
   * 现在要求「**至少 5 篇是中文**」——那仍然是个数，但它绑住了
   * 「这个 fixture 的异构点是 slug 语言」这件事本身。
   *
   * ⚠️ **顺带发现一个真的缺口**（探针实测）：
   * `readContentPage` **只按文件名给 slug、不读 `slug:` 字段**，
   * 而 Astro 侧（`content.ts:80`）用 `resolveSlug(title, data.slug, entry.id)`。
   * 于是**显式 slug 与文件名不同的文档，在 CLI/检索里的 slug 与构建产物不一致**。
   * fixture 里 `数据留存.md` 刻意声明了 `slug: 数据留存`（与文件名相同），
   * 所以这条差异不触发——**它已登记为 read-page 的缺口，本轮不修**。
   */
  /*
   * ⚠️ **判据是「文件名原样成为 slug」，不是「frontmatter 的 `slug:` 被采用」。**
   *
   * 变异验证实测：把 5 个 `slug:` 全改成 ASCII，**这条断言照样绿**——
   * 因为 `readContentPage` **只按文件名给 slug、不读 `slug:` 字段**
   * （而 Astro 侧 `content.ts:80` 用的是 `resolveSlug(title, data.slug, entry.id)`）。
   * 那是 `read-page` 的**真实缺口**，已登记，本轮不修。
   *
   * > 第一版这条写的是「至少 5 篇是中文」——**更弱**：
   * > 改任意一篇都绿。改成「slug 与文件名逐字相同且含中文」之后，
   * > 它的含义才真的是「中文文件名被原样保留下来」。
   */
  /*
   * ⚠️ **这条对着一个 2026-09-24 实测的真缺口。**
   *
   * `readContentPage` **只按文件名给 slug、不走 `resolveSlug`**，
   * 而构建侧（`src/lib/content.ts:80`）走的是
   * `resolveSlug(data.title, data.slug, entry.id)`。
   *
   * 实测：`Export Notes.md` 在 `read-page` 里是 `Export Notes`，
   * 而构建侧是 `export-notes`（`slugify` 转小写、空格转连字符）。
   *
   * **后果**：CLI / 检索给出的 `docId` 与 `content-manifest.json` 里的 id 对不上，
   * 而订阅者正是靠那个 id 做增量同步的。
   *
   * 本仓库 0 篇写了 `slug:`，文件名也全是小写连字符——
   * 所以**这个缺口在本站至今没有用户可见后果**，它是在异构 fixture 上暴露的。
   *
   * 判据：**fixture 里放一个「文件名 ≠ slugify(文件名)」的样本**，
   * 然后断言 `readContentPage` 给的 slug 与 `resolveSlug` 一致。
   * 不这样判的话，下面那条 `typeof === 'string'` 恒真——**它测不到任何东西**。
   */
  ['slug 走 resolveSlug：文件名与 slugify 结果不同的样本上两侧一致',
    SLUG_PROBE.ok],

  /*
   * ⚠️ **判据随 `read-page` 的修复而变——这本身值得记。**
   *
   * 修复前这条写的是「slug 就是文件名本身」（`read-page` 直接用文件名），
   * 修好之后（走 `resolveSlug`）它必然红——**而那正是修复生效的证据**。
   *
   * 现在测两件事，都不依赖具体实现：
   *   ① **多数 slug 是中文**（异构点还在）；
   *   ② **每个 slug 都等于 `resolveSlug` 的结果**（口径与构建侧一致）。
   */
  ['中文 slug 被保留，且每个 slug 都与 resolveSlug 一致',
    docs.filter((d) => /[一-龥]/.test(d.slug)).length >= 4 &&
    docs.every((d) => SLUG_MATCHES_BUILD(d))],

  /*
   * ⚠️ 第一版是 `passages.some(p => p.heading.includes('§'))`——
   * 同样只要求「至少一段带 §」。把**某一篇**的 § 全去掉，剩下 5 篇仍然绿。
   * 改成「**带 § 的段落数 = 语料里 § 标题的总数**」——
   * 少任何一段都会红，而它仍不依赖具体数字。
   */
  ['§ 编号章节全部被切进段落，且 heading 带编号（数量一致，不是「至少一段」）',
    (() => {
      const sectionHeadings = docs.reduce(
        (n, d) => n + (d.body.match(/^## §/gm) ?? []).length, 0);
      const withSection = passages.filter((p) => p.heading.includes('§')).length;
      return sectionHeadings > 0 && withSection === sectionHeadings;
    })()],

  ['同名标题进了 ambiguousTitles（两篇「导出」）',
    [...graph.ambiguousTitles.keys()].includes('导出')],

  ['引用打向歧义标题被单独记进 ambiguous',
    graph.ambiguous.length === 1 && graph.ambiguous[0].target === '导出'],

  /*
   * ⚠️ `Map.has()` 返回 **boolean**，不是元素——`has(x)?.some(...)`
   * 会在 `false` 上调 `.some` 而崩。正确写法是 `get(x) ?? []`。
   * 这已经是这个探针的第四个自身错误（type import / 顺序 / has vs get）。
   */
  /*
   * 意图：「那条 `[[导出]]` **不落到任何一篇上**」。
   *
   * ⚠️ 第一版写成「两篇入链都是 0」——**测的是巧合**。
   * 给 `audience:` 加一条声明后，「导出-格式细节」从 `audience:` 得了入链，
   * 于是断言红、而**实现完全正确**。
   *
   * 改测意图本身：**两篇的入链里，都没有一条来自「导出-总览」**
   * （它正是发出那条歧义引用的文档）。
   */
  ['歧义标题不落到任何一篇：两篇的入链里都没有来自「导出-总览」的',
    [...(graph.backlinks.get('导出-总览') ?? []), ...(graph.backlinks.get('导出-格式细节') ?? [])]
      .every((b) => b.fromSlug !== '导出-总览')],

  /*
   * ⚠️ **不写「恰好 3 篇」——那个数字是派生结果，会被别处的合法改动打破。**
   *
   * 2026-09-24 实测：给 `audience:` 加一条声明之后，孤儿页从 3 变 2，
   * 而**那条加边本身是对的**（它正是要测的「映射层翻译了 audience」）。
   * 于是断言红、而实现没错——**断言测的是巧合，不是契约。**
   *
   * 契约是「**没有入链的文档会被列进 orphans**」，与具体数量无关。
   */
  ['没有入链的文档都进了 orphans（有入链的一个都不在）',
    docs.filter((d) => !graph.backlinks.has(d.slug)).map((d) => d.slug).sort().join(',') ===
    [...graph.orphans].sort().join(',')],

  ['刻意那篇孤儿页确实在 orphans 里（证明上面不是空集）',
    graph.orphans.includes('待定-孤儿页')],

  /*
   * ⚠️ **这条断言第一版测错了东西。**
   *
   * 它原来查「`审计日志` 有入链」——而变异验证发现：
   * 把 `audience:` 改名成 `related:`（映射层不再翻译它）之后，**它照样有入链**，
   * 因为正文里还有一个 `[[审计日志]]` 的真链接。
   *
   * > **断言通过不代表它测的机制成立。** 那一版测的是「有人链接它」，
   * > 而真正要测的是「**frontmatter 里声明的关系进了图**」。
   *
   * 改查 `outgoing`：`数据留存` 的 `audience:` 声明了「审计日志」，
   * 而**正文里没有**指向它的链接（`[[数据留存]]` 出现在别处）——
   * 所以 `outgoing` 里有它，就只可能来自 `audience:`。
   */
  ['audience: 被翻译成关系（数据留存 → 导出-格式细节，正文里没有这条链接）',
    (graph.outbound.get('数据留存') ?? new Set()).has('导出-格式细节')],

  ['0 个断链——异构内容集本身是自洽的',
    graph.broken.length === 0],

  ['lint 的 orphan-page 条数与图里的 orphans 一致（不多不少）',
    byRule('orphan-page').length === graph.orphans.length],

  /*
   * ⚠️ **规则名是 `ambiguous-wikilink`，不是 `ambiguous-title`。**
   *
   * 我第一版写 `byRule('ambiguous-title').length >= 1`，
   * 结果它返回 0 —— 于是我一度以为「加了真引用之后 lint 反而不报了」。
   * 实际规则名是 `ambiguous-wikilink`，而且**它是 error 级**：
   * 歧义引用必须有人决定指哪一篇，不该只给个 warn。
   *
   * > `graph.ambiguousTitles`（同名标题清单）与
   * > lint 的 `ambiguous-wikilink`（**引用**打到了歧义标题）是两件事；
   * > 只有当正文里真写了那个标题时，后者才触发。
   * > **又一个「读错字段/规则名，症状与实现坏了完全一样」。**
   *
   * ⚠️ **2026-09-24 修正这条注释本身**：它原先写「规则名是 `ambiguous-wikilink`，
   * **不是** `ambiguous-title`」——**那是错的，两条规则都存在**：
   *
   * | 规则 | 级别 | 何时触发 |
   * |---|---|---|
   * | `ambiguous-wikilink` | **error** | **有人写**了那个歧义标题（必须有人决定指哪篇） |
   * | `ambiguous-title` | **warn** | 同名标题存在，**但还没人用它**（预防性提醒） |
   *
   * 断言当时改对了（用 `ambiguous-wikilink`），**只有注释说错了**——
   * 而那句错话后来被我抄进了 `knowledge/log.md`，差点变成「事实」。
   *
   * > **注释里的错误陈述比没有注释更糟**：
   * > 读代码的人会拿它当依据，而它看起来和正确的陈述一模一样。
   */
  ['lint 报出 ambiguous-wikilink，且是 error 级（有人引用了歧义标题）',
    byRule('ambiguous-wikilink').length === 1 &&
    byRule('ambiguous-wikilink')[0].level === 'error'],

  /*
   * 另一条：同名标题存在但**没人引用**时的 warn 级提醒。
   *
   * ⚠️ **这一条原先是「若报必是 warn」——而它当时 0 条，于是等于没测。**
   * 「恰好不触发」与「没有这条规则」在输出里**长得一样**
   * （本轮第三次撞上这个形状）。
   *
   * 已加两篇 `附录-A/B`（同名、无人引用）让它**真的触发**，
   * 判据随之从「若报」变成「**必报，且是 warn 级**」。
   */
  ['ambiguous-title（未被引用的同名标题）报出 1 条 warn',
    byRule('ambiguous-title').length === 1 &&
    byRule('ambiguous-title')[0].level === 'warn'],

  ['error 只来自那一条歧义引用（没有别的意外）',
    issues.filter((i) => i.level === 'error').length === 1],

  ['影响分析在异构语料上跑得出结果（三组互不重叠）',
    isDisjoint(computeImpact(impactPages, 'internal-access-matrix'), [])],

  ['影响分析对一个本站没有的来源 id 返回空而不是崩',
    computeImpact(impactPages, '不存在的来源').direct.length === 0],

  ['检索能排出结果（异构语料上覆盖度算法不崩）',
    ranked.length > 0],

  ['context pack 拿得到证据（含来源版本或复核状态）',
    pack.passages.length > 0 &&
      pack.passages.some((p) => (p.sources?.length ?? 0) > 0 || p.review?.status !== undefined)],

  /*
   * ⚠️ **这一条对着「字段名传错但断言照样过」那个坑。**
   *
   * 我第一版给 `buildContextPack` 传了 `docId`（而它要 `slug`），
   * 于是每篇的 docId 都是 undefined——**而上一条断言照样通过**，
   * 因为它查的是 `sources` / `review`，那两个与 docId 无关。
   *
   * > **一个通过但测不到机制的断言比没有更糟**：
   * > 它让人以为那个机制被覆盖了。
   */
  ['context pack 的每个 passage 都有非空 docId（字段名没传错）',
    pack.passages.length > 0 && pack.passages.every((p) => typeof p.docId === 'string' && p.docId !== '')],
];

let bad = 0;
for (const [name, ok] of checks) {
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
}

console.log('');
if (bad === 0) {
  console.log(
    `核心流程在**读自文件的异构内容集**上全部成立。\n` +
      `  —— 但这只证明「核心不依赖本站的形状」，**证不了「接入新站点不用改核心」**：\n` +
      `  适配层（映射 + slug 规则 + 关系字段翻译）仍然是接新站点时要写的东西。`,
  );
  console.log('');
} else {
  console.log(`${bad} 项不成立。\n`);
}
process.exit(bad === 0 ? 0 : 1);
