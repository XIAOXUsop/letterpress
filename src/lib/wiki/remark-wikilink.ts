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

import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';
import { normalizeTarget } from './wikilink.js';
import { resolveSlug } from './slug.js';

interface Lookup {
  readonly byName: ReadonlyMap<string, string>;
}

/** 从 frontmatter 里取一个标量字段。frontmatter 是简单键值，不需要完整 YAML 解析。 */
function frontmatterField(source: string, field: string): string | null {
  if (!source.startsWith('---')) return null;
  const end = source.indexOf('\n---', 3);
  if (end === -1) return null;

  const block = source.slice(3, end);
  // 只匹配顶层的 `field: value`，忽略缩进（避免取到 tags 之类的子项）
  const pattern = new RegExp(`^${field}:[ \\t]*(.*)$`, 'm');
  const match = pattern.exec(block);
  if (!match) return null;

  const raw = (match[1] ?? '').trim();
  if (raw === '') return null;
  // 去掉包裹的引号并反转义最外层的引号
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function collectFiles(dir: string): string[] {
  // 显式用 string 版的 Dirent：默认重载会推出 Buffer 版本，
  // 而 entry.name 在那种类型下是 NonSharedBuffer，赋给 string 会报错
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return []; // 目录不存在是合法状态（比如关掉了知识层）
  }

  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(full));
    else if (/\.mdx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

/** 扫描内容目录，建立「名字 → URL」查找表。 */
export function buildLookup(contentRoot: string): Lookup {
  const byName = new Map<string, string>();

  const scan = (subdir: string, urlPrefix: string): void => {
    for (const file of collectFiles(join(contentRoot, subdir))) {
      const source = readFileSync(file, 'utf8');
      const title = frontmatterField(source, 'title') ?? '';
      const explicit = frontmatterField(source, 'slug');

      // 相对内容根、去掉扩展名的路径，与 Astro 的 entry.id 一致
      const rel = relative(join(contentRoot, subdir), file).replace(/\.mdx?$/, '');
      const fileId = rel.split(sep).join('/');

      const slug = resolveSlug(title, explicit, fileId);
      if (slug === '') continue;

      const url = `${urlPrefix}${slug}/`;
      byName.set(normalizeTarget(slug), url);
      // 标题也作为入口：作者写 [[某页]] 时想的通常是标题
      if (title !== '' && !byName.has(normalizeTarget(title))) {
        byName.set(normalizeTarget(title), url);
      }
    }
  };

  scan('posts', '/');
  scan('wiki', '/wiki/');

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
export function remarkWikilink(options: { contentRoot?: string } = {}) {
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

    lookup ??= buildLookup(options.contentRoot ?? join(process.cwd(), 'src', 'content'));
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
