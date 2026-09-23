/**
 * 知识库体检。
 *
 * ── 为什么 lint 是这个项目的核心而不是附加项 ────────────────────────
 *
 * 「让 agent 维护一个知识库」这个模式最大的风险不是写不出来，是**慢慢烂掉**：
 * 改了标题没改引用、删了页面留下断链、新建的页面谁都不指向、摘要越写越敷衍。
 * Karpathy 的 llm-wiki 把 lint 列为三个基本操作之一，正是因为如此。
 *
 * 但「让 agent 定期检查」不是工程方案——它不可复现、不可回归、不能进 CI。
 * 所以这里做的是**确定性版本**：不调用任何模型，纯规则，同样输入永远同样输出。
 * agent 可以做更强的语义检查（「这两页说法矛盾」），但**地基必须是机械的**。
 *
 * 分级沿用 CI 的惯例：
 * - `error` —— 构建必须失败。断链、重复 slug 属于这一类。
 * - `warn`  —— 不阻塞，但会在报告里列出来。
 * - `info`  —— 提示，用于「你可能有更好的选择」。
 */

import { containsCjk } from './slug.ts';
import { normalizeTarget } from './wikilink.ts';
import type { Doc, LinkGraph } from './graph.ts';

export type IssueLevel = 'error' | 'warn' | 'info';

export interface Issue {
  /** 规则名，kebab-case。CI 与豁免都靠它 */
  readonly rule: string;
  readonly level: IssueLevel;
  /** 涉及的文档 slug，全局性问题为 null */
  readonly slug: string | null;
  /** 给人看的一句话，说明**为什么**是问题而不只是「违反了规则」 */
  readonly message: string;
}

export interface LintOptions {
  /**
   * 是否检查「中文标题未显式指定 slug」。
   *
   * 默认**关闭**：保留 CJK 的 URL 是合法且好读的，不该一上来就报警。
   * 打开它是因为很多博主确实更想要英文 URL（复制出去是 `%E8%AE%BA...` 很长），
   * 但这是**取舍**不是**错误**，所以分级是 info 而不是 warn。
   */
  readonly warnOnCjkSlug?: boolean;
  /**
   * 摘要长度上限（字符）。
   *
   * 摘要同时用作 `meta description`，而**搜索引擎会在约 160 字符处截断它**——
   * 超出后读者在搜索结果里看到的是半句话。llms.txt 那边**不截断**（整句照列），
   * 代价是多占 token。这两种代价都不致命，所以分级是 info 而不是 warn。
   */
  readonly maxSummaryLength?: number;
  /**
   * 是否检查 wiki 链接。
   *
   * **关掉知识层时必须一并关掉它。**
   *
   * `[[链接]]` 的意义完全来自知识层——没有知识层，它就只是一串方括号，
   * 不该被当成断链。早先这里没做区分，导致 `wiki.enabled: false`
   * 这个**文档里承诺的正式出口**直接让构建失败：用户关掉了知识层，
   * 却收到七条「引用了不存在的页面」的错误，而那些页面正是他刚关掉的。
   *
   * 同类问题还有「用户删掉示例知识库条目」——那是新用户最自然的第一步，
   * 结果同样撞墙。所以这条开关不只是功能开关，也是**存活率开关**。
   */
  readonly checkWikilinks?: boolean;
  /** 是否检查孤儿页（同样依赖知识层） */
  readonly checkOrphans?: boolean;
}

const DEFAULTS = {
  warnOnCjkSlug: false,
  maxSummaryLength: 200,
  checkWikilinks: true,
  checkOrphans: true,
} as const;

/**
 * 根层文章路由不能占用的系统路径。
 *
 * 文章输出在 `/<slug>/`，而这些路径已经由 `src/pages` 的静态路由占用。
 * Astro 遇到冲突只打印 warning、仍以 0 退出：文章 HTML 消失，但 `.md`、RSS、
 * 列表与内容清单仍保留它，造成同一条内容在不同出口指向不同页面。
 */
export const RESERVED_POST_SLUGS = [
  '404',
  'about',
  'archive',
  'posts',
  'search',
  'tags',
  'wiki',
] as const;

const RESERVED_POST_ROUTES: ReadonlyMap<string, string> = new Map([
  ['404', '404 页面'],
  ['about', '关于页'],
  ['archive', '归档页'],
  ['posts', '文章列表'],
  ['search', '搜索页'],
  ['tags', '标签索引'],
  ['wiki', '知识库入口'],
]);

/**
 * 对文档集合跑全部规则。
 *
 * 输出按 (level, rule, slug) 稳定排序——报告必须可复现，
 * 否则「这次构建多了三条告警」就无法用 diff 判断是内容变了还是顺序变了。
 */
export function lint(docs: readonly Doc[], graph: LinkGraph, options: LintOptions = {}): Issue[] {
  const opts = { ...DEFAULTS, ...options };
  const issues: Issue[] = [];

  issues.push(...checkDuplicateSlugs(docs));
  issues.push(...checkReservedPostRoutes(docs));
  // 断链与孤儿页都依赖知识层存在才有意义，关掉时不检查
  if (opts.checkWikilinks) issues.push(...checkBrokenLinks(graph));
  if (opts.checkWikilinks) issues.push(...checkAmbiguousTitles(graph));
  if (opts.checkWikilinks) issues.push(...checkRedundantRelations(graph));
  if (opts.checkOrphans) issues.push(...checkOrphans(graph));
  issues.push(...checkSummaries(docs, opts.maxSummaryLength));
  issues.push(...checkEmptyBodies(docs));
  if (opts.warnOnCjkSlug) issues.push(...checkCjkSlugs(docs));

  const levelRank: Record<IssueLevel, number> = { error: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => {
    const byLevel = levelRank[a.level] - levelRank[b.level];
    if (byLevel !== 0) return byLevel;
    if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
    return (a.slug ?? '') < (b.slug ?? '') ? -1 : (a.slug ?? '') > (b.slug ?? '') ? 1 : 0;
  });
}

/**
 * 同一目标被正文 `[[wikilink]]` 与 frontmatter `related` 各写了一次。
 *
 * **这不是错误**：图用 `Set` 去重，边不会重复、计数不会错。代价是
 * **多一处要同步的地方**——而实测里这个代价出现过：2026-09-24 改名实验时，
 * 改完正文才发现 `related` 也有同一个目标，构建被 `broken-wikilink` 拦下。
 *
 * <p>所以是 **warn 而非 error**：两处都写没有坏处，提醒只是让成本可见。
 * 真要消除它得让 `related` 由正文链接派生，那会改内容模型，不是一条 lint 的事。
 */
function checkRedundantRelations(graph: LinkGraph): Issue[] {
  const issues: Issue[] = [];
  for (const [slug, targets] of [...graph.redundantRelations].sort()) {
    issues.push({
      rule: 'redundant-relation',
      level: 'warn',
      slug,
      message:
        `「${slug}」在正文里链接了 ${targets.join('、')}，` +
        `frontmatter 的 \`related\` 里又声明了一次。` +
        `两处都写不影响构建（图会去重），但**改名时要改两处**——` +
        `漏掉一处就会断链。要么删掉 related 里的这一项，要么把正文里的链接去掉。`,
    });
  }
  return issues;
}

/** 文章 slug 与静态系统路由冲突。知识库位于 `/wiki/<slug>/`，不受此限制。 */
function checkReservedPostRoutes(docs: readonly Doc[]): Issue[] {
  return docs.flatMap((doc) => {
    if (doc.draft || doc.kind !== 'post') return [];
    const owner = RESERVED_POST_ROUTES.get(doc.slug);
    if (!owner) return [];

    return [
      {
        rule: 'reserved-post-slug',
        level: 'error' as const,
        slug: doc.slug,
        message:
          `文章「${doc.title}」使用了 slug「${doc.slug}」，但 /${doc.slug}/ 已属于${owner}。` +
          `Astro 遇到这种冲突只会警告并跳过文章 HTML，构建仍显示成功；` +
          `与此同时 .md、RSS、列表和内容清单仍会发布它，导致各出口互相矛盾。` +
          `请为文章改用其他 slug。`,
      },
    ];
  });
}

/**
 * 两个文档抢同一个 slug。
 *
 * 这是最严重的一类：后构建的会**静默覆盖**先构建的，读者访问到的页面
 * 取决于构建顺序，而构建顺序可能因为文件系统枚举顺序而变。
 * 也就是说这个 bug 会「有时候出现」。
 */
function checkDuplicateSlugs(docs: readonly Doc[]): Issue[] {
  const seen = new Map<string, string[]>();

  for (const doc of docs) {
    if (doc.draft) continue;
    const titles = seen.get(doc.slug) ?? [];
    titles.push(doc.title);
    seen.set(doc.slug, titles);
  }

  const issues: Issue[] = [];
  for (const [slug, titles] of seen) {
    if (titles.length < 2) continue;
    issues.push({
      rule: 'duplicate-slug',
      level: 'error',
      slug,
      message:
        `有 ${titles.length} 个文档都解析到 slug「${slug}」：${titles.join('、')}。` +
        `后构建的会静默覆盖先构建的，读者看到哪一篇取决于构建顺序。` +
        `请给其中之一在 frontmatter 里显式指定 slug。`,
    });
  }
  return issues;
}

function checkBrokenLinks(graph: LinkGraph): Issue[] {
  // 同一篇文章里重复引用同一个不存在的目标只报一次——重复报会把
  // 有意义的信号淹掉，而作者要修的是「这个目标不存在」这一件事。
  const seen = new Set<string>();

  const unique = graph.broken.filter((b) => {
    // 用 NUL 做复合键的分隔符，避免 slug 与 target 的拼接产生歧义。
    // 注意写成**转义序列**而不是裸字节——源码里出现字面 NUL 会让
    // 编辑器、diff、以及某些构建工具行为异常，而且肉眼完全看不出来。
    const key = `${b.fromSlug}\u0000${b.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  /**
   * 知识层**一个条目都没有**时，换一套说法。
   *
   * 这是新用户最常见的场景：他删掉了全部示例知识库条目，于是文章里
   * 残留的 `[[中文排版]]` 之类全部变成断链。此时逐条告诉他「引用了不存在的
   * 页面」是没用的——他会以为要逐条去修，而实际上面临的是**一个决定**：
   * 到底要不要知识层。
   *
   * 所以这种情况下给一条**说明该怎么决策**的提示，而不是七条同质的报错。
   * 这个场景实测会让构建在中止，而它正是新用户最自然的第一步操作。
   */
  // 注意判断的是「有没有**知识层条目**」，不是「bySlug 是否为空」——
  // bySlug 里同时装着文章，用 `bySlug.size === 0` 判断的话，
  // 只要还有文章就永远不成立，这条提示等于没写。
  const hasWikiPages = [...graph.bySlug.values()].some((d) => d.kind === 'wiki');

  if (!hasWikiPages && unique.length > 0) {
    const targets = [...new Set(unique.map((b) => b.target))];
    return [
      {
        rule: 'broken-wikilink',
        level: 'error',
        slug: null,
        message:
          `内容里有 ${unique.length} 处 [[链接]]，但知识层一个条目都没有，` +
          `所以它们全部指向不存在的页面。涉及的引用：${targets.slice(0, 5).join('、')}` +
          `${targets.length > 5 ? ' 等' : ''}。
` +
          `  → 要知识层：在 src/content/wiki/ 下把这些页面建起来（一条一个 .md 文件）。
` +
          `  → 不要知识层：在 src/config.ts 里把 wiki.enabled 设为 false，` +
          `这些检查会自动关闭，[[方括号]] 会原样显示为文本，构建恢复正常。`,
      },
    ];
  }

  return unique.map((b) => ({
    rule: 'broken-wikilink',
    level: 'error' as const,
    slug: b.fromSlug,
    message:
      `「${b.fromTitle}」引用了 [[${b.target}]]，但没有这个页面。` +
      `要么新建它，要么把引用改成已有的页面——留着断链会将「知识库」退化成「一堆文件」。` +
      `（整站都不需要知识层的话，在 src/config.ts 里把 wiki.enabled 设为 false。）`,
  }));
}

/**
 * 歧义标题：多个页面用了同一个标题。
 *
 * ── 为什么这必须是一条规则，而不是"随它去" ──────────────────────────
 *
 * 原先的解析是**先到先得**：`if (!lookup.has(title)) lookup.set(title, slug)`。
 * 于是 `[[那个标题]]` 指向谁，取决于**文档遍历顺序**。
 *
 * 实测（2026-09-22）：调换两个页面的输入顺序，同一个 `[[Shared]]`
 * 分别指向 a 和 b——而两次 lint 都报 **0 个错误**。
 * 链接目标由文件顺序决定，且没有任何东西发现。
 *
 * 现在分两档：
 *
 *   · **用了**歧义标题 → `error`。不能任选一个，所以构建停下来，
 *     并把候选 slug 列出来让作者选。出口是改用显式 `[[slug]]`。
 *   · 歧义标题**存在但没被引用** → `warn`。不阻断构建——
 *     两页恰好同名不等于错，但作者应当知道它挡着一个链接名。
 */
function checkAmbiguousTitles(graph: LinkGraph): Issue[] {
  const issues: Issue[] = [];

  // 同一篇里重复引用同一个歧义标题只报一次，理由同 checkBrokenLinks
  const seen = new Set<string>();
  for (const a of graph.ambiguous) {
    const key = `${a.fromSlug}\u0000${a.target}`;
    if (seen.has(key)) continue;
    seen.add(key);

    issues.push({
      rule: 'ambiguous-wikilink',
      level: 'error',
      slug: a.fromSlug,
      message:
        `「${a.fromTitle}」引用了 [[${a.target}]]，但有 ${a.candidates.length} 个页面都叫这个名字：` +
        `${a.candidates.map((s) => `[[${s}]]`).join('、')}。` +
        `**不能替作者选一个**——所以这里报错而不是猜。` +
        `把引用改成上面对应的 slug 即可。`,
    });
  }

  // 只在被引用时才报错；这里补的是"存在但没人用"的那一档
  const referenced = new Set(graph.ambiguous.map((a) => normalizeTarget(a.target)));
  for (const [title, slugs] of graph.ambiguousTitles) {
    if (referenced.has(title)) continue;
    issues.push({
      rule: 'ambiguous-title',
      level: 'warn',
      slug: null,
      message:
        `${slugs.length} 个页面共用了标题「${title}」：${slugs.map((s) => `[[${s}]]`).join('、')}。` +
        `目前没有链接用到这个标题，所以不影响构建；` +
        `但一旦有人写 [[${title}]]，就会报歧义错误。` +
        `想现在就避开的话，改掉其中一个页面的标题，或改用显式 slug 引用。`,
    });
  }

  return issues;
}

/**
 * 孤儿页：没有任何入链的 wiki 页。
 *
 * 这不只是整洁问题：知识库的价值来自**连接**，一个谁都不指向的页面
 * 在实际阅读路径里等于不存在——它只会在文件列表里占个位置。
 */
function checkOrphans(graph: LinkGraph): Issue[] {
  return graph.orphans.map((slug) => {
    const doc = graph.bySlug.get(slug);
    return {
      rule: 'orphan-page',
      level: 'warn' as const,
      slug,
      message:
        `「${doc?.title ?? slug}」没有任何页面指向它。` +
        `读者只能靠直接输 URL 找到它——考虑从相关文章里 [[${slug}]] 引一下，` +
        `或者把它删掉。`,
    };
  });
}

/**
 * 缺摘要。
 *
 * 摘要是 llms.txt 的骨架：agent 靠它决定「要不要读这一页」。
 * 没有摘要的条目在 llms.txt 里只是一行标题，等于让 agent 盲猜。
 */
function checkSummaries(docs: readonly Doc[], maxLength: number): Issue[] {
  const issues: Issue[] = [];

  for (const doc of docs) {
    if (doc.draft) continue;

    if (doc.summary.trim() === '') {
      issues.push({
        rule: 'missing-summary',
        level: 'warn',
        slug: doc.slug,
        message:
          `「${doc.title}」没有 summary。摘要是 llms.txt 的骨架——` +
          `agent 靠它判断要不要深入读这一页，缺了就只能盲猜。`,
      });
    } else if (doc.summary.length > maxLength) {
      issues.push({
        rule: 'summary-too-long',
        level: 'info',
        slug: doc.slug,
        message:
          `「${doc.title}」的摘要 ${doc.summary.length} 字，超过 ${maxLength} 字。` +
          `搜索引擎会把 meta description 截到约 160 字符，读者在结果页只看到半句话` +
          `（llms.txt 里不截断，但会多占 token）——建议精炼成一句。`,
      });
    }
  }

  return issues;
}

/** 空正文。多半是建了文件忘了写。 */
function checkEmptyBodies(docs: readonly Doc[]): Issue[] {
  return docs
    .filter((doc) => !doc.draft && doc.body.trim() === '')
    .map((doc) => ({
      rule: 'empty-body',
      level: 'warn' as const,
      slug: doc.slug,
      message: `「${doc.title}」正文是空的。如果还没写完，请在 frontmatter 里加 draft: true。`,
    }));
}

/**
 * 中文标题 + 自动生成的 slug → 提示 URL 会长。
 *
 * 默认关闭（见 LintOptions 说明）。打开后也只是 info：
 * `/论可复现的评测/` 是可读的，只是复制出去会变成一长串百分号编码。
 */
function checkCjkSlugs(docs: readonly Doc[]): Issue[] {
  return docs
    .filter((doc) => !doc.draft && !doc.explicitSlug && containsCjk(doc.slug))
    .map((doc) => ({
      rule: 'cjk-slug',
      level: 'info' as const,
      slug: doc.slug,
      message:
        `「${doc.title}」的 URL 由中文标题生成。这本身没问题（浏览器会显示原文），` +
        `但复制到别处会变成一长串 %E8%AE%BA 这样的编码。` +
        `想固定成英文，在 frontmatter 里加一行 slug: your-slug。`,
    }));
}

/** 报告是否有阻断级问题。CI 只看这一个返回值。 */
export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

/** 渲染成给人看的报告。 */
export function formatIssues(issues: readonly Issue[]): string {
  if (issues.length === 0) return '知识库体检通过，没有发现问题。';

  const labels: Record<IssueLevel, string> = { error: '错误', warn: '警告', info: '提示' };
  const counts = { error: 0, warn: 0, info: 0 };
  for (const issue of issues) counts[issue.level]++;

  const lines = [
    `知识库体检：${counts.error} 个错误、${counts.warn} 个警告、${counts.info} 个提示`,
    '',
  ];

  for (const issue of issues) {
    lines.push(`[${labels[issue.level]}] ${issue.rule}`);
    lines.push(`  ${issue.message}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
