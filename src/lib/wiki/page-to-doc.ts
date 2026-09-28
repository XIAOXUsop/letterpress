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
  /**
   * 文档类型。`readContentDirs` 传了 `docKind` 时会带在这里
   * ——**没有它，`pageToDoc` 只能一律当 wiki**，于是 post 里写的关系会被照收，
   * 与构建侧（`kind === 'wiki' ? related : []`）相反。
   */
  readonly docKind?: 'post' | 'wiki';
  /**
   * 复核状态。`readContentPage` 在有 `review:` 块时会给它，**没有时键不出现**
   * （不是 `undefined`）——所以这里是可选的。
   */
  readonly review?: {
    readonly status: 'pending' | 'reviewed' | 'stale';
    readonly checkedAt?: string;
    readonly contentDigest?: string;
  };
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
  /**
   * `Doc.kind`：文档类型。默认 `'wiki'`。
   *
   * ⚠️ **它同时决定「这一页算不算有关系」——与构建侧同一口径。**
   *
   * 构建路径（`src/lib/content.ts` 的 `toDoc`）写的是
   * `kind === 'wiki' ? data.related : []`，而 `src/content.config.ts` 的
   * **posts schema 里没有 `related` 这个键**——所以一篇文章里写了
   * `related:` 会被 zod 静静剥掉，而读路径会把它保留并连进图。
   *
   * > 后果不是「多了一条边」：**同一页在构建产物与 CLI 回答里关系不同**，
   * > 而 `wiki:ask` 的 `docId` 正是订阅者做增量同步的键。
   *
   * 本仓库 posts 里 0 篇写 `related:`，所以**这个分歧从未发作**——
   * 而「新站点会用 posts 且写了关系」是很正常的一件事。
   * 两边必须同口径，所以判据放在这里。
   */
  readonly docKind?: 'post' | 'wiki';
  /**
   * 关系声明。**由调用方翻译好**——核心不认识任何站点的字段名。
   *
   * > 这一条是「站点无关」的关键：适配层把 `audience:` 变成这个数组，
   * > 而核心只看到「一组关系」。
   */
  readonly relations?: readonly string[];
  /**
   * 复核状态。**只有 `docKind: 'wiki'` 才会用上它**——
   * 与构建侧 `kind === 'wiki' ? data.review : undefined` 同口径。
   */
  readonly review?: { readonly status: 'pending' | 'reviewed' | 'stale'; readonly checkedAt?: string; readonly contentDigest?: string };
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
  // ⚠️ **`options.docKind` 优先于 `page.docKind`**——显式给的更近，也更明确。
  // 两者都没有时默认 `'wiki'`（本站绝大多数内容是知识页）。
  const docKind = options.docKind ?? page.docKind ?? 'wiki';
  /*
   * ⚠️ **`post` 拿不到知识层专属的三样**：`declaredRelations` / `review` / `wikiKind`。
   *
   * 这与 `src/lib/content.ts` 的 `toDoc` **四处** `kind === 'wiki' ? … : …`
   * 完全同口径（`related` / `review` / `original` / `wikiKind`）。
   *
   * > **口径必须逐字对齐，否则两处会各改一处。** 2026-09-28 实测：
   * > 修好 `related` 之后，`wikiKind` 与 `review` 仍与构建侧相反。
   * > 本仓库 posts 里 0 篇写这些字段，所以三处分歧**都没发作过**。
   *
   * `wikiKind` 落成 `undefined`（而不是 `'concept'`）——那是构建侧的做法，
   * 而 `lint` 用 `doc.wikiKind ?? ''` 兜，两者兼容。
   */
  const isWiki = docKind === 'wiki';
  /*
   * ⚠️ **三处「post 拿不到」必须写成同一种形状。**
   *
   * 2026-09-28 实测过它们曾经是三种写法：
   *   `...(isWiki ? { wikiKind } : {})` / `...(isWiki && review ? { review } : {})` /
   *   `docKind === 'post' ? [] : …`
   * **都正确，但它们互为掩护**——变异验证时我只撤掉 `review` 的内层条件，
   * 门禁照样绿，因为外层 `const review = isWiki ? … : undefined` 挡住了。
   *
   * > **同一个约束写 N 遍，就等于它有 N 个可以只改一处的漏洞。**
   * > 现在统一成「取值时判一次 + 展开时用同一个变量」。
   */
  const review = isWiki ? options.review ?? page.review : undefined;
  return {
    kind: docKind,
    slug: page.slug,
    title: page.title,
    summary: options.summary ?? page.summary ?? '',
    body: page.body,
    sources: page.sources,
    // ⚠️ **`post` 的 `wikiKind` 与 `review` 整个键都不出现**——
    // 与构建侧同一口径。
    //
    // ⚠️ **而且是「键不出现」而不是「键在、值是 undefined」**：
    // 两者用 `doc.wikiKind` 读起来一样，但 `Object.keys()` 与
    // `JSON.stringify` 会不同——而 `content-manifest` 正是把 `Doc`
    // 序列化出去的。`{ a: undefined }` 序列化成 `{}`，而 `hasOwnProperty`
    // 也会说它有——**两处都会不一致**。
    ...(isWiki ? { wikiKind: page.kind } : {}),
    ...(isWiki && review ? { review } : {}),
    // ⚠️ 字段名是 `declaredRelations`，**不是** `related`。
    // 传错键会被 `?? []` 静静兜成空数组——摘要照样算得出，只是永远对不上。
    //
    // ⚠️ **`post` 一律没有关系**——与构建侧 `toDoc` 的
    // `kind === 'wiki' ? data.related : []` 同一口径。
    // 读路径若照收，就与构建产物对不上（详见 `PageToDocOptions.docKind`）。
    declaredRelations: isWiki ? options.relations ?? page.related : [],
    explicitSlug: options.explicitSlug ?? page.explicitSlug ?? false,
    draft: options.draft ?? false,
  };
}
