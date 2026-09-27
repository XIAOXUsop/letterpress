/**
 * 把「读到的页面」组装成 `Doc`。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────
 *
 * 2026-09-24 实测（路线图阶段 4 第 5 项）：接一个异构内容集时，
 * 适配层写了 27 行，**其中只有 5 行是站点专属的**
 * （把 `audience:` 翻译成 `related:`）。
 *
 * 剩下 22 行**每个站点都要重写一遍同样的转换**：
 * 补 `summary`、把 `readContentPage` 的字段名对上 `Doc` 的字段名、
 * 填 `explicitSlug` / `draft` / `wikiKind`。
 *
 * > **那 22 行不是「适配」，是「接线」**——
 * > 而接线每站都重写，正是路线图说的那种重复维护。
 *
 * ⚠️ **为什么不能直接复用 `src/lib/content.ts` 里的 `toDoc`**：
 * 那个文件 `import { getCollection } from 'astro:content'`，
 * **裸 Node 加载不了**（实测报 `Only URLs with a scheme in: file, data, node`）。
 * 它服务的是构建期（拿到的是 Astro 的 `CollectionEntry`），
 * 而这里服务的是**读源码**那条路径（拿到的是 `readContentPage` 的返回值）。
 *
 * 两者的**输入形状不同**、**运行环境不同**，所以各有一份组装逻辑是合理的；
 * 但**输出的 `Doc` 形状必须一致**——那才是这里的契约。
 *
 * ── 它刻意不做什么 ──────────────────────────────────────────────────
 *
 * **不知道任何站点的字段名。** `audience:` / `tags` / `audiences` 这些
 * 都要由调用方自己翻译好再传进来（`relations` 参数）。
 * 把「字段名翻译」放进核心，就是把站点展示逻辑又塞回核心——
 * 与路线图第 6 项（剥离站点专属逻辑）正好相反。
 */

/** 一个「读到的页面」。与 `readContentDirs` 的返回值同形。 */
export interface ReadPage {
  readonly slug: string;
  readonly explicitSlug?: boolean;
  readonly title: string;
  /** 知识类型（concept / entity / synthesis）。**不是** `Doc.kind`。 */
  readonly kind: string;
  readonly body: string;
  readonly sources: readonly { sourceId: string; revision: string; locator: string }[];
  readonly related: readonly string[];
  /**
   * 顶层 `summary`。
   *
   * ⚠️ **`readContentPage`（单个）不返回它，`readContentDirs`（多个）返回。**
   * 两者都要，因为前者服务检索（不需要摘要），
   * 后者服务「读完一整个语料再组装」这条路径。
   */
  readonly summary?: string;
}

export interface PageToDocOptions {
  /**
   * 顶层 `summary:`。
   *
   * ⚠️ **2026-09-28 改：现在默认从 `page.summary` 取。**
   * `readContentDirs` 已经顺带补上它（此前只有逐个 `readContentPage` 的路径要自己补，
   * 而那段代码里最容易漏的是 `.sort()`）。显式传入仍然优先——
   * `readContentPage` 出来的页面没有 `summary`，那种场景由调用方给。
   */
  readonly summary?: string;
  /** `Doc.kind`：文档类型。默认 `'wiki'`。 */
  readonly docKind?: 'post' | 'wiki';
  /**
   * 关系声明。**由调用方翻译好**——核心不认识任何站点的字段名。
   *
   * > 这一条是「站点无关」的关键：适配层把 `audience:` 变成这个数组，
   * > 而核心只看到「一组关系」。
   */
  readonly relations?: readonly string[];
  /** 草稿不进图（`buildGraph` 默认也会滤，但显式给出更清楚）。 */
  readonly draft?: boolean;
  /** slug 是不是显式指定的。影响 lint 的「中文 slug」告警分级。 */
  readonly explicitSlug?: boolean;
}

/**
 * 组装成 `Doc`。
 *
 * ⚠️ **不要在这里加 `id`**：`Doc.id` 是**稳定身份**（改名后不变），
 * 它来自 frontmatter 的 `id:`，而 `readContentPage` 不读那个字段。
 * 要用 id 的调用方（`content-manifest`）走构建期那条路，不走这里。
 */
export function pageToDoc(page: ReadPage, options: PageToDocOptions = {}) {
  return {
    kind: options.docKind ?? 'wiki',
    slug: page.slug,
    title: page.title,
    summary: options.summary ?? page.summary ?? '',
    body: page.body,
    sources: page.sources,
    wikiKind: page.kind,
    // ⚠️ 字段名是 `declaredRelations`，**不是** `related`。
    // 传错键会被 `?? []` 静静兜成空数组——摘要照样算得出，只是永远对不上。
    declaredRelations: options.relations ?? page.related,
    explicitSlug: options.explicitSlug ?? page.explicitSlug ?? false,
    draft: options.draft ?? false,
  };
}
