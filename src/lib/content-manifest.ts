/**
 * 版本化内容清单。
 *
 * 它不是搜索索引，也不是某个尚未稳定的行业标准；它解决的是一个更窄、
 * 可验证的问题：让同步器先比较 hash，只抓取真正变化的 markdown 孪生文件。
 */
import { createHash } from 'node:crypto';
import type { Doc, LinkGraph } from './wiki/graph.ts';
import { urlOf } from './wiki/graph.ts';

export const CONTENT_MANIFEST_FORMAT = 'letterpress-content-manifest';

/**
 * 格式版本。
 *
 * ── 判据（2026-09-24 修正过一次）─────────────────────────────────────
 *
 * 原先这里写「只在消费方需要改代码时才升」，下一段却把「字段增删或改名」
 * 列为该升的条件——**两句话对同一次改动给出相反答案**，
 * 而实际执行时我按了后者（加了 `provenance` 却没升版本）。
 *
 * 统一成一条可执行的判据：
 *
 *   **产物里已有文档的 JSON 形状变了，就升。**
 *
 * - **升**：新增字段、改名、删字段、改变同一输入的产出
 *   （例如改 `manifestId` 推导规则）、字段语义改变。
 *   理由不是「下游要改代码」，而是**同一份 `version: 1` 在不同时间
 *   会对应两种形状**——那正是版本号要防的事。
 * - **不升**：只改内部实现、只加**可选且当前恒为缺席**的字段、
 *   值没变（给 `manifestId` 加显式 `id` 支持就是这一类：
 *   那六篇的显式 id 与原 slug 同值，**产物里的 ID 一个字节都没变**）。
 *
 * ⚠️ 「可选字段」不等于「不用升」——`provenance` 是可选的，
 * 但它对有来源的页面**真的会出现**，所以那次改动**应该**升到 2。
 * 「可选」只在**该字段对所有文档都恒为缺席**时才可以不升。
 */
export const CONTENT_MANIFEST_VERSION = 2;

export interface ManifestSource {
  readonly doc: Doc;
  /** 对应 `.md` 端点实际返回的完整字节内容。 */
  readonly markdown: string;
  readonly publishedAt?: Date | null;
  readonly updatedAt?: Date | null;
  readonly tags?: readonly string[];
  readonly wikiKind?: 'concept' | 'entity' | 'synthesis' | null;
}

export interface ContentManifestOptions {
  readonly siteName: string;
  readonly language: string;
  /** 站点根地址；可以为空，也可以是含部署子路径的绝对地址。 */
  readonly siteUrl?: string;
}

export interface ContentManifestDocument {
  readonly id: string;
  readonly kind: Doc['kind'];
  readonly wikiKind?: 'concept' | 'entity' | 'synthesis';
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly urls: {
    readonly html: string;
    readonly markdown: string;
  };
  readonly publishedAt?: string;
  readonly updatedAt?: string;
  readonly tags: readonly string[];
  readonly relations: {
    readonly outgoing: readonly string[];
    readonly backlinks: readonly string[];
  };
  readonly markdown: {
    readonly mediaType: 'text/markdown';
    readonly bytes: number;
    readonly sha256: string;
  };
  /**
   * 来源与复核状态。**没标就不给这个键**，而不是给空数组或空对象。
   *
   * <p>为什么要进机器出口：2026-09-24 实测发现 HTML 页面有（Provenance 组件），
   * 而 manifest 与 NDJSON 都没有。于是**订阅者按 manifest 同步时无从知道
   * 哪篇已经过期**——而「stale 内容不得在机器接口里被当成新鲜内容」
   * 恰好就是这条路径要防的事。页面看得见、机器看不见，是最坏的一种不一致。
   *
   * <p>`stale` 尤其重要：它必须能被下游看见，而不是悄悄消失。
   * 消失会让订阅者以为「这篇没变」，而实际是「它变得不可信了」。
   */
  readonly provenance?: {
    /**
     * 「这一页讲的是本站自己的实践，没有外部来源」及其理由。
     *
     * 存在它是为了让「没有来源」有两种**可区分**的含义：
     * 「该登记却漏了」与「它本来就是原创实践记录」。
     * **原本两者在数据里长得一模一样**，于是 reviewer 无从判断该补还是正常。
     */
    readonly original?: { readonly reason: string };
    readonly sources?: readonly {
      readonly sourceId: string;
      readonly revision: string;
      readonly locator?: string;
    }[];
    readonly review?: {
      readonly status: 'pending' | 'reviewed' | 'stale';
      readonly checkedAt?: string;
      /** 复核当时的正文摘要。下游可据此判断自己手上的版本是否还是被复核过的那一版 */
      readonly contentDigest?: string;
    };
  };
}

export interface ContentManifest {
  readonly format: typeof CONTENT_MANIFEST_FORMAT;
  readonly version: typeof CONTENT_MANIFEST_VERSION;
  readonly site: {
    readonly name: string;
    readonly language: string;
    readonly home: string;
  };
  readonly documentCount: number;
  readonly edgeCount: number;
  readonly documents: readonly ContentManifestDocument[];
}

/**
 * 文档的稳定身份。
 *
 * ── 为什么不能是 `kind:slug` ────────────────────────────────────────
 *
 * 它原先就是。改一次文件名或显式 slug，同一篇内容的 ID 就变了——
 * 而 manifest 是**对外发布**的机器出口，下游（订阅者的同步状态、外部索引）
 * 按这个 ID 认文档。ID 一变，旧文档就成了「凭空多出来又消失的一篇」。
 *
 * 路线图 §5.1 的要求是「`id` 和 `slug` 必须分离：URL 可以演化，
 * 知识身份不能因此断裂」。这里是那个要求的可执行形式。
 *
 * ── 设计取舍：为什么不按内容寻址 ────────────────────────────────────
 *
 * 试过「没有显式 id 时用正文摘要」，**实测撞了**：两篇不同文档只要正文相同
 * （测试 fixture 里很常见，真实站点里也完全可能），就会得到同一个 ID。
 * 而 manifest 的 ID 是下游认文档的唯一凭据，**撞 ID 意味着两篇互相覆盖**，
 * 比「改名会改 ID」严重得多。附带还有第二个问题：内容寻址下**改一个字正文
 * 就换 ID**，等于每次修订都让全体下游重新同步——比改名频繁得多。
 *
 * 所以规则是：
 *
 *   1. 有显式 `doc.id` → 用它。**这是唯一真正跨改名稳定的办法**，
 *      也就是路线图 §5.1 说的「id 和 slug 必须分离」的落地方式；
 *   2. 否则退回 `kind:slug`——**保持既有行为，不制造新的破坏**。
 *
 * 代价要说清楚：**没写显式 id 的文档，改名仍会改 ID。**
 * 这不是把缺陷藏起来，而是「改名」本来就需要一次显式的身份声明：
 * 真要改名时补一个 `id` 即可，之后再改 slug 也不影响它。
 *
 * ⚠️ 显式 id 一旦写下**就不该再改**——它和 slug 不同，是对下游的承诺。
 * 改它等于告诉所有订阅者「这是一篇新文档」。
 */
export function manifestId(doc: Pick<Doc, 'kind' | 'slug' | 'id'>): string {
  return doc.id ? `${doc.kind}:${doc.id}` : `${doc.kind}:${doc.slug}`;
}

function joinSite(siteUrl: string | undefined, pathname: string): string {
  const root = siteUrl?.replace(/\/$/, '') ?? '';
  return `${root}${pathname}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * 构建确定性清单：没有构建时间，输入不变时输出字节也不变。
 */
export function buildContentManifest(
  sources: readonly ManifestSource[],
  graph: LinkGraph,
  options: ContentManifestOptions,
): ContentManifest {
  const published = sources.filter(({ doc }) => !doc.draft);

  const documents = published
    .map(({ doc, markdown, publishedAt, updatedAt, tags = [], wikiKind }) => {
      const htmlPath = urlOf(doc);
      const outgoing = [...(graph.outbound.get(doc.slug) ?? [])]
        .map((slug) => graph.bySlug.get(slug))
        .filter((target): target is Doc => target !== undefined && !target.draft)
        .map(manifestId)
        .sort();
      const backlinks = (graph.backlinks.get(doc.slug) ?? [])
        .map(({ fromSlug }) => graph.bySlug.get(fromSlug))
        .filter((source): source is Doc => source !== undefined && !source.draft)
        .map(manifestId)
        .sort();

      const entry: ContentManifestDocument = {
        id: manifestId(doc),
        kind: doc.kind,
        ...(doc.kind === 'wiki' && wikiKind ? { wikiKind } : {}),
        slug: doc.slug,
        title: doc.title,
        summary: doc.summary,
        urls: {
          html: joinSite(options.siteUrl, htmlPath),
          markdown: joinSite(options.siteUrl, `${htmlPath.replace(/\/$/, '')}.md`),
        },
        ...(publishedAt ? { publishedAt: publishedAt.toISOString() } : {}),
        ...(updatedAt ? { updatedAt: updatedAt.toISOString() } : {}),
        tags: [...tags],
        relations: { outgoing, backlinks },
        // 两个子键各自独立：只标了来源就没 review，只标了复核就没 sources。
        // **整个 provenance 键在两者都没有时缺席**——空对象读起来像「查过了，没有」。
        //
        // ⚠️ 下面全部用 `?.` 而不是靠外层 `doc.sources?.length` 短路：
        // 迭代 N 实测到 `computeImpact` 就是**类型标必填、实际可为 undefined**
        // 而崩掉的（`undefined.some`）。这里虽然逻辑上安全，
        // 但「靠外层条件保护的内层访问」在改代码时极易被挪掉——
        // **能写成不依赖别人保护的样子，就写成那样。**
        ...(doc.sources?.length || doc.review || doc.original
          ? {
              provenance: {
                ...(doc.original ? { original: doc.original } : {}),
                ...(doc.sources?.length
                  ? {
                      sources: (doc.sources ?? []).map((ref) => ({
                        sourceId: ref.sourceId,
                        revision: ref.revision,
                        ...(ref.locator ? { locator: ref.locator } : {}),
                      })),
                    }
                  : {}),
                ...(doc.review
                  ? {
                      review: {
                        status: doc.review.status,
                        ...(doc.review.checkedAt ? { checkedAt: doc.review.checkedAt } : {}),
                        ...(doc.review.contentDigest
                          ? { contentDigest: doc.review.contentDigest }
                          : {}),
                      },
                    }
                  : {}),
              },
            }
          : {}),
        markdown: {
          mediaType: 'text/markdown',
          bytes: new TextEncoder().encode(markdown).byteLength,
          sha256: sha256(markdown),
        },
      };

      return entry;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    format: CONTENT_MANIFEST_FORMAT,
    version: CONTENT_MANIFEST_VERSION,
    site: {
      name: options.siteName,
      language: options.language,
      home: joinSite(options.siteUrl, '/'),
    },
    documentCount: documents.length,
    edgeCount: documents.reduce((sum, doc) => sum + doc.relations.outgoing.length, 0),
    documents,
  };
}

export function serializeContentManifest(manifest: ContentManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
