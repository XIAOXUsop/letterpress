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

/** 读一页内容，取出影响分析需要的四样东西。 */
export function readContentPage(dir: string, file: string): {
  readonly slug: string;
  readonly title: string;
  readonly refs: readonly PageSourceRef[];
  readonly related: readonly string[];
} {
  const source = readFileSync(join(dir, file), 'utf8');
  const end = source.indexOf('\n---', 3);
  const block = source.slice(3, end === -1 ? undefined : end);

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

  return {
    slug: file.replace(/\.mdx?$/, ''),
    title: frontmatterField(source, 'title') ?? file,
    refs,
    // ⚠️ 必须先剥方括号：`frontmatterField` 返回**原始字符串**，
    // `related: [a, b]` 拿到的是 `"[a, b]"`。不剥的话第一项变成 `"[a"`，
    // **所有关系都解析不出来**——症状是「候选页全空」而不是报错。
    related: (frontmatterField(source, 'related') ?? '')
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(/[、,，]/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
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
