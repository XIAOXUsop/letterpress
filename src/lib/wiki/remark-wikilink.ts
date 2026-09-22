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

/**
 * 从 frontmatter 里取一个标量字段。
 *
 * ── 支持的子集是写死的，越界就抛 ──────────────────────────────────
 *
 * 这个函数**刻意不实现完整 YAML**：它在 markdown 管线里执行，拿不到 Astro
 * 内容层，而为一个字段引一个 YAML 解析器属于额外依赖。
 *
 * 但"简化"的代价必须显式管住。手写解析遇到不认识的写法时，
 * **默默返回一个错的值**比报错糟得多——`[[链接]]` 会指到错误的页面，
 * 而构建照样通过、测试照样全绿。
 *
 * 2026-09-23 实测（与真实 YAML 逐例比对，探针见提交信息）：
 *
 *   用例                 手写解析            真 YAML
 *   尾随注释             "标题 # 注释"       "标题"
 *   双引号含转义         "第一行\n第二行"    真正的换行
 *   折叠块标量 `>`       ">"                折行后的内容
 *   竖线块标量 `|`       "|"                保留换行
 *   值写在下一行         null               缩进的值
 *   单引号里的 ''        "它''说"           "它'说"
 *
 * 12 个边界用例里 **6 个分歧**。现有内容一条都不触发（11 个文件 × 6 个字段
 * = 66 次比对，0 分歧），所以**当前没有一个页面是错的**——但下一位作者写
 * `title: >` 或顺手加个行尾 `# 注释`，就会静默踩中。
 *
 * 所以这里把支持的子集写死，越界抛出可操作的错误：
 *
 *   支持：`field: 值` 单行；值非空；可整体用单/双引号包裹（不含转义）。
 *   不支持：块标量（`|` / `>`）、值写到下一行、行尾注释、引号内的转义。
 *
 * 要放宽哪一条，**先在这个文件对应的用例里加一条**，再改实现。
 */
export function frontmatterField(source: string, field: string): string | null {
  if (!source.startsWith('---')) return null;
  const end = source.indexOf('\n---', 3);
  if (end === -1) return null;

  const block = source.slice(3, end);
  // 只匹配顶层的 `field: value`，忽略缩进（避免取到 tags 之类的子项）
  const pattern = new RegExp(`^${field}:[ \\t]*(.*)$`, 'm');
  const match = pattern.exec(block);
  if (!match) return null;

  const raw = (match[1] ?? '').trim();
  if (raw === '') {
    // 值不在这一行——可能是块标量或"值写到下一行"，两种都不支持
    const nextLine = new RegExp(`^${field}:[ \\t]*$`, 'm').exec(block);
    if (nextLine) {
      unsupported(field, '值不在同一行（块标量，或值写在了下一行）');
    }
    return null;
  }

  if (raw === '|' || raw === '>') {
    unsupported(field, `块标量 \`${raw}\``);
  }
  if (/^[|>][-+]?\d*$/.test(raw)) {
    unsupported(field, `块标量 \`${raw}\``);
  }

  const quoted =
    (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"));

  if (quoted) {
    const inner = raw.slice(1, -1);
    if (raw.startsWith('"') && inner.includes('\\')) {
      unsupported(field, '双引号里的转义序列（真实 YAML 会反转义，这里不会）');
    }
    if (raw.startsWith("'") && inner.includes("''")) {
      unsupported(field, "单引号里的 `''` 转义");
    }
    return inner;
  }

  // 未加引号的值里出现 ` #` —— 真实 YAML 会把后面当注释，这里会原样保留
  if (/\s#/.test(raw)) {
    unsupported(field, '行尾注释（未加引号的值里出现了 ` #`）');
  }

  return raw;
}

/**
 * 遇到不支持的 frontmatter 写法时报错。
 *
 * **刻意抛而不是回退**：这个值的用途是给 `[[链接]]` 建查找表，
 * 错的值会让链接静默指向别的页面。宁可让构建停下来。
 */
function unsupported(field: string, what: string): never {
  throw new Error(
    `frontmatter 字段 \`${field}\` 用了本解析器不支持的写法：${what}。\n` +
      `  这个解析器只支持 \`${field}: 单行值\`（可整体加引号，不含转义）。\n` +
      `  它刻意不实现完整 YAML——那就得让它**在越界时报错**，而不是猜一个值。\n` +
      `  改法：把 ${field} 写成一行普通值；若确有需要，见本文件里 frontmatterField 的注释。`,
  );
}

/**
 * 扫描内容目录，把**所有**用不支持的 frontmatter 写法的地方一次报出来。
 *
 * ── 为什么必须有这一步，而不是指望 frontmatterField 抛错就够了 ──────────
 *
 * 实测（2026-09-23）：在 remark 插件的 transformer 里抛异常，
 * **Astro 不会让构建失败**。清掉内容层缓存后重建，注入一个 `title: >`：
 *
 *     错误打印 22 次
 *     [ERROR] Error rendering cjk-web-typography.md: Failed to parse Markdown file
 *     wiki 页里的链接从 4 条掉到 3 条     ← 页面真的退化了
 *     Build exit code: 0                  ← 而构建自称成功
 *
 * 也就是说，在 remark 管道里抛错 = **页面静默缺失，构建报绿**。
 * 那比原来的"链接静默指错"更糟。
 *
 * 所以把校验提到 **astro.config.mjs 的加载期**：那时什么都还没渲染，
 * 抛一个错误就是整个构建失败、且一眼能看到原因。
 * 本函数就是给那一步用的；transformer 里的 `unsupported` 作为兜底保留。
 */
export function collectFrontmatterProblems(contentRoot: string): string[] {
  const problems: string[] = [];
  const scan = (subdir: string): void => {
    for (const file of collectFiles(join(contentRoot, subdir))) {
      const source = readFileSync(file, 'utf8');
      // 这个文件里**所有**会被用来建查找表的字段
      for (const field of ['title', 'slug']) {
        try {
          frontmatterField(source, field);
        } catch (error) {
          const rel = relative(contentRoot, file).split(sep).join('/');
          problems.push(`${rel} [${field}] ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  };
  scan('posts');
  scan('wiki');
  return problems;
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

  const collect = (subdir: string, urlPrefix: string) => {
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
      out.push({ slug, title, url: `${basePrefix}${urlPrefix}${slug}/` });
    }
    return out;
  };

  const all = [...collect('posts', '/'), ...collect('wiki', '/wiki/')];

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
