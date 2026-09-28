/**
 * 读内容页的 frontmatter 里那些**结构化字段**，供影响分析与金标检查共用。
 *
 * ── 为什么要有这个文件 ──────────────────────────────────────────────
 *
 * `sources` 是**块状数组**（`- sourceId:` 下面缩进跟着 `revision`、`locator`），
 * `frontmatterField` 取不到它——它只匹配顶层的 `field: value`。
 * 所以两边都自己写了一段逐行扫描：
 *
 *   - `scripts/wiki-impact.mjs`（人工触发的命令）
 *   - `scripts/check-impact.mjs`（进 CI 的金标检查）
 *
 * **两份拷贝不同步的后果不是报错，是两个命令对同一页给出不同的引用集**，
 * 而两边都是绿的。本仓库已经吃过三次同族亏（frontmatter 两套解析、
 * `urlFor` 与 remark 插件各写一份前缀、`related` 方括号处理不一致），
 * 所以这次直接抽出来共用。
 *
 * 与 `frontmatter.ts` 的分工：那边解析**标量**字段（title / summary），
 * 这里解析**嵌套结构**（sources 的块状数组）。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { frontmatterField } from './frontmatter.ts';
import { resolveSlug } from './slug.ts';

/** 页面上一处来源引用。与 `Doc.sources` 同形。 */
export interface PageSourceRef {
  readonly sourceId: string;
  readonly revision: string;
  readonly locator: string;
}

/** 页面上的复核记录。 */
export interface PageReview {
  readonly status: string;
  readonly checkedAt?: string;
  /**
   * 复核当时的正文摘要。
   *
   * ⚠️ **2026-09-24 补上**：原先 `parseReview` 只抓 `status` 与 `checkedAt`，
   * 而 frontmatter 里明明还写着 `contentDigest`。
   * 后果不是报错，是**静默少一个字段**——于是「拿 `readContentPage` 的 review
   * 去比摘要」这件事根本做不了（`undefined` 被 `?? null` 变成「没写」，
   * 6 个知识页全被跳过，而门禁输出的是一排「跳过」和一句「全部一致」）。
   *
   * > **一个检查静默跳过全部被测对象，然后报告通过**——
   * > 这是断言盲区里最危险的一种（「被测集合是空的」）。
   * > 这次是靠它**输出里那 6 行「跳过」**被看见的，
   * > 而不是靠退出码。
   *
   * 构建侧走 Astro 的 `content.config.ts`（那里 `contentDigest` 有定义），
   * 所以产物一直是对的——**只有读源码这条路径拿不到**。
   */
  readonly contentDigest?: string;
}

/** 读一页内容，取出检索与影响分析共需要的字段。 */
export function readContentPage(dir: string, file: string): {
  readonly slug: string;
  readonly explicitSlug: boolean;
  readonly title: string;
  readonly kind: string;
  readonly updated: string;
  /**
   * 本页的来源引用。
   *
   * ⚠️ **字段名与 `Doc.sources` 一致，不叫 `refs`。**
   * 它原先叫 `refs`（对齐 `ImpactPage`），而 `context-pack.ts` 读的是
   * `sources`——于是 `wiki-ask` 把本页传进去之后，证据**全部静默丢失**
   * （`doc.sources` 恒为 undefined，被 `?? []` 变成「没有来源」）。
   * 2026-09-24 由阶段 3 退出条件「答案能定位到证据」抽查时发现。
   *
   * 两种命名都「说得通」，而**说得通恰恰是危险的地方**——
   * 一个模块用 A、一个用 B，TS 不会报错（可选字段读不到就是 undefined）。
   * **统一到 `Doc` 的叫法。**
   */
  readonly sources: readonly PageSourceRef[];
  readonly review?: PageReview;
  readonly related: readonly string[];
  /** frontmatter 之后的正文（不含 frontmatter）。**已 trim，与 Astro 的 `entry.body` 同口径。** */
  readonly body: string;
} {
  const source = readFileSync(join(dir, file), 'utf8');
  const end = source.indexOf('\n---', 3);
  const block = source.slice(3, end === -1 ? undefined : end);
  /*
   * ⚠️ **`trim()` 不是可选的。**
   *
   * 2026-09-24 实测：不 trim 时正文以一个空行开头，
   * 而 `scripts/wiki-review.mjs` 用它算 `contentDigest`——
   * **三个知识页算出的摘要与 frontmatter 里写的完全不同**，
   * 于是 `--list` 会把它们全报成 stale，看起来像「机制坏了」。
   *
   * 差异不止首尾：frontmatter 的 `---` 之后往往紧跟一个空行，
   * 切出来就是 `\n` + 正文。
   *
   * > 这个 `trim()` 的必要性原先只写在 `wiki-review.mjs` 的注释里
   * > （那份实现连同注释一起被删掉，换成了调用本模块）。
   * > **约定写在调用方而不是被调用方，换实现时就丢了**——
   * > 而丢失之后症状是「静默算错」，不是报错。
   *
   * 口径依据：实测 Astro 打印的 `entry.body` 长度 2166，
   * 而直接从文件切出来是 2168（前后各一个换行）。
   */
  const body = end === -1 ? source : source.slice(source.indexOf('\n', end + 1) + 1).trim();

  // sources 是块状数组，逐条抓 sourceId / revision / locator
  const refs: PageSourceRef[] = [];
  let current: { sourceId: string; revision: string; locator: string } | null = null;
  for (const line of block.split('\n')) {
    const sid = /^\s*-\s*sourceId:\s*(.+?)\s*$/.exec(line);
    if (sid) {
      if (current) refs.push(current);
      current = { sourceId: sid[1], revision: '', locator: '' };
      continue;
    }
    if (!current) continue;
    const rev = /^\s*revision:\s*(.+?)\s*$/.exec(line);
    if (rev) current.revision = rev[1];
    const loc = /^\s*locator:\s*(.+?)\s*$/.exec(line);
    if (loc) current.locator = loc[1];
  }
  if (current) refs.push(current);

  // review 是一个块（`review:` 下面缩进跟着 status / checkedAt），
  // 与 sources 一样只能逐行扫，取顶层字段会取错。
  const review = parseReview(block);

  return {
    explicitSlug: Boolean(frontmatterField(source, 'slug')?.trim()),
    /*
     * ⚠️ **2026-09-24 改：这里原先是 `file.replace(/\.mdx?$/, '')`——直接用文件名。**
     *
     * 那样做与**构建侧不一致**，而那个不一致有用户可见后果。
     * 构建侧（`src/lib/content.ts:80`）走的是：
     *
     *     resolveSlug(data.title, data.slug, entry.id)
     *
     * 即 **显式 `slug:` > 文件名（经 `slugify`）> 标题**。
     * 而这里既**不读显式 `slug:`**，也**不跑 `slugify`**。
     *
     * 实测（`knowledge/fixtures/second-site/Export Notes.md`）：
     *
     *     read-page  → 「Export Notes」
     *     构建侧     → 「导出说明」（因为 frontmatter 写了 `slug: 导出说明`）
     *
     * **后果不是「URL 不好看」**——是 `wiki:ask` 回答里的 `docId` 与
     * `content-manifest.json` 里的 `wiki:导出说明` **对不上**，
     * 而订阅者正是靠那个 id 做增量同步的。
     *
     * > 为什么这么久没人发现：**本站 0 篇写了 `slug:`**，
     * > 而文件名全是小写连字符（`slugify` 对它们是恒等的）。
     * > **一个在本站永远不触发的分支，就是没有守卫的分支。**
     * > 它是在异构 fixture 上第一次暴露的（迭代 AR）。
     */
    slug: resolveSlug(
      frontmatterField(source, 'title') ?? file.replace(/\.mdx?$/, ''),
      frontmatterField(source, 'slug'),
      file.replace(/\.mdx?$/, ''),
    ),
    title: frontmatterField(source, 'title') ?? file,
    // post 没有 kind 字段，wiki 才有——**别与 Doc.kind 搞混**（那个是 post/wiki）
    kind: frontmatterField(source, 'kind') ?? '',
    updated: frontmatterField(source, 'updated') ?? '',
    sources: refs,
    ...(review ? { review } : {}),
    related: relationList(source, 'related'),
    body,
  };
}

/**
 * 读一个**关系列表**字段（`related:` / 站点自己的 `audience:` …）。
 *
 * ⚠️ **2026-09-28 抽出来的。** 原先这段解析只存在于 `readContentPage` 里，
 * 于是**站点把字段改名就得把同样的逻辑重写一遍**——
 * 而「剥方括号」那一行是最容易漏的：不剥的话 `related: [a, b]` 拿到
 * `"[a, b]"`，第一项变成 `"[a"`，**所有关系都解析不出来**，
 * 症状是「候选页全空」而不是报错。
 *
 * > 阶段 4 第 1 项要消除的正是这种重复。而**重写解析逻辑比换个字段名贵得多**——
 * > 所以它该在核心里，站点只负责告诉核心**字段叫什么**。
 *
 * @param field 字段名。本站叫 `related`，别的站点可以叫 `audience`。
 */
export function relationList(source: string, field: string): string[] {
  return (frontmatterField(source, field) ?? '')
    // ⚠️ 必须先剥方括号：`frontmatterField` 返回**原始字符串**。
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 解析 frontmatter 里的 `review:` 块。
 *
 * ⚠️ **这个函数犯过两次同型的错，第二次只修了一半。**
 *
 * **第一次**（2026-09-24 迭代 I 发现）：它用 `(?=\n\S|\s*$)`，
 * 而在**多行模式**下 `\s*` 能匹配**零个字符**、`$` 立刻成立——
 * 于是它在 `review:` 后面当场截断，**捕获组恒为空**，函数恒返回 `undefined`。
 * 症状是「复核状态读不到」，而**没有任何报错**。
 *
 * **第二次**（2026-09-24 迭代 AO 发现）：改成 `(?=\n[^\s]|\r?\n?$)`，
 * 空字符串的问题解决了（`status` 能读到），
 * 但**捕获组仍然只有第一行**——
 * 实测 `review:` 块有 `status` / `checkedAt` / `contentDigest` 三行，
 * 拿到的 `m[1]` 是 `"  status: reviewed"`。
 *
 * 根因：**`\r?\n?$` 里的 `\n?` 是可选的**，
 * 而多行模式下 `$` 匹配**每一行**的行尾 ——
 * 于是它在第一行末零消耗地成立，根本没等 `\r?\n` 那个分支。
 *
 * > **「修好了」和「修对了」不是一回事**：第一次的验收标准是
 * > 「能读到 status」，通过了；而「能读到全部三行」从没被测过。
 * > **判据只覆盖了故障的一个切面**——而那次修复是被另一个症状逼出来的，
 * > 不是被「完整的行为」逼出来的。
 *
 * 现在的判据是行为本身：**捕获组必须含块里全部缩进行**。
 * `verify` 侧有专门一条对账（`check-review-status.mjs` 逐页比摘要），
 * 它在第二次修好之前一直是「6 个全部跳过」——
 * **一个静默跳过全部被测对象的检查，等于没有检查。**
 */
function parseReview(block: string): PageReview | undefined {
  /*
   * 块 = 「从 review: 后到下一个**顶层**字段之前」的所有**缩进**行，
   * **外加夹在它们之间的空行**。
   *
   * ⚠️ **这里试过三次正则，三次都不对。**
   *
   * ① `(?=\n[^\s]|\r?\n?$)` —— `\r?\n?` 的 `\n?` 可选，
   *    多行模式下 `$` 匹配每行行尾，于是在 `status` 行末**零消耗**成立，
   *    捕获组只有第一行。
   * ② `(?:^[ \t]+.*\r?\n?)+` —— 能吃全部缩进行，但**遇到空行就停**：
   *    `review:` 块里夹一个空行（YAML 里完全合法），
   *    后面的 `contentDigest` **静默丢失**。
   * ③ 在 ② 后面补一个「吃空行」的组 —— **仍然不对**：
   *    两组都要求「行」在前，而空行恰好把它们卡在中间。
   *
   * > 根因是**同一个**：用正则同时表达「缩进」与「直到下一个顶层字段」
   * > 这两件事，就得处理它们在空行处交错的情形——
   * > 而 `\r?\n?` 这种**可选量词**正是让边界悄悄提前成立的元凶。
   *
   * 现在**不用正则**：逐行扫，规则一句话说完——**缩进行属于块，空行忽略，
   * 任何非缩进的非空行结束块**。可读性换来的正确性，在这个场景更划算。
   */
  const lines = block.split(/\r?\n/);
  const start = lines.findIndex((l) => /^review:[ \t]*$/.test(l));
  if (start === -1) return undefined;

  const fields: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue; // 空行不终止块
    if (!/^[ \t]/.test(line)) break; // 下一个顶层字段 → 块结束
    fields.push(line);
  }
  if (fields.length === 0) return undefined;

  const get = (k: string) =>
    new RegExp(`^[ \\t]+${k}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(fields.join('\n'))?.[1];
  const status = get('status');
  if (!status) return undefined;
  const checkedAt = get('checkedAt');
  const contentDigest = get('contentDigest');
  return {
    status,
    ...(checkedAt ? { checkedAt } : {}),
    ...(contentDigest ? { contentDigest } : {}),
  };
}

/**
 * 读一个内容目录下的全部页面。
 *
 * 两个目录都要读（wiki 与 posts）：此前只读 wiki，于是文章里那些
 * 日期化的规范 URL 引用**在影响分析里根本不存在**——
 * 不是漏报，是这一层压根没进语料。
 */
export function readContentDirs(
  dirs: readonly string[],
  options: {
    readonly relationField?: string;
    /**
     * 文档类型。**本站传 `undefined` 时按目录判定不了**——
     * 所以这里必须由调用方说，否则 `pageToDoc` 只能一律当 wiki，
     * 于是 post 里写的关系会被照收（与构建侧相反）。
     */
    readonly docKind?: 'post' | 'wiki';
  } = {},
): {
  /**
   * ⚠️ **不是 `ReturnType<typeof readContentPage>`**——那不含 `summary`，
   * 而这里实际返回的页**多一个字段**。
   * 写成前者时运行着没问题、类型上却报「Property 'summary' does not exist」，
   * 于是调用方只能去加 `as any` 或者干脆不读它——
   * **类型签名与运行时形状脱节，编译器就成了摆设。**
   */
  readonly pages: (ReturnType<typeof readContentPage> & {
    readonly summary: string;
    readonly docKind?: 'post' | 'wiki';
    /** 2026-09-28 补：`readContentPage` 不读它，只有读多个目录时才有。 */
    readonly original?: { readonly reason: string };
  })[];
  readonly counts: ReadonlyMap<string, number>;
} {
  const pages = [];
  const counts = new Map<string, number>();
  /*
   * ⚠️ **2026-09-28 加 `relationField`。**
   *
   * 本站的关系声明叫 `related:`，而异构站点可能叫 `audience:`。
   * `readContentPage` **只认 `related` 这个名字**——实测
   * `knowledge/fixtures/second-site/` 那 9 篇全用 `audience:`，
   * `page.related` 在那里恒为 `[]`。
   *
   * 不给这个参数时，`related` 走 `readContentPage` 原有的解析；
   * 给了就用 `relationList` 按**那个字段名**重解析并覆盖——
   * **核心依然不认识任何站点的字段名，它只是收一个字符串。**
   */
  const relationField = options.relationField;
  for (const dir of dirs) {
    const files = readdirSync(dir)
      .filter((f) => /\.mdx?$/.test(f))
      .sort();
    counts.set(dir, files.length);
    for (const file of files) {
      const page = readContentPage(dir, file);
      const full = join(dir, file);
      const source = readFileSync(full, 'utf8');
      /*
       * ⚠️ `original` 是**嵌套块**（`original:` 下面缩进一行 `reason:`），
       * 而 `frontmatterField` **只认顶层标量**——直接问它会拿到 `''`。
       *
       * 它和 `review:` / `sources:` 一样是块，**但那几个由 `readContentPage`
       * 解析了**。`original` 当时漏了（2026-09-28 补）。
       *
       * 这里只取 `reason` 一行——`content.config.ts` 的 schema 也只要求它，
       * 多出来的键 zod 会剥掉，核心不必认识。
       */
      const originalMatch = /^ {2}reason:\s*(.+)$/m.exec(
        /^original:\s*$\n(?<block>(?:^[ \t]+.*\n?)*)/m.exec(source)?.groups?.block ?? '',
      );
      const originalReason = originalMatch?.[1]?.trim() || undefined;
      /*
       * ⚠️ **2026-09-28 加：顺带补上 `summary`。**
       *
       * 它是顶层标量，而 `readContentPage` 只解析**嵌套块**——
       * 所以拿不到是设计如此，不是漏了。原先每个要摘要的调用方都得
       * 自己重走一遍「遍历目录 → 读文件 → `frontmatterField`」，
       * **而那段代码里最容易漏的是 `.sort()`**：
       * 漏了它，页面顺序就取决于文件系统的返回顺序
       * （本机 NTFS 恰好已排序，于是**漏了也看不出**——
       *  与「本站 0 篇写 slug:，所以那个 bug 从未发作」同型）。
       *
       * 补在这里，`pageToDoc(page)` 不传 `summary` 也能算对摘要。
       * 四个现有调用方只用 `slug` / `sources` / `body`，**不受影响**。
       */
      pages.push({
        ...page,
        summary: frontmatterField(source, 'summary') ?? '',
        // ⚠️ **只在显式给了字段名时覆盖。** 不给就沿用 `readContentPage` 的
        // `related:` 解析——而那个解析与 `relationList` 是同一套逻辑
        // （`readContentPage` 内部就调它），所以两条路不会漂。
        ...(relationField ? { related: relationList(source, relationField) } : {}),
        ...(options.docKind ? { docKind: options.docKind } : {}),
        // ⚠️ **2026-09-28 补 `original`。**
        //
        // `content.ts` 的 `toDoc` 会带它（知识层专属，post 给 `undefined`），
        // 而读路径原先**完全不认识这个字段**——两条路径的 `Doc` 不等价。
        // **本站 3 篇 wiki 真的写了它**（`build-probe` / `design-tokens` /
        // `letterpress`），所以这不是「数据不存在」，是**读路径漏读**。
        //
        // 为什么至今没发作：`original` 唯一的消费者是 `content-manifest.ts`，
        // 而那走**构建期**的 `doc`。将来若有 lint 规则看它，读路径就会漏。
        //
        // ⚠️ **空 `reason` 不给**——`content.config.ts` 的 schema 要求
        // `min(1)`，而「空理由等于没声明」是那条注释的原话。
        ...(originalReason ? { original: { reason: originalReason } } : {}),
      });
    }
  }
  return { pages, counts };
}
