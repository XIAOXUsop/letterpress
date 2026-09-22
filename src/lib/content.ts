/**
 * Astro 内容集合 → 链接图模型。
 *
 * 这一层是**唯一**把 Astro 的内容 API 与纯逻辑（graph / lint / llms）缝在一起
 * 的地方。纯逻辑那边不知道 Astro 的存在，所以可以在毫秒级被测试；
 * 而这里只做数据搬运，逻辑尽量少——搬运代码出错最容易，但也最容易被看见。
 */

import { getCollection, type CollectionEntry } from 'astro:content';
import { join } from 'node:path';
import { site } from '../config.js';
import { buildGraph, type Doc, type LinkGraph } from './wiki/graph.js';
import { hasErrors, lint, type Issue } from './wiki/lint.js';
import { loadSources, validateSourceRefs } from './wiki/sources.js';
import { contentDigest } from './wiki/digest.js';
import { buildMarkdownTwin } from './wiki/llms.js';
import { resolveSlug } from './wiki/slug.js';
/**
 * 是否处于开发模式。
 *
 * 开发模式下**草稿也参与构建**，这样 `npm run dev` 里能直接预览未完成的文章。
 * 生产构建仍然会把它们排除在外。
 *
 * 少了这一条，作者必须每次把 `draft: true` 改成 `false` 才能看效果——
 * 而忘记改回去就会把半成品发上线。这是新用户很容易踩、又很难自己发现的坑。
 */
const IS_DEV = import.meta.env.DEV;

export interface SiteContent {
  readonly docs: readonly Doc[];
  readonly graph: LinkGraph;
  readonly issues: readonly Issue[];
  /** slug → 原始集合条目，用于渲染正文 */
  readonly entries: ReadonlyMap<string, CollectionEntry<'posts'> | CollectionEntry<'wiki'>>;
}

function toDoc(
  entry: CollectionEntry<'posts'> | CollectionEntry<'wiki'>,
  kind: 'post' | 'wiki',
): Doc {
  const data = entry.data;
  const explicit = typeof data.slug === 'string' && data.slug.trim() !== '';

  /**
   * `related` 是作者在 frontmatter 里显式声明的关系。
   *
   * <p>它**不再被折进正文**。这里早先的做法是在 `body` 末尾追加一行
   * `[[a]] [[b]]`，好让链接图、反向链接、孤儿页判定都能看到它——
   * 目的没错，代价是那一行会跟着 `body` 一路进机器出口：
   * `.md` 孪生与 `llms-full.txt` 里于是出现一行**作者从没写过**的链接，
   * 和一句"相关条目"正文并排躺着，读的人分不清哪句是作者写的。
   * （HTML 页面不受影响——它渲染的是 Astro 的 `entry.body`，从来没见过这一行。
   * 也就是说这行噪音**只出现在给机器看的那两个出口里**，而那正是它们的全部意义。）
   *
   * <p>现在图直接读 `declaredRelations`（见 `graph.ts` 的 `Doc`），正文保持原样。
   */
  const related = kind === 'wiki' ? ((data as { related?: string[] }).related ?? []) : [];

  /*
   * 来源与复核只在知识层条目上用。
   *
   * 文章是**时间流**：它记录的是"我当时这么想"，改的是错字与补充，
   * 不是"依据某版规范得出的结论"。给它套复核状态会把博客变成台账。
   * 知识层不一样——那里的每一条都是**关于世界的断言**，会过期。
   */
  const sources = kind === 'wiki' ? ((data as { sources?: Doc['sources'] }).sources ?? []) : [];
  const review = kind === 'wiki' ? (data as { review?: Doc['review'] }).review : undefined;

  return {
    kind,
    // entry.id 是相对内容根的文件路径（不含扩展名），正是 slug 的默认来源。
    // 优先级见 resolveSlug：显式 slug > 文件名 > 标题。
    slug: resolveSlug(data.title, data.slug, entry.id),
    title: data.title,
    summary: data.summary,
    body: entry.body ?? '',
    declaredRelations: related,
    wikiKind: kind === 'wiki' ? ((data as { kind?: string }).kind ?? 'concept') : undefined,
    sources,
    review,
    explicitSlug: explicit,
    // posts 与 wiki 的 schema 现在都声明了 draft（wiki 一直有，posts 是补上的——
    // 缺它时 Zod 静默剥离，过滤逻辑拿到的永远是 false，见 content.config.ts 的注释）
    draft: data.draft,
  };
}

/**
 * 加载全部内容，建立链接图，跑一遍体检。
 *
 * 每次构建只应调用一次——它做了三次全量扫描。
 * 页面之间通过 `Astro.locals` 或 props 共享结果，不要各页各调一遍。
 */
export async function loadContent(): Promise<SiteContent> {
  const [postEntries, wikiEntries] = await Promise.all([
    getCollection('posts'),
    site.wiki.enabled ? getCollection('wiki') : Promise.resolve([]),
  ]);

  const allDocs: Doc[] = [
    ...postEntries.map((e) => toDoc(e, 'post')),
    ...wikiEntries.map((e) => toDoc(e, 'wiki')),
  ];

  /*
   * 生产构建排除草稿，开发模式保留——作者要能看到自己正在写的东西。
   */
  const docs = IS_DEV ? allDocs : allDocs.filter((d) => !d.draft);

  // 开发模式下草稿也要进链接图，否则文章里的 [[链接]] 会对着草稿报断链
  const graph = buildGraph(docs, { includeDrafts: IS_DEV });
  const issues = lint(docs, graph, {
    warnOnCjkSlug: site.wiki.hintCjkSlugs,
    // 关掉知识层时，`[[链接]]` 就只是一串方括号，不该判为断链。
    // 少了这两个开关，`wiki.enabled: false` 这个文档承诺的出口会让构建失败。
    checkWikilinks: site.wiki.enabled,
    checkOrphans: site.wiki.enabled,
  });

  /*
   * ── 来源与复核的校验 ──────────────────────────────────────────────
   *
   * 只在**启用知识层**时做：关掉知识层就没有知识页，也就没有来源可谈。
   *
   * 这三条都是**机械可判定**的，语义级的（"这段话真的支持这个结论吗"）
   * 留给人工——把前者说成后者是这整套东西最容易制造出来的错觉。
   */
  if (site.wiki.enabled) {
    const sources = loadSources(join(process.cwd(), 'knowledge', 'sources'));

    for (const doc of docs) {
      const refs = doc.sources ?? [];

      for (const problem of validateSourceRefs(doc.title, refs, sources)) {
        issues.push({ rule: 'unknown-source', level: 'error', slug: doc.slug, message: problem });
      }

      const review = doc.review;
      if (!review) continue;

      if (review.status === 'reviewed') {
        if (!review.checkedAt) {
          issues.push({
            rule: 'review-missing-date',
            level: 'error',
            slug: doc.slug,
            message:
              `「${doc.title}」标了 reviewed 但没有 checkedAt。` +
              `复核日期不是装饰——它让读者知道这个结论是什么时候被确认的。`,
          });
        }
        if (!review.contentDigest) {
          issues.push({
            rule: 'review-missing-digest',
            level: 'error',
            slug: doc.slug,
            message:
              `「${doc.title}」标了 reviewed 但没有 contentDigest。` +
              `缺了它就**没有办法发现正文后来被改过**——"已复核"会变成一个永久绿色标记。` +
              `跑 \`npm run wiki:review -- --slug ${doc.slug}\` 取值。`,
          });
        } else {
          // 现算一次，与当时存下的比。**这是整个机制的关键一步。**
          const actual = contentDigest(doc);
          if (actual !== review.contentDigest) {
            issues.push({
              rule: 'review-stale',
              level: 'error',
              slug: doc.slug,
              message:
                `「${doc.title}」标记为已复核，但**正文在那之后改过**：\n` +
                `      存下的摘要：${review.contentDigest.slice(0, 16)}…\n` +
                `      现在的摘要：${actual.slice(0, 16)}…\n` +
                `      要么重新复核（接受现状），要么把 status 改回 pending。\n` +
                `      重新复核：\`npm run wiki:review -- --slug ${doc.slug}\`。`,
            });
          }
        }
      }
    }
  }

  const entries = new Map<string, CollectionEntry<'posts'> | CollectionEntry<'wiki'>>();
  for (const entry of postEntries) entries.set(toDoc(entry, 'post').slug, entry);
  for (const entry of wikiEntries) entries.set(toDoc(entry, 'wiki').slug, entry);

  return { docs, graph, issues, entries };
}

/** 已发布文章，按日期倒序（新的在前）。 */
export function publishedPosts(content: SiteContent): Doc[] {
  return content.docs
    .filter((d) => d.kind === 'post')
    .sort((a, b) => {
      const da = dateOf(content, a.slug);
      const db = dateOf(content, b.slug);
      if (da === db) return a.slug < b.slug ? -1 : 1;
      return db - da;
    });
}

/** 已发布知识库条目，按标题排序（知识层不是流，不该按时间排）。 */
export function publishedWiki(content: SiteContent): Doc[] {
  return content.docs
    .filter((d) => d.kind === 'wiki')
    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
}

function dateOf(content: SiteContent, slug: string): number {
  const entry = content.entries.get(slug);
  if (!entry) return 0;
  const data = entry.data as { date?: Date };
  return data.date ? data.date.getTime() : 0;
}

export function dateOfDoc(content: SiteContent, slug: string): Date | null {
  const entry = content.entries.get(slug);
  if (!entry) return null;
  const data = entry.data as { date?: Date };
  return data.date ?? null;
}

export function updatedOfDoc(content: SiteContent, slug: string): Date | null {
  const entry = content.entries.get(slug);
  if (!entry) return null;
  const data = entry.data as { updated?: Date };
  return data.updated ?? null;
}

export function tagsOf(content: SiteContent, slug: string): string[] {
  const entry = content.entries.get(slug);
  if (!entry) return [];
  const data = entry.data as { tags?: string[] };
  return data.tags ?? [];
}

export function kindOf(content: SiteContent, slug: string): 'concept' | 'entity' | 'synthesis' | null {
  const entry = content.entries.get(slug);
  if (!entry || !('kind' in entry.data)) return null;
  return (entry.data as { kind: 'concept' | 'entity' | 'synthesis' }).kind;
}

/**
 * 生成某篇内容真正发布出去的 markdown 孪生文件。
 *
 * 页面路由与内容清单必须共用这一处：若各自拼一份，清单里的 hash 很容易
 * 对着「看起来相同、字节却不同」的内容计算，增量同步就会失去意义。
 */
export function markdownTwinOf(
  content: SiteContent,
  doc: Doc,
  options: { siteUrl?: string; lang?: string },
): string {
  let body = buildMarkdownTwin(doc, content.graph, options);

  if (doc.kind !== 'post') return body;

  // 文章的日期与标签也是发布内容的一部分；它们变化时 hash 必须随之变化。
  const date = dateOfDoc(content, doc.slug);
  const tags = tagsOf(content, doc.slug);
  const meta: string[] = [];
  if (date) meta.push(`日期：${date.toISOString().slice(0, 10)}`);
  if (tags.length > 0) meta.push(`标签：${tags.join('、')}`);
  if (meta.length > 0) {
    const [head, ...rest] = body.split('\n\n');
    body = `${head}\n\n${meta.join('  \n')}\n\n${rest.join('\n\n')}`;
  }

  return body;
}

/**
 * 文章封面。用户提供时返回其路径与替代文本；没提供时返回 `null`，
 * 由 `Cover` 组件回落到确定性生成的几何封面。
 */
export function coverOf(
  content: SiteContent,
  slug: string,
): { src: string; alt: string } | null {
  const entry = content.entries.get(slug);
  if (!entry) return null;
  const data = entry.data as { cover?: string; coverAlt?: string; title?: string };
  if (!data.cover) return null;
  return {
    src: data.cover,
    // 缺 alt 时退回标题——比空字符串好，读屏用户至少知道图在讲什么。
    // 但仍然不如显式写：lint 会提示。
    alt: data.coverAlt ?? data.title ?? '',
  };
}

/**
 * 分享图地址。
 *
 * 优先级：frontmatter 的 `ogImage` > `cover` > 由 slug 生成的默认图。
 * 社交平台**不接受 SVG**，所以不提供 `cover` 时必须回落到生成的 PNG，
 * 而不是回落到页面上那张 SVG 封面。
 */
export function ogImageOf(content: SiteContent, slug: string): string {
  const entry = content.entries.get(slug);
  const data = entry?.data as { ogImage?: string; cover?: string } | undefined;
  return data?.ogImage ?? data?.cover ?? `/og/${slug}.png`;
}

/** 是否置顶。 */
export function isFeatured(content: SiteContent, slug: string): boolean {
  const entry = content.entries.get(slug);
  if (!entry) return false;
  return Boolean((entry.data as { featured?: boolean }).featured);
}

/** 该文章是否要显示目录。 */
export function tocEnabled(content: SiteContent, slug: string): boolean {
  const entry = content.entries.get(slug);
  if (!entry) return true;
  return (entry.data as { toc?: boolean }).toc !== false;
}

/**
 * 构建期把体检报告打到控制台，并在配置要求时让构建失败。
 *
 * 失败时抛出的信息里必须带上**具体是哪一条**，否则 CI 日志只显示
 * 「构建失败」而看不出原因，用户只能本地重跑一遍。
 *
 * 每个进程只报一次：多个页面都会调用它，重复输出会让日志里同一批问题
 * 出现七八遍，真正的新问题反而被淹没。
 */
let reported = false;

export function reportIssues(issues: readonly Issue[]): void {
  if (reported) return;
  reported = true;

  if (issues.length === 0) return;

  const errors = issues.filter((i) => i.level === 'error');
  const warn = issues.filter((i) => i.level === 'warn');
  const info = issues.filter((i) => i.level === 'info');

  const line = (i: Issue): string => `  [${i.rule}] ${i.message}`;

  if (errors.length > 0) {
    console.error(`\n知识库体检：${errors.length} 个错误`);
    for (const i of errors) console.error(line(i));
  }
  if (warn.length > 0) {
    console.warn(`\n知识库体检：${warn.length} 个警告`);
    for (const i of warn) console.warn(line(i));
  }
  if (info.length > 0) {
    console.info(`\n知识库体检：${info.length} 个提示`);
    for (const i of info) console.info(line(i));
  }

  if (site.lint.failOnError && hasErrors(issues)) {
    throw new Error(
      `知识库体检发现 ${errors.length} 个错误，构建已中止。\n` +
        `修好上面列出的问题，或在 src/config.ts 里把 lint.failOnError 设为 false。`,
    );
  }
}
