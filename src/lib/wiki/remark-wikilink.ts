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
 * 纯函数版的解析器（wikilink.ts）必须自己做这件事，因为它拿到的是字符串；
 * 但在构建管线里，AST 已经替我们做完了。
 *
 * ── 查找表怎么来 ────────────────────────────────────────────────────
 *
 * 直接扫内容目录，按与 content.ts **同一套优先级**（显式 slug > 文件名 > 标题）
 * 建立「slug → URL」和「标题 → URL」两张表。
 *
 * 这里确实与 content.ts 有少量重复。之所以接受，是因为 remark 插件在管线里
 * 是纯函数、拿不到 Astro 的内容集合；而把两者强行统一需要引入一层
 * 「构建期生成查找表文件」的机制，那会引入时序问题，代价更大。
 * 重复的部分被 `slug.test.ts` 与端到端构建测试同时覆盖。
 */

import { join, relative, sep } from 'node:path';
import { readFileSync } from 'node:fs';
import type { Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';
import { normalizeTarget } from './wikilink.js';
import { resolveSlug } from './slug.js';
import { urlFor } from './graph.js';
import { frontmatterField, collectFiles } from './frontmatter.js';

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
export function buildLookup(contentRoot: string, base = '/'): Lookup {
  const byName = new Map<string, string>();
  const basePrefix = base.endsWith('/') ? base.slice(0, -1) : base;

  // 前缀**不手写**：与链接图、内容清单共用 `urlFor` 这一份规则。
  // 手写的那一版在这里躺了很久——`urlOf` 一改它就静默对不上。
  const collect = (subdir: string, kind: 'post' | 'wiki') => {
    const out: Array<{ slug: string; title: string; url: string }> = [];
    for (const file of collectFiles(join(contentRoot, subdir))) {
      const source = readFileSync(file, 'utf8');
      const title = frontmatterField(source, 'title') ?? '';
      const explicit = frontmatterField(source, 'slug');

      // 相对内容根、去掉扩展名的路径，与 Astro 的 entry.id 一致
      const rel = relative(join(contentRoot, subdir), file).replace(/\.mdx?$/, '');
      const fileId = rel.split(sep).join('/');

      const slug = resolveSlug(title, explicit, fileId);
      if (slug === '') continue;
      out.push({ slug, title, url: `${basePrefix}${urlFor(kind, slug)}` });
    }
    return out;
  };

  const all = [...collect('posts', 'post'), ...collect('wiki', 'wiki')];

  // ── 先数标题，再建表：同名标题**不进查找表** ─────────────────────
  //
  // 原先这里是 `if (!byName.has(title)) byName.set(title, url)`——先到先得。
  // 与 `graph.ts` 是同一个 bug：`[[那个标题]]` 指向谁取决于文件枚举顺序，
  // 而两处各自算一遍，还可能算出不一样的结果。
  //
  // 现在两处都改成"同名就不注册"。于是 `[[Shared]]` 渲染成原样的方括号，
  // 而 `lint` 的 `ambiguous-wikilink` 会报错并列出候选——**构建会停下来**。
  const titleCount = new Map<string, number>();
  for (const { title } of all) {
    if (title === '') continue;
    const key = normalizeTarget(title);
    titleCount.set(key, (titleCount.get(key) ?? 0) + 1);
  }

  for (const { slug, title, url } of all) {
    byName.set(normalizeTarget(slug), url);
    if (title === '') continue;
    const key = normalizeTarget(title);
    if ((titleCount.get(key) ?? 0) === 1 && !byName.has(key)) {
      byName.set(key, url);
    }
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
  let i = 0;

  while (i < text.length) {
    const open = text.indexOf('[[', i);
    if (open === -1) break;
    const close = text.indexOf(']]', open + 2);
    if (close === -1) break;

    const body = text.slice(open + 2, close);
    // 链接体里不应再有方括号或换行
    if (body.includes('[') || body.includes(']') || body.includes('\n')) {
      i = open + 2;
      continue;
    }

    const pipe = body.indexOf('|');
    const rawTarget = pipe === -1 ? body : body.slice(0, pipe);
    const rawLabel = pipe === -1 ? null : body.slice(pipe + 1);

    const hash = rawTarget.indexOf('#');
    const target = (hash === -1 ? rawTarget : rawTarget.slice(0, hash)).trim();
    const anchor = hash === -1 ? null : rawTarget.slice(hash + 1).trim();

    const url = target === '' ? undefined : lookup.byName.get(normalizeTarget(target));

    // 断链：**保持原样**。渲染成链接会指向 404，静默删除则读者与作者都不知道。
    // 保持 `[[原文]]` 最诚实——而 lint 会在构建时报出来。
    if (url !== undefined) {
      if (open > cursor) segments.push({ type: 'text', value: text.slice(cursor, open) });
      const label = rawLabel !== null && rawLabel.trim() !== '' ? rawLabel.trim() : target;
      segments.push({
        type: 'link',
        value: '',
        url: anchor ? `${url}#${encodeURIComponent(anchor)}` : url,
        label,
      });
      cursor = close + 2;
    }

    i = close + 2;
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
export function remarkWikilink(options: { contentRoot?: string; base?: string } = {}) {
  let lookup: Lookup | null = null;

  return (tree: Root) => {
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

    visit(tree, 'text', (node: Text, index, parent) => {
      if (index === undefined || parent === undefined) return;
      if (!node.value.includes('[[')) return; // 绝大多数文本节点没有链接，快速跳过
      targets.push({ parent: parent as { children: unknown[] }, index, value: node.value });
    });

    for (let i = targets.length - 1; i >= 0; i--) {
      const target = targets[i];
      if (target === undefined) continue;

      const segments = splitWikilinks(target.value, table);
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
