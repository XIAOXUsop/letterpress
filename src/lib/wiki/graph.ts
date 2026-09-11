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
  /** markdown 正文（不含 frontmatter） */
  readonly body: string;
  /** 作者是否显式指定过 slug（用于 lint 提示中文 URL 的代价） */
  readonly explicitSlug: boolean;
  readonly draft: boolean;
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
  /** 没有任何入链、且不是入口页的文档 slug */
  readonly orphans: readonly string[];
}

/** 计算文档的对外 URL。文章与 wiki 页共用一套规则，便于互相链接。 */
export function urlOf(doc: Doc): string {
  return doc.kind === 'wiki' ? `/wiki/${doc.slug}/` : `/${doc.slug}/`;
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

  for (const doc of published) {
    bySlug.set(doc.slug, doc);
    // 两个解析入口：slug 本身，以及标题。作者写 [[某页]] 时想的通常是标题。
    lookup.set(normalizeTarget(doc.slug), doc.slug);
    if (!lookup.has(normalizeTarget(doc.title))) {
      lookup.set(normalizeTarget(doc.title), doc.slug);
    }
  }

  const backlinks = new Map<string, Backlink[]>();
  const outbound = new Map<string, Set<string>>();
  const broken: BrokenLink[] = [];
  const inboundCount = new Map<string, number>();

  for (const doc of published) {
    const targets = new Set<string>();
    outbound.set(doc.slug, targets);

    for (const ref of parseWikiLinks(doc.body)) {
      const resolved = lookup.get(normalizeTarget(ref.target));

      if (resolved === undefined) {
        broken.push({ fromSlug: doc.slug, fromTitle: doc.title, target: ref.target });
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

  return { bySlug, lookup, backlinks, outbound, broken, orphans };
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
