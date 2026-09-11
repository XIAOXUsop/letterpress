/**
 * 从 markdown 正文抽取目录。
 *
 * ── 这里有一个必须做对、做错了又很难发现的地方 ──────────────────────
 *
 * 目录里的锚点 id **必须和 Astro 渲染标题时生成的 id 完全一致**。
 * 不一致的后果是：目录看起来正常、点下去页面不动（或跳到别处），
 * 而构建、测试、lint **全部不会报错**。
 *
 * 所以这里用 `github-slugger`——Astro 内部用的就是同一个库同一个版本。
 * 自己写一个「差不多的」slug 函数是行不通的：中文、行内代码、
 * 重复标题的 `-1` 后缀，每一处细节都得对齐。
 *
 * 即便如此仍然可能随 Astro 升级而漂移，所以 `npm run verify` 里有一条
 * 打在**构建产物**上的断言：把这里算出的 id 和 dist 里真实的 `<h2 id>` 逐个比对。
 * 纯函数测试测不到这种耦合。
 */

import GithubSlugger from 'github-slugger';

export interface TocEntry {
  /** 层级：2 = h2，3 = h3 */
  readonly depth: 2 | 3;
  /** 纯文本标题，用于显示 */
  readonly text: string;
  /** 锚点 id，与 Astro 渲染出的 `<h2 id>` 一致 */
  readonly id: string;
}

/** 代码围栏——里面的 `#` 不是标题。 */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * 把 markdown 行内标记剥成纯文本。
 *
 * 目标不是「正确的 markdown 解析」，而是**和渲染器看到的文本一致**——
 * 因为 slug 是由渲染后的文本算出来的。
 */
export function stripInlineMarkdown(text: string): string {
  return (
    text
      // 行内代码：去掉反引号但**保留内容**——`用 `[[x]]` 连起来`
      // 的渲染文本是「用 [[x]] 连起来」，反引号本身不出现
      .replace(/`([^`]*)`/g, '$1')
      // 图片：保留 alt
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // 链接：保留文字
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // 强调
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')
      // HTML 标签
      .replace(/<[^>]+>/g, '')
      .trim()
  );
}

/**
 * 抽取 h2 与 h3。
 *
 * 只要这两级：h1 是文章标题本身，h4 及以下太细，
 * 放进目录会让它变成一份「大纲」而不是「导航」。
 */
export function extractToc(markdown: string): TocEntry[] {
  const slugger = new GithubSlugger();
  const entries: TocEntry[] = [];
  let inFence = false;
  let fenceMarker = '';

  for (const line of markdown.split('\n')) {
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = (fence[1] ?? '')[0] ?? '';
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;

    const depth = (match[1] ?? '').length as 2 | 3;
    const raw = match[2] ?? '';
    const text = stripInlineMarkdown(raw);
    if (text === '') continue;

    /**
     * **每一次 slug 调用都必须发生**，包括会被跳过的标题。
     * github-slugger 是状态化的：重复标题会得到 `-1`、`-2` 后缀。
     * 如果跳过某个标题不调用它，后面所有重复标题的编号都会错位。
     */
    const id = slugger.slug(text);

    if (depth === 2 || depth === 3) entries.push({ depth, text, id });
  }

  return entries;
}

/**
 * 是否值得显示目录。
 *
 * 太短的短文加目录只会增加噪声——读者一眼就看完的东西，
 * 不需要一份「导航」。阈值取 3 个二级标题。
 */
export function shouldShowToc(entries: readonly TocEntry[]): boolean {
  return entries.filter((e) => e.depth === 2).length >= 3;
}
