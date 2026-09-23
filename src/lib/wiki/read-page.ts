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
}

/** 读一页内容，取出检索与影响分析共需要的字段。 */
export function readContentPage(dir: string, file: string): {
  readonly slug: string;
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
  /** frontmatter 之后的正文（不含 frontmatter）。 */
  readonly body: string;
} {
  const source = readFileSync(join(dir, file), 'utf8');
  const end = source.indexOf('\n---', 3);
  const block = source.slice(3, end === -1 ? undefined : end);
  const body = end === -1 ? source : source.slice(source.indexOf('\n', end + 1) + 1);

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
    slug: file.replace(/\.mdx?$/, ''),
    title: frontmatterField(source, 'title') ?? file,
    // post 没有 kind 字段，wiki 才有——**别与 Doc.kind 搞混**（那个是 post/wiki）
    kind: frontmatterField(source, 'kind') ?? '',
    updated: frontmatterField(source, 'updated') ?? '',
    sources: refs,
    ...(review ? { review } : {}),
    // ⚠️ 必须先剥方括号：`frontmatterField` 返回**原始字符串**，
    // `related: [a, b]` 拿到的是 `"[a, b]"`。不剥的话第一项变成 `"[a"`，
    // **所有关系都解析不出来**——症状是「候选页全空」而不是报错。
    related: (frontmatterField(source, 'related') ?? '')
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(/[、,，]/)
      .map((s) => s.trim())
      .filter(Boolean),
    body,
  };
}

/**
 * 解析 frontmatter 里的 `review:` 块。
 *
 * ⚠️ **这里的正则原先有个静默 bug**（2026-09-24 发现）：
 * 它用 `(?=\n\S|\s*$)` 表示「直到下一个顶层字段或块尾」，
 * 而在**多行模式**下 `\s*` 能匹配**零个字符**，`$` 又立刻成立——
 * 于是它在 `review:` 后面当场截断，**捕获组恒为空字符串**，
 * `get('status')` 永远取不到值，**函数恒返回 `undefined`**。
 *
 * 症状是「复核状态读不到」，而**没有任何报错**。
 * 之所以藏了这么久：`check-questions.mjs` 只需要 `body`，
 * 从不读 review；而 `context-pack.ts` 那时还没接上（迭代 L）。
 * **两个缺陷各自都成立，合起来才暴露。**
 *
 * 修法：明确用 `(?=\n[^\s])`（下一个**顶层**字段）或 `(?=\n?$)`（块尾），
 * **不用 `\s*$`**——那个组合在多行模式下恒真。
 */
function parseReview(block: string): PageReview | undefined {
  const m = /^review:[ \t]*\r?\n([\s\S]*?)(?=\n[^\s]|\r?\n?$)/m.exec(block);
  if (!m) return undefined;
  const get = (k: string) =>
    new RegExp(`^[ \\t]+${k}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(m[1] ?? '')?.[1];
  const status = get('status');
  if (!status) return undefined;
  const checkedAt = get('checkedAt');
  return checkedAt ? { status, checkedAt } : { status };
}

/**
 * 读一个内容目录下的全部页面。
 *
 * 两个目录都要读（wiki 与 posts）：此前只读 wiki，于是文章里那些
 * 日期化的规范 URL 引用**在影响分析里根本不存在**——
 * 不是漏报，是这一层压根没进语料。
 */
export function readContentDirs(dirs: readonly string[]): {
  readonly pages: ReturnType<typeof readContentPage>[];
  readonly counts: ReadonlyMap<string, number>;
} {
  const pages = [];
  const counts = new Map<string, number>();
  for (const dir of dirs) {
    const files = readdirSync(dir)
      .filter((f) => /\.mdx?$/.test(f))
      .sort();
    counts.set(dir, files.length);
    for (const file of files) pages.push(readContentPage(dir, file));
  }
  return { pages, counts };
}
