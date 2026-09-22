/**
 * 链接图：把「一堆独立文件」变成「一个知识库」。
 *
 * 这个模块是纯函数——不读文件系统、不碰 Astro、不依赖网络。
 * 因此它可以在毫秒级被测试穷举，也可以在 CI 里对真实内容跑。
 */

import { normalizeTarget, parseWikiLinks, type WikiLinkRef } from './wikilink.js';

/** 一篇可被链接的文档。文章与 wiki 页在链接图里地位相同。 */
export interface Doc {
  /** 文档种类。仅用于展示与 lint 分级，不影响链接解析。 */
  readonly kind: 'post' | 'wiki';
  /** 路径片段，全库唯一 */
  readonly slug: string;
  readonly title: string;
  /** 一句话摘要。喂给 llms.txt，也用作 meta description */
  readonly summary: string;
  /** markdown 正文（不含 frontmatter）——**就是作者写的那份，不做任何追加** */
  readonly body: string;
  /**
   * 作者在 frontmatter 里用 `related` 声明的出链。
   *
   * <p>它**不进 `body`**：这里早先是把声明折成正文末尾的一行 wiki 链接追加进去的，
   * 好让链接图、反向链接、孤儿页判定都能看见它。那个目的没错，代价是那行会跟着
   * `body` 一路进机器出口（`.md` 孪生、`llms-full.txt`）——读者会看到一行
   * 作者从没写过的 `[[a]] [[b]]`。现在图（`buildGraph`）直接读这个字段。
   *
   * <p>注意 `refsOf` **不**包含它——那个函数返回的是"正文里出现的引用"，
   * 带原文偏移、供替换用；声明来的关系不在正文里，给它一个 -1 偏移是陷阱。
   *
   * <p>可选：绝大多数文档没有声明 `related`，而测试里的 fixture 也不必逐个补上。
   */
  readonly declaredRelations?: readonly string[];
  /**
   * 知识类型：`concept` / `entity` / `synthesis`。文章没有这个字段。
   *
   * ⚠️ **别和 `kind` 搞混**——那个是**文档类型**（post / wiki），
   * 这个是**知识类型**。两者同名不同物，而摘要要覆盖的是后者：
   * 同一个标题从 concept 改成 synthesis 是实质变化。
   *
   * （第一版 `digest.ts` 用的就是 `doc.kind`，也就是恒为 "wiki" 的那个——
   * 于是知识类型怎么改摘要都不变。这个错是靠"让构建打印它实际看到的字段"
   * 才发现的，看代码看不出来。）
   */
  readonly wikiKind?: string;
  /** 作者是否显式指定过 slug（用于 lint 提示中文 URL 的代价） */
  readonly explicitSlug: boolean;
  readonly draft: boolean;
  /**
   * 本页声明的来源引用。空数组 = 没标，**不是**错误。
   *
   * 类型用结构化形状而不是从 sources.ts import——`graph.ts` 是最底层的
   * 纯逻辑，不该依赖读文件的那一层（那会把它拖进 fs 与路径假设里）。
   */
  readonly sources?: readonly {
    readonly sourceId: string;
    readonly revision: string;
    readonly locator?: string;
  }[];
  /** 复核记录。`contentDigest` 用**当时**算出的正文摘要，构建期现算比对。 */
  readonly review?: {
    readonly status: 'pending' | 'reviewed' | 'stale';
    readonly checkedAt?: string;
    readonly contentDigest?: string;
  };
}

/** 一条指向某文档的入链。 */
export interface Backlink {
  readonly fromSlug: string;
  readonly fromTitle: string;
  /** 链接在原文中的显示文本。作者常写成与目标标题不同的说法，值得保留 */
  readonly label: string;
}

/** 一条无法解析的链接。 */
export interface BrokenLink {
  readonly fromSlug: string;
  readonly fromTitle: string;
  readonly target: string;
}

/**
 * 一条**指向歧义标题**的链接。
 *
 * 这是"能解析但不该解析"的一类：多个文档用了同一个标题，而 `[[那个标题]]`
 * 指哪一个全看遍历顺序。**不能任选一个**——那等于让文档顺序决定链接目标。
 *
 * 分成两个字段而不是塞进 `BrokenLink`：`broken` 是"找不到"，
 * 这里是"找到好几个"，处置也不同（前者改链接目标，后者加显式 slug）。
 */
export interface AmbiguousLink {
  readonly fromSlug: string;
  readonly fromTitle: string;
  readonly target: string;
  /** 同名文档的候选 slug，按字典序，供报错时直接列出。 */
  readonly candidates: readonly string[];
}

export interface LinkGraph {
  /** slug → 文档 */
  readonly bySlug: ReadonlyMap<string, Doc>;
  /** 归一化后的名字 → slug。让 `[[某页]]` 与 `[[某 页]]` 都能命中 */
  readonly lookup: ReadonlyMap<string, string>;
  /** slug → 指向它的入链 */
  readonly backlinks: ReadonlyMap<string, readonly Backlink[]>;
  /** slug → 它指向的 slug 集合 */
  readonly outbound: ReadonlyMap<string, ReadonlySet<string>>;
  /** 所有解析失败的链接 */
  readonly broken: readonly BrokenLink[];
  /**
   * 用了歧义标题的链接。
   *
   * 归一化标题 → 用了这个标题的所有 slug（**至少两个**才会出现在这里）。
   * 这些标题**不会**进 `lookup`：让它们进就等于按遍历顺序任选一个。
   */
  readonly ambiguousTitles: ReadonlyMap<string, readonly string[]>;
  /** 解析到了歧义标题的引用 */
  readonly ambiguous: readonly AmbiguousLink[];
  /** 没有任何入链、且不是入口页的文档 slug */
  readonly orphans: readonly string[];
}

/**
 * 文档的对外 URL。**这是全站唯一的 URL 规则**。
 *
 * 抽成 `(kind, slug)` 而不是只吃 `Doc`：`remark-wikilink` 在 markdown 管线里
 * 拿不到 `Doc`（它是纯 fs 扫描），而它**曾经手写**这两个前缀：
 *
 *     collect('posts', '/'); collect('wiki', '/wiki/');
 *
 * 那是同一套规则的第二份实现——`urlOf` 一改，它就静默对不上，
 * 于是 HTML 里的链接与链接图/清单各指各的。现在两边都走这一个函数。
 */
export function urlFor(kind: Doc['kind'], slug: string): string {
  return kind === 'wiki' ? `/wiki/${slug}/` : `/${slug}/`;
}

/** 计算文档的对外 URL。文章与 wiki 页共用一套规则，便于互相链接。 */
export function urlOf(doc: Doc): string {
  return urlFor(doc.kind, doc.slug);
}

export interface GraphOptions {
  /**
   * 是否让草稿参与链接图。
   *
   * 默认 `false`：草稿不该被别的文章链接，也不该出现在「孤儿页」统计里——
   * 否则每写一篇草稿都会制造一条假告警。
   *
   * 但**开发模式下要打开**：作者在 `npm run dev` 里预览未完成的文章时，
   * 那篇文章里的 `[[链接]]` 也需要被解析。不开的话，草稿正文里所有
   * 链接都会显示成方括号，看起来像功能坏了。
   */
  readonly includeDrafts?: boolean;
}

/**
 * 构建链接图。
 *
 * 默认只有**非草稿**文档参与，理由见 `GraphOptions.includeDrafts`。
 */
export function buildGraph(docs: readonly Doc[], options: GraphOptions = {}): LinkGraph {
  const published = options.includeDrafts ? [...docs] : docs.filter((d) => !d.draft);
  const bySlug = new Map<string, Doc>();
  const lookup = new Map<string, string>();

  /*
   * ── 先数标题，再建查找表 ────────────────────────────────────────────
   *
   * 原先是一个循环里 `if (!lookup.has(title)) lookup.set(title, slug)`——
   * 也就是**先到先得**。同名标题谁先进查找表，`[[那个标题]]` 就指向谁，
   * 而"谁先进"取决于文档遍历顺序。
   *
   * 实测（2026-09-22）：调换两个页面的输入顺序，同一个 `[[Shared]]`
   * 分别指向 a 和 b，而两次 lint 都报 0 个错误——**没有任何东西发现这件事**。
   *
   * 现在改成：**同名标题根本不进查找表**。用了它的引用单独记录到
   * `ambiguous`，由 lint 报错并列出候选。`[[显式 slug]]` 不受影响。
   */
  const titleOwners = new Map<string, string[]>();
  for (const doc of published) {
    bySlug.set(doc.slug, doc);
    // slug 是唯一的，直接进
    lookup.set(normalizeTarget(doc.slug), doc.slug);
    const key = normalizeTarget(doc.title);
    const owners = titleOwners.get(key);
    if (owners) owners.push(doc.slug);
    else titleOwners.set(key, [doc.slug]);
  }

  const ambiguousTitles = new Map<string, readonly string[]>();
  for (const [title, slugs] of titleOwners) {
    if (slugs.length === 1) {
      // 只有一个主人：标题照常可用。**不能覆盖已有的 slug 入口**
      // （一个文档的标题可能与另一个文档的 slug 同名，那时 slug 优先）
      if (!lookup.has(title)) lookup.set(title, slugs[0]!);
    } else {
      ambiguousTitles.set(title, [...slugs].sort());
    }
  }

  const backlinks = new Map<string, Backlink[]>();
  const outbound = new Map<string, Set<string>>();
  const broken: BrokenLink[] = [];
  const ambiguous: AmbiguousLink[] = [];
  const inboundCount = new Map<string, number>();

  for (const doc of published) {
    const targets = new Set<string>();
    outbound.set(doc.slug, targets);

    // ── 两个来源：正文里的 `[[…]]`，以及 frontmatter 里声明的 `related` ──
    //
    // 后者**不改写正文**。早先的做法是把它折成正文末尾的一行 `[[x]] [[y]]` 追加进
    // `body`，好让图看见——代价是那一行会跟着 `body` 一起进机器出口
    // （`.md` 孪生与 `llms-full.txt`），变成**作者从没写过的一行**。
    // 现在图直接读 `declaredRelations`，正文保持作者写的样子。
    //
    // `offset`/`end` 对声明来的引用没有意义（它不在原文里），给 -1：
    // 图只用 `target` 与 `label`，而替换/报错定位只走 `parseWikiLinks` 的结果。
    const refs: WikiLinkRef[] = [...parseWikiLinks(doc.body)];
    for (const target of doc.declaredRelations ?? []) {
      refs.push({ target, anchor: null, label: target, offset: -1, end: -1 });
    }

    for (const ref of refs) {
      const key = normalizeTarget(ref.target);
      const resolved = lookup.get(key);

      if (resolved === undefined) {
        // 找不到。**但要分两种**：是真的没有这个页面，还是"有，只是有多个同名"。
        // 处置完全不同——前者改链接目标，后者加显式 slug；
        // 混成一句"断链"会把人引向错误的改法。
        const candidates = ambiguousTitles.get(key);
        if (candidates) {
          ambiguous.push({
            fromSlug: doc.slug,
            fromTitle: doc.title,
            target: ref.target,
            candidates,
          });
        } else {
          broken.push({ fromSlug: doc.slug, fromTitle: doc.title, target: ref.target });
        }
        continue;
      }
      if (resolved === doc.slug) continue; // 自链接不构成入链

      targets.add(resolved);
      inboundCount.set(resolved, (inboundCount.get(resolved) ?? 0) + 1);

      const list = backlinks.get(resolved) ?? [];
      if (!list.some((b) => b.fromSlug === doc.slug)) {
        list.push({ fromSlug: doc.slug, fromTitle: doc.title, label: ref.label });
      }
      backlinks.set(resolved, list);
    }
  }

  // 稳定排序：输出必须可复现，否则每次构建的 diff 都在抖，
  // 而这会让「构建产物字节一致」这条契约失效。
  for (const list of backlinks.values()) {
    list.sort((a, b) => (a.fromSlug < b.fromSlug ? -1 : a.fromSlug > b.fromSlug ? 1 : 0));
  }
  broken.sort((a, b) =>
    a.fromSlug === b.fromSlug ? (a.target < b.target ? -1 : 1) : a.fromSlug < b.fromSlug ? -1 : 1,
  );

  const orphans = published
    .filter((d) => d.kind === 'wiki' && (inboundCount.get(d.slug) ?? 0) === 0)
    .map((d) => d.slug)
    .sort();

  return { bySlug, lookup, backlinks, outbound, broken, ambiguousTitles, ambiguous, orphans };
}

/** 解析一个 wiki 链接目标，返回其 URL；无法解析时返回 null。 */
export function resolverFor(graph: LinkGraph): (target: string) => string | null {
  return (target: string) => {
    const slug = graph.lookup.get(normalizeTarget(target));
    if (slug === undefined) return null;
    const doc = graph.bySlug.get(slug);
    return doc ? urlOf(doc) : null;
  };
}

/** 某个文档的所有 wiki 链接引用，供页面渲染使用。 */
export function refsOf(doc: Doc): WikiLinkRef[] {
  return parseWikiLinks(doc.body);
}
