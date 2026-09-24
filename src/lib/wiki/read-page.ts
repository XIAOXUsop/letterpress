/**
 * 读内容页的 frontmatter 里那些**结构化字段**，供影响分析与金标检查共用。
 *
 * ── 为什么要有这个文件 ──────────────────────────────────────────────
 *
 * `sources` / `review` / `related` 是 YAML 结构字段，不能用标量解析器读取。
 * 它们曾在两个命令里各自逐行扫描：
 *
 *   - `scripts/wiki-impact.mjs`（人工触发的命令）
 *   - `scripts/check-impact.mjs`（进 CI 的金标检查）
 *
 * **两份拷贝不同步的后果不是报错，是两个命令对同一页给出不同的引用集**，
 * 而两边都是绿的。本仓库已经吃过三次同族亏（frontmatter 两套解析、
 * `urlFor` 与 remark 插件各写一份前缀、`related` 方括号处理不一致），
 * 所以这次直接抽出来共用。
 *
 * 与 `frontmatter.ts` 的分工：那边限制建链接用的标量字段（title / slug），
 * 这里按 YAML 语义解析结构字段。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
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
  const block = source.slice(3, end === -1 ? undefined : end).replace(/\r$/, '');
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

  // Astro 读取的是 YAML。结构字段也必须按 YAML 解析，否则合法的行内数组
  // 会被漏掉，且另一个顶层块的 revision/locator 会误覆盖上一条来源。
  const parsed = parseDocument(block);
  if (parsed.errors.length > 0) {
    throw new Error(`${file} 的 frontmatter 无法解析：${parsed.errors[0].message}`);
  }
  const data = parsed.toJS() as Record<string, unknown> | null;
  const sources = data?.sources;
  if (sources != null && !Array.isArray(sources)) {
    throw new Error(`${file} 的 sources 必须是数组。`);
  }
  const refs: PageSourceRef[] = (sources ?? []).map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file} 的 sources 条目必须是对象。`);
    }
    const ref = item as Record<string, unknown>;
    return {
      sourceId: String(ref.sourceId ?? ''),
      revision: String(ref.revision ?? ''),
      locator: String(ref.locator ?? ''),
    };
  });
  const rawReview = data?.review;
  const review = rawReview && typeof rawReview === 'object' && !Array.isArray(rawReview)
    ? rawReview as Record<string, unknown>
    : null;
  const related = data?.related;
  if (related != null && !Array.isArray(related)) {
    throw new Error(`${file} 的 related 必须是数组。`);
  }

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
    ...(review?.status ? { review: {
      status: String(review.status),
      ...(review.checkedAt ? { checkedAt: String(review.checkedAt) } : {}),
      ...(review.contentDigest ? { contentDigest: String(review.contentDigest) } : {}),
    } } : {}),
    related: (related ?? []).map((item: unknown) => String(item)),
    body,
  };
}

/**
 * 读一个内容目录下的全部页面。
 *
 * 两个目录都要读（wiki 与 posts），且必须递归，与 Astro 的内容 glob 一致。
 * 否则文章或子目录里的来源会从影响分析与检索中消失。
 */
export function readContentDirs(dirs: readonly string[]): {
  readonly pages: ReturnType<typeof readContentPage>[];
  readonly counts: ReadonlyMap<string, number>;
} {
  const pages = [];
  const counts = new Map<string, number>();
  for (const dir of dirs) {
    const files: string[] = [];
    const walk = (relativeDir: string): void => {
      for (const entry of readdirSync(join(dir, relativeDir), { withFileTypes: true })) {
        const name = join(relativeDir, entry.name);
        if (entry.isDirectory()) walk(name);
        else if (entry.isFile() && /\.mdx?$/.test(entry.name)) files.push(name);
      }
    };
    walk('');
    files.sort();
    counts.set(dir, files.length);
    for (const file of files) pages.push(readContentPage(dir, file));
  }
  return { pages, counts };
}
