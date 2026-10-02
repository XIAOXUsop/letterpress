/**
 * remark 插件：把 markdown 正文里的 `[[wiki-link]]` 变成真实链接。
 *
 * ── 为什么作用在 mdast 的文本节点上，而不是对原文跑正则 ─────────────
 *
 * 因为**跳过代码是由结构保证的，不是靠规则猜的**。
 *
 * 在 mdast 里，围栏代码块是 `code` 节点，行内代码是 `inlineCode` 节点，
 * 它们根本不是 `text` 节点。所以只要遍历时只看 `text`，代码里的
 * `[[foo]]` 自动不会被处理——不需要写「找出代码区间再跳过」那套逻辑，
 * 也就不会有那套逻辑写错的可能。
 *
 * 字符串入口（wikilink.ts）也先解析同样的 Markdown AST；
 * 但在构建管线里，AST 已经替我们做完了。
 *
 * ── 查找表怎么来 ────────────────────────────────────────────────────
 *
 * 通过 readContentPage 读取内容，再由 buildGraph 按生产或开发的草稿策略
 * 建立「slug → URL」和「标题 → URL」两张表。
 *
 * Astro 内容集合和源码读取的入口不同，但 slug、名字解析和草稿过滤共用核心。
 * 查找表不读取正文关系，避免构建期重复做全文链接分析。
 */

import { join, relative, sep } from 'node:path';
import type { Root, Text } from 'mdast';
import { visit, SKIP } from 'unist-util-visit';
import { decodeString } from 'micromark-util-decode-string';
import { normalizeTarget, parseWikiLinkText } from './wikilink.js';
import { buildGraph, urlOf, type Doc } from './graph.js';
import { collectFiles } from './frontmatter.js';
import { readContentPage } from './read-page.ts';

interface Lookup {
  readonly byName: ReadonlyMap<string, string>;
}

/**
 * 扫描内容目录，建立「名字 → URL」查找表。
 *
 * `base` 是部署子路径（GitHub Pages 项目站是 `/仓库名`）。
 * **必须由调用方传进来**：这个模块在 markdown 管线里执行，
 * 拿不到 Astro 的 `import.meta.env.BASE_URL`，而链接少了前缀
 * 在本地开发时完全看不出来。
 */
export function buildLookup(contentRoot: string, base = '/', options: { includeDrafts?: boolean } = {}): Lookup {
  const docs: Doc[] = [];
  for (const kind of ['post', 'wiki'] as const) {
    const dir = join(contentRoot, kind === 'post' ? 'posts' : 'wiki');
    for (const file of collectFiles(dir)) {
      const rel = relative(dir, file).split(sep).join('/');
      const page = readContentPage(dir, rel);
      docs.push({ kind, slug: page.slug, title: page.title, body: '', summary: page.summary,
        explicitSlug: page.explicitSlug, draft: page.draft });
    }
  }
  const graph = buildGraph(docs, options);
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  const byName = new Map<string, string>();
  for (const [name, slug] of graph.lookup) {
    const doc = graph.bySlug.get(slug);
    if (doc) byName.set(name, prefix + urlOf(doc));
  }
  return { byName };
}

/** 把一段文本按 `[[...]]` 切成「文本片段 + 链接」的序列。 */
interface Segment {
  readonly type: 'text' | 'link';
  readonly value: string;
  readonly url?: string;
  readonly label?: string;
}

export function splitWikilinks(text: string, lookup: Lookup): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const ref of parseWikiLinkText(text)) {
    const url = lookup.byName.get(normalizeTarget(ref.target));
    if (url === undefined) continue;
    if (ref.offset > cursor) segments.push({ type: 'text', value: text.slice(cursor, ref.offset) });
    segments.push({ type: 'link', value: text.slice(ref.offset, ref.end),
      url: ref.anchor ? url + '#' + encodeURIComponent(ref.anchor) : url, label: ref.label });
    cursor = ref.end;
  }
  if (cursor < text.length) segments.push({ type: 'text', value: text.slice(cursor) });
  return segments;
}

/**
 * 创建 remark 插件。
 *
 * `contentRoot` 默认取当前工作目录下的 `src/content`——Astro 构建时
 * cwd 就是项目根，所以不需要额外传参。
 */
export function remarkWikilink(options: { contentRoot?: string; base?: string; enabled?: boolean; includeDrafts?: boolean } = {}) {
  let lookup: Lookup | null = null;

  return (tree: Root, file?: { value?: unknown }) => {
    if (options.enabled === false) return;
    /**
     * 防御：`tree` 不是合法节点时直接返回。
     *
     * 触发场景很具体——unified 的 `.use()` 接受的是**工厂函数**（attacher），
     * 不是它返回的 transformer。写成 `.use(remarkWikilink())` 时，
     * unified 会拿处理器对象当 tree 传给 transformer，`visit(undefined)` 抛
     * `Cannot use 'in' operator to search for 'children' in undefined`。
     *
     * 那个报错完全看不出真正的原因（错误信息里一个字都没提 unified），
     * 所以在这里挡一道，并**把原因写在报错旁边**而不是留给下一个人去查。
     */
    if (!tree || typeof tree !== 'object' || !('type' in tree)) return;

    lookup ??= buildLookup(
      options.contentRoot ?? join(process.cwd(), 'src', 'content'),
      options.base ?? '/',
      { includeDrafts: options.includeDrafts },
    );
    const table = lookup;

    /**
     * **先收集，再替换**——不能在 visit 回调里直接改树。
     *
     * 在遍历过程中 splice 会让尚未访问的节点索引整体位移，visitor 拿到的
     * `index` 随即失效，于是它可能会去读一个已经被移走的位置
     * （实测报错：`Cannot use 'in' operator to search for 'children' in undefined`——
     * 遍历器拿到了 undefined 节点）。
     *
     * 从后往前替换则是安全的：改后面的位置不会影响前面尚未处理的索引。
     */
    const targets: Array<{ parent: { children: unknown[] }; index: number; value: string }> = [];

    visit(tree, (node, index, parent) => {
      if (node.type === 'link' || node.type === 'linkReference') return SKIP;
      if (node.type !== 'text') return;
      if (index === undefined || parent === undefined) return;
      if (!node.value.includes('[[')) return; // 绝大多数文本节点没有链接，快速跳过
      targets.push({ parent: parent as { children: unknown[] }, index, value: node.value });
    });

    for (let i = targets.length - 1; i >= 0; i--) {
      const target = targets[i];
      if (target === undefined) continue;

      let segments = splitWikilinks(target.value, table);
      // Entity decoding must not create wiki syntax absent from the authored text.
      // The graph and Markdown export recognise literal bracket syntax only.
      const source = typeof file?.value === 'string' ? file.value : undefined;
      const node = target.parent.children[target.index] as Text;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (source !== undefined && start !== undefined && end !== undefined) {
        const raw = source.slice(start, end);
        const allowed = new Set(parseWikiLinkText(raw).map((ref) => decodeString(raw.slice(0, ref.offset)).length));
        // Match occurrence order: Markdown removes container indentation from text
        // values, so source offsets cannot be compared to decoded-node offsets.
        const candidates = parseWikiLinkText(decodeString(raw)).filter((ref) => table.byName.has(normalizeTarget(ref.target)));
        segments = segments.map((segment) => {
          if (segment.type !== 'link') return segment;
          const candidate = candidates.shift();
          if (!candidate || !allowed.has(candidate.offset)) return { type: 'text', value: segment.value };
          return segment;
        });
      }
      // 整段都是普通文本 = 没有解析出链接，原样保留
      if (segments.length <= 1 && (segments[0]?.type ?? 'text') === 'text') continue;

      const replacements = segments.map((segment) =>
        segment.type === 'text'
          ? { type: 'text', value: segment.value }
          : {
              type: 'link',
              url: segment.url ?? '',
              children: [{ type: 'text', value: segment.label ?? '' }],
            },
      );

      target.parent.children.splice(target.index, 1, ...replacements);
    }
  };
}
