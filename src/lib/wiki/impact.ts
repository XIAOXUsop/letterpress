/**
 * 影响分析的**计算部分**（纯函数，不碰文件系统）。
 *
 * ── 为什么要有这个文件 ──────────────────────────────────────────────
 *
 * 原先这套计算整个写在 `scripts/wiki-impact.mjs` 的顶层：读文件、算影响、
 * 打印，全在一个脚本里。**结果是它零测试**——`verify.test.ts` 只把它当作
 * 「这个文件存不存在」的一个素材，从来没验过它算得对不对。
 *
 * 而阶段 3 的核心退出条件恰恰是「**对预埋的显式来源变更，直接影响召回率
 * 为 100%**」。**一个没人量过的召回率不是一个数字，是一个愿望。**
 *
 * 所以把计算抽出来：这里的函数是纯的（输入是已读好的页面与登记，输出是三组
 * slug），可以直接穷举测试；`scripts/wiki-impact.mjs` 保留读文件与打印。
 *
 * ── 三组必须互不重叠 ────────────────────────────────────────────────
 *
 * 这是这个模块最容易坏掉的地方，且坏了**看不出来**：输出里 ① 和 ③
 * 同时列同一个页面，读者会以为「还有别的地方要改」，
 * 而消除这种困惑正是这个工具存在的理由。`disjoint` 那条断言专门守它。
 */

/** 页面上一处来源引用。 */
export interface ImpactRef {
  readonly sourceId: string;
  readonly revision: string;
  readonly locator?: string;
}

/** 影响分析需要的页面信息。字段与 `Doc` 对齐，但只取用得上的那几个。 */
export interface ImpactPage {
  readonly slug: string;
  readonly title: string;
  /**
   * 本页的来源引用。
   *
   * ⚠️ **可选**——真实的 `Doc.sources` 是可选的（`Doc.sources?`），
   * 而这里原先标成必填。类型与现实脱节的后果不是编译失败，
   * 是**运行时 `undefined.some` 崩溃**。
   *
   * 站内一直没暴露，是因为两个调用方都**老实填了空数组**——
   * **默认值救了它，而那正是最危险的状态**：它掩盖了脱节，
   * 直到第二份内容集（不带 `refs` 字段）进来才炸。
   */
  readonly refs?: readonly ImpactRef[];
  /**
   * frontmatter 里 `related` 声明的关系（slug，不含 `/wiki/` 前缀）。
   *
   * 同样**可选**，理由与 `refs` 一样：真实的 `Doc.declaredRelations?` 是可选的。
   */
  readonly related?: readonly string[];
}

export interface ImpactResult {
  /** ① 明确引用了这个来源（可选：这一版）的页面。确定性最高。 */
  readonly direct: readonly ImpactPage[];
  /** ② 直接引用者的一跳邻居。**只是候选**——相邻不等于受影响。 */
  readonly candidates: ReadonlyMap<string, string>;
}

/**
 * 算出直接引用者与一跳邻居。
 *
 * @param pages   全部已读好的知识页
 * @param sourceId 要分析的来源 id
 * @param revision 只看这一版；省略则该来源的**所有版本**都算直接引用
 */
export function computeImpact(
  pages: readonly ImpactPage[],
  sourceId: string,
  revision?: string,
): ImpactResult {
  const direct = pages.filter((p) =>
    (p.refs ?? []).some((r) => r.sourceId === sourceId && (!revision || r.revision === revision)),
  );
  const directSlugs = new Set(direct.map((p) => p.slug));
  const known = new Set(pages.map((p) => p.slug));

  /*
   * 一跳邻居，两个方向：
   *   ① 直接引用者**声明指向**谁（它 out 出去的 related）；
   *   ② 谁**声明指向**直接引用者（别人 in 进来的 related）。
   *
   * 两个方向都要——只算一个方向，就会漏掉「A 引了来源，B 引了 A」里的 B，
   * 而 B 恰恰是最可能需要一起复查的那一篇。
   *
   * 直接引用者自己不算候选（它在 ① 里），不存在的 slug 也不进图
   * （那属于断链，是 lint 的职责，不该在这里混成一条噪声）。
   */
  const candidates = new Map<string, string>();
  for (const p of direct) {
    for (const target of p.related ?? []) {
      if (!directSlugs.has(target) && known.has(target)) candidates.set(target, p.slug);
    }
  }
  for (const p of pages) {
    if (directSlugs.has(p.slug)) continue;
    for (const target of p.related ?? []) {
      if (directSlugs.has(target)) candidates.set(p.slug, target);
    }
  }

  return { direct, candidates };
}

/**
 * 三组是否互不重叠。**重叠是一种静默的误导**，所以单独给它一个断言。
 *
 * @param repoMentions ③ 组的仓库路径（相对仓库根，正斜杠）
 */
export function isDisjoint(result: ImpactResult, repoMentions: readonly string[]): boolean {
  const directSlugs = new Set(result.direct.map((p) => p.slug));
  return !repoMentions.some((path) => {
    const asSlug = path
      .replace(/^src\/content\/wiki\//, '')
      .replace(/\.mdx?$/, '');
    return path.startsWith('src/content/wiki/') && directSlugs.has(asSlug);
  });
}
