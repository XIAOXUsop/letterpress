/**
 * frontmatter 的**手写子集解析器**。
 *
 * ── 为什么单独一个模块 ──────────────────────────────────────────────
 *
 * 它原先住在 `remark-wikilink.ts` 里，只有那个 remark 插件用。后来
 * 维护脚本（`wiki-review.mjs`、`wiki:impact`）也要读同样的字段——
 * 而**在第二个地方重写一遍就是三份实现**，这个项目已经因为"两套解析
 * 会漂"吃过足够多的苦。
 *
 * 所以它独立出来：**没有运行时依赖**（只有 `node:fs` 与 `node:path`），
 * 于是 remark 插件与脚本都能直接 import，Node 24 剥掉类型就能跑。
 *
 * 它刻意不实现完整 YAML——支持子集写死在下面，越界抛错。
 */

import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';

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

/** 递归收集 .md / .mdx 文件。目录不存在是**合法状态**（比如关掉了知识层）。 */
export function collectFiles(dir: string): string[] {
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
