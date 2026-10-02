/**
 * Context pack 的**构造**（纯函数，不读文件、不打印）。
 *
 * ── 为什么要有这个文件 ──────────────────────────────────────────────
 *
 * 原先这套构造整个写在 `scripts/wiki-ask.mjs` 的顶层，而且**顶层就有
 * `process.exit`**——所以它**无法被 import，也就无法被单测**。
 * 这与迭代 G 之前的 `wiki-impact` 是同一个处境：
 * **零测试的工具，等于没人量过的工具。**
 *
 * 路线图阶段 3 的退出条件里有一条「查询结果必须包含文档 ID、片段、
 * 来源版本、状态和关系路径」。那五样东西**在这里被组装**，
 * 也就是说**这个文件就是那条退出条件的实现**——
 * 而它此前一行测试都没有。
 *
 * 抽出之后：
 * - 这个文件能被 `context-pack.test.ts` 端到端量；
 * - `scripts/wiki-ask.mjs` 退化成「读文件 → 调它 → 打印」。
 *
 * ⚠️ **它是纯的**：没有时钟、没有随机数、没有环境变量。
 * 这一点是「可复现构建」那条契约成立的前提（见 `check-reproducible.mjs`）。
 */

import { assess, MIN_COVERAGE, splitPassages, type Passage } from './retrieve.ts';
import { buildGraph, type LinkGraph } from './graph.ts';
import { normalizeTarget } from './wikilink.ts';

/** 一篇可被组装进 pack 的页面。与 `readContentPage` 的返回同形。 */
export interface PackDoc {
  readonly slug: string;
  readonly title: string;
  readonly updated: string;
  readonly body: string;
  readonly related?: readonly string[];
  readonly review?: { readonly status: string; readonly checkedAt?: string };
  readonly sources?: readonly {
    readonly sourceId: string;
    readonly revision: string;
    readonly locator?: string;
  }[];
}

export interface PackOptions {
  /** 返回多少段。`--all` 时调大。 */
  readonly limit?: number;
  readonly perDoc?: number;
  /** 不截断正文（`--all`）。 */
  readonly fullText?: boolean;
}

/** pack 里的一个片段。字段与 `scripts/wiki-ask.mjs --json` 的输出逐字一致。 */
export interface PackPassage {
  readonly id: string;
  readonly docId: string;
  readonly title: string;
  readonly heading: string;
  readonly score: number;
  readonly coverage: number;
  readonly matched: readonly string[];
  /** 这段与主命中文档的关系。模型据此判断几页之间能不能互相推论。 */
  readonly relation: string;
  readonly updated: string;
  readonly review: { readonly status: string; readonly checkedAt?: string } | null;
  readonly sources: readonly { sourceId: string; revision: string; locator?: string }[];
  readonly text: string;
}

export interface ContextPack {
  readonly question: string;
  readonly supported: boolean;
  readonly reason: string;
  readonly minCoverage: number;
  readonly passages: readonly PackPassage[];
}

/** 切段。抽出来是为了让调用方与测试用同一把尺子。 */
export function packPassages(docs: readonly PackDoc[]): Passage[] {
  return docs.flatMap((d) => splitPassages(d.slug, d.body));
}

/**
 * 组装一份 context pack。
 *
 * 路线图 §3 要的五样，逐条对应到 `PackPassage` 的字段：
 * 文档 ID（`id` / `docId`）、片段（`heading` + `text`）、
 * 来源版本（`sources[].revision`）、状态（`review.status`）、
 * 关系路径（`relation`）。
 */
export function buildContextPack(
  docs: readonly PackDoc[],
  question: string,
  options: PackOptions = {},
): ContextPack {
  const { limit = 6, perDoc = 2, fullText = false } = options;
  const bySlug = new Map(docs.map((d) => [d.slug, d]));
  // 与发布链接图共用解析口径：标题、别名、小节、代码区间和歧义均一致。
  const graph = buildGraph(docs.map((doc) => ({
    kind: 'wiki', slug: doc.slug, title: doc.title, summary: '', body: doc.body,
    declaredRelations: doc.related ?? [], explicitSlug: false, draft: false,
  })));
  const passages = packPassages(docs);

  const { passages: ranked, supported, reason } = assess(passages, question, { limit, perDoc });
  const primary = ranked[0]?.docId;

  return {
    question,
    supported,
    reason,
    minCoverage: MIN_COVERAGE,
    passages: ranked.map((r) => {
      const doc = bySlug.get(r.docId);
      return {
        id: r.id,
        docId: r.docId,
        title: doc?.title ?? r.docId,
        heading: r.heading,
        score: Number(r.score.toFixed(4)),
        coverage: Number(r.coverage.toFixed(4)),
        matched: r.matched,
        relation: relationTo(bySlug, graph, primary, r.docId),
        updated: doc?.updated ?? '',
        review: doc?.review ?? null,
        sources: doc?.sources ?? [],
        text: snippet(r.text, fullText),
      };
    }),
  };
}

/**
 * 这段与主命中文档是什么关系。
 *
 * **没有它，模型会以为捞回来的几页是彼此无关的碎片**，
 * 从而漏掉它们之间的推论——而组合正是 context pack 的全部意义。
 */
function relationTo(
  bySlug: ReadonlyMap<string, PackDoc>,
  graph: LinkGraph,
  primary: string | undefined,
  slug: string,
): string {
  if (slug === primary) return '主命中';
  const a = primary === undefined ? undefined : bySlug.get(primary);
  const b = bySlug.get(slug);

  const declares = (doc: PackDoc | undefined, target: string) =>
    doc?.related?.some((name) => graph.lookup.get(normalizeTarget(name)) === target) ?? false;
  if (declares(a, slug)) return `← ${primary} 声明`;
  if (primary !== undefined && declares(b, primary)) return `→ 声明了 ${primary}`;
  if (primary !== undefined && graph.outbound.get(primary)?.has(slug)) return `← ${primary} 正文`;
  if (primary !== undefined && graph.outbound.get(slug)?.has(primary)) return `→ 正文引用了 ${primary}`;
  return '无直接关系';
}

function snippet(text: string, full: boolean): string {
  if (full) return text;
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  return lines.slice(0, 6).join('\n');
}
