/**
 * 面向 agent 的检索：从知识层里挑出**该给模型看的那几段**，而不是整站。
 *
 * ── 它和站内搜索是两件事 ────────────────────────────────────────────
 *
 * 站内搜索跑在浏览器里（Pagefind，按 `<html lang>` 选分词器），
 * 而 `scripts/check-search.mjs` 已经用实测记下了一条教训：
 * **在 Node 里复现浏览器搜索行为是做不到的**（没有 `document`，lang 缺省，
 * 「中文排版」从 6 条掉到 1 条），任何在 Node 里假装的检查都会给出错误的结论。
 *
 * 所以这里**不假装**。它做的是另一件真实存在的事：
 * agent 来问一个问题时，该把哪些段落、连同哪些元数据一起递过去。
 * 这条路径上分词器由我们自己定，因此可复现、可回归、可评测。
 *
 * ── 为什么不用向量 ──────────────────────────────────────────────────
 *
 * 这个项目的立身之本是「完全离线、可复现、无 Key」。引入 embedding
 * 会一次性摧毁这三样：不同时间跑出不同结果、需要网络与凭据、
 * 而且失败时是**静默的**（召回掉了但没有任何东西会红）。
 *
 * 词法检索在 6 页的规模上完全够用，而且它的失败是**看得见的**——
 * 这正是 `knowledge/questions.md` 那套金标要量的事。
 *
 * ── 分词：中文按二元组，西文按词 ────────────────────────────────────
 *
 * 中文单字太泛（「的」「是」在每一页都有），整句又永远匹配不上。
 * 二元组（bigram）是这两种失败之间的那个点：够具体，又不依赖词典。
 *
 * ⚠️ 二元组**跨不过标点**：「行宽，为什么」切出来是 `行宽`、`什么`、`么为`，
 * 而正文里是「行宽 | 66ch | …」。所以查询侧同样走二元组，
 * 两边用同一把尺子——**这一点比选哪种分词更重要**。
 */

/** 一个可检索的段落。`id` 在整份语料里唯一，用于在金标里指名道姓。 */
export interface Passage {
  /** 所在文档的 id（知识页就是 slug）。 */
  readonly docId: string;
  /** `docId#序号`，稳定且可写进金标。 */
  readonly id: string;
  /** 段落所属的小节标题，没有就是空串。 */
  readonly heading: string;
  readonly text: string;
}

export interface Ranked extends Passage {
  readonly score: number;
  /** 命中的查询词，按 idf 降序。给 agent 看的「为什么是它」。 */
  readonly matched: readonly string[];
  /** 查询词中出现在本段的比例（按 idf 加权）。无答案判定用它。 */
  readonly coverage: number;
}

// ── 分词 ────────────────────────────────────────────────────────────

const CJK = /[㐀-䶿一-鿿豈-﫿]/;
const ASCII_RUN = /[a-z0-9]+(?:[.+#-][a-z0-9]+)*/g;

/**
 * 把文本切成检索词。
 *
 * 中文 → 连续汉字串的**二元组**（长度 1 的串退化为该字本身）。
 * 西文 → 小写化的字母数字串，`34em` / `text-autospace` / `q=1.0` 都算一个词。
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  // 全角转半角后再切，否则「（」与「(」会变成两个不同的词
  const normalized = text
    .normalize('NFKC')
    .toLowerCase();

  let cjkRun = '';
  const flushCjk = () => {
    if (cjkRun.length === 1) out.push(cjkRun);
    else for (let i = 0; i + 1 < cjkRun.length; i++) out.push(cjkRun.slice(i, i + 2));
    cjkRun = '';
  };

  for (const ch of normalized) {
    if (CJK.test(ch)) {
      cjkRun += ch;
      continue;
    }
    flushCjk();
    // 非汉字：交给西文正则整体扫一遍（在下面统一做，避免这里漏字符）
  }
  flushCjk();

  for (const m of normalized.matchAll(ASCII_RUN)) out.push(m[0]);
  return out;
}

// ── 切段 ────────────────────────────────────────────────────────────

/**
 * 按 `##` 小节切段；标题行本身算作段的一部分。
 *
 * 标题要留下：问「行宽」时，`## 34em 这个数字` 这一段的标题
 * 恰恰是最强的信号，扔掉它等于把最有用的一行丢了。
 */
export function splitPassages(docId: string, body: string): Passage[] {
  const lines = body.split('\n');
  const out: Passage[] = [];
  let heading = '';
  let buf: string[] = [];
  let n = 0;

  const flush = () => {
    const text = buf.join('\n').trim();
    if (text !== '') out.push({ docId, id: `${docId}#${n++}`, heading, text });
    buf = [];
  };

  for (const line of lines) {
    const h = /^#{2,3}\s+(.*)$/.exec(line);
    if (h) {
      flush();
      heading = h[1].trim();
    }
    buf.push(line);
  }
  flush();
  return out;
}

// ── 打分 ────────────────────────────────────────────────────────────

/** 文档频次：一个词出现在多少个**文档**里（不是多少段）。 */
export function documentFrequency(passages: readonly Passage[]): Map<string, number> {
  const perDoc = new Map<string, Set<string>>();
  for (const p of passages) {
    let set = perDoc.get(p.docId);
    if (!set) perDoc.set(p.docId, (set = new Set()));
    for (const t of new Set(tokenize(`${p.heading}\n${p.text}`))) set.add(t);
  }
  const df = new Map<string, number>();
  for (const set of perDoc.values()) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  return df;
}

/**
 * idf。用 `log(1 + N/(1+df))`，两个 `+1` 都是必须的：
 *
 * - **分母 `1+df`**：`df = 0`（语料里一个都没有）时不会除零。
 *   这一步是**修正一个方向反了的 bug**：早先写作 `df.get(term) ?? docCount`，
 *   于是「从未出现过」被当成「出现在所有文档里」，拿到和停用词一样的低权重。
 *   实测后果：问「Webmention 是怎么实现的」，`webmention` 权重被压到最低，
 *   而「怎么实现」四个字命中了内容协商页的小节标题
 *   ——**检索器用问题的虚词回答了问题的实词**，还报告「有依据」。
 * - **外层 `1+`**：语料只有 6 页，经典的 `log(N/df)` 会让
 *   「出现在全部 6 页」的词拿到 **0**，于是它对排序完全无影响——
 *   但它在**覆盖度**上仍然有意义。加 1 之后所有词都为正。
 */
export function idf(df: Map<string, number>, docCount: number, term: string): number {
  return Math.log(1 + docCount / (1 + (df.get(term) ?? 0)));
}

/** 这个检索词是不是西文 token（而不是中文二元组）。 */
export function isAsciiTerm(term: string): boolean {
  return !CJK.test(term);
}

/**
 * 虚词表——**中文检索里唯一一处人工维护的东西**，所以它必须小、必须保守。
 *
 * ── 它解决的是什么 ──────────────────────────────────────────────────
 *
 * 二元组会把**词与词的接缝**也切出来。「怎么实现」切出 `怎么`、`么实`、`实现`。
 * 其中 `么实` 不是词，但它**会真的存在于语料里**（只要别处也写过「怎么实现」）。
 * 于是问「Webmention 是怎么实现的」时，`么实` + `怎么` + `实现` 三处命中，
 * 检索器报告「有依据」——**用问题的虚词回答了问题的实词**。
 * 这是实测出来的，不是设想的（2026-09-23）。
 *
 * 判据：**含虚词的二元组不是实词**。`么实` 含「么」→ 不是；`实现` 不含 → 是。
 *
 * ── 为什么这么短 ────────────────────────────────────────────────────
 *
 * 宁可漏收，不可错收：把「中」收进来会让「中文」不再是实词，
 * 整个中文语料的检索当场失效。所以这里只放**在任何技术文本里都不承载信息**
 * 的字：结构助词、判断词、疑问词、代词、连词、常见量词。
 * 「多」「少」「要」「会」「用」这类**一律不收**——它们在技术文里常常是实义。
 */
const FUNCTION_CHARS = new Set(
  '的是了不在和与这那什么怎哪吗呢吧啊我你他她它们之其而或及且若则就也都还被把从由于因所但却又再很更最太没无非未每个谁您'.split(''),
);

/**
 * 是不是**实词**：西文 token 一律算，中文二元组要不含虚词。
 *
 * 只用来做**门槛**，不用来打分——接缝词仍参与排序，
 * 它们确实携带了一点「话题相近」的信号，扔掉可惜。
 */
export function isSubjectTerm(term: string): boolean {
  if (isAsciiTerm(term)) return true;
  for (const ch of term) if (FUNCTION_CHARS.has(ch)) return false;
  return true;
}

/**
 * 覆盖度的分母怎么算——**这里每一行都是被实测逼出来的**。
 *
 * 四种词，四种待遇：
 *
 * 1. **语料里有** → 用它自己的 idf。
 * 2. **西文 token，语料里没有** → 给**最稀有词的权重**（`df = 0`，比任何已知词都罕见）。
 *    这是**缺席证据**：问「怎么接 Stripe」而全站没有 `stripe`，就是没有依据。
 *    ASCII token 不可能被分词器凭空造出来，所以这条判据精度很高。
 * 3. **中文实词，语料里没有** → 给**中位权重的一倍**，即「一个普通词的分量」。
 *    这也是缺席证据，但**弱得多**——见下面第 4 条，两者在二元组下分不开。
 * 4. **中文接缝词** → **权重 0，直接不进分母**。两种接缝词：
 *    - 含虚词的（`么实`、`站不`）——见 `isSubjectTerm`；
 *    - **跨词接缝的**（`式方` 来自 `样式`+`方案`）——见 `junctionsOf`。
 *
 * ── 第 3 条为什么给「一倍中位权重」而不是别的数 ──────────────────────
 *
 * 因为它要同时扛住两头，而这两头**在二元组下结构完全一样**：
 *
 * - 「评论区」这种**真的缺席的词**，必须扣分（否则永远给得出答案）；
 * - 「式方」这种**分词副产物**，不该扣分（否则中文问句会被自己拖垮）。
 *
 * 给太高，问「为什么不用 Tailwind」光 `式方` 一个就把覆盖度压到门槛下；
 * 给太低，「怎么加评论区」又会被放过。一倍中位权重是两头之间的那个点，
 * **不是推导出来的**——它是一个折中，写在这里是为了让它**显式地**是个折中。
 *
 * 把跨词接缝单独识别出来（`junctionsOf`）之后，这个折中要扛的压力小了很多，
 * 但**没有消失**：接缝不止「两个字各自属于别的已知词」这一种形态。
 * 要彻底解决需要词典或向量，而向量会摧毁本项目
 * 「离线、可复现、无 Key」的立身之本——见文件开头。
 */
export function termWeight(
  df: Map<string, number>,
  docCount: number,
  term: string,
  medianKnownIdf: number,
  junctions: ReadonlySet<string> = new Set(),
): number {
  const seen = df.get(term);
  if (seen !== undefined) return idf(df, docCount, term);
  if (isAsciiTerm(term)) return Math.log(1 + docCount / 1);
  if (junctions.has(term)) return 0;
  if (isSubjectTerm(term)) return medianKnownIdf;
  return 0;
}

/**
 * 找出查询里的**跨词接缝**：两个字**各自都出现在别的、语料里存在的二元组中**。
 *
 * `样式方案` 切出 `样式`、`式方`、`方案`。`式方` 在语料里必然不存在，
 * 但 `式` 属于已知的 `样式`、`方` 属于已知的 `方案`——**它没有自己的字符**，
 * 整串都由别的词贡献。这就是接缝的判据。
 *
 * ── 它和「含虚词」是两条互补的判据 ──────────────────────────────────
 *
 * 虚词表判的是 `么实`（`么` 是功能字）；这条判的是 `式方`（两个字都是实字，
 * 但都不是它自己的）。**后者不需要词典，只读查询自身的结构与语料词表**，
 * 所以它是可靠的，不像虚词表那样是个手工维护的近似。
 *
 * 实测（2026-09-23）：没有这条时，问「为什么本站不用 Tailwind，样式方案是什么」，
 * `式方` 一个接缝词占掉分母的 13%，把一个**答得出来**的问题判成「没依据」。
 */
export function junctionsOf(
  queryTerms: readonly string[],
  df: Map<string, number>,
): Set<string> {
  const known = new Set(queryTerms.filter((t) => !isAsciiTerm(t) && df.has(t)));
  const charsOfKnown = new Set<string>();
  for (const b of known) for (const ch of b) charsOfKnown.add(ch);

  const junctions = new Set<string>();
  for (const t of queryTerms) {
    if (isAsciiTerm(t) || t.length !== 2 || df.has(t)) continue;
    if (charsOfKnown.has(t[0]) && charsOfKnown.has(t[1])) junctions.add(t);
  }
  return junctions;
}

/** 一条查询里每个检索词的分量。`rank` 与 `assess` 都从这里取，保证两处口径一致。 */
export function queryWeights(
  queryTerms: readonly string[],
  df: Map<string, number>,
  docCount: number,
): Map<string, number> {
  const median = medianIdf(df, docCount, queryTerms);
  const junctions = junctionsOf(queryTerms, df);
  return new Map(
    queryTerms.map((t) => [t, termWeight(df, docCount, t, median, junctions)]),
  );
}

export interface RankOptions {
  /** 返回多少段。默认 6。 */
  readonly limit?: number;
  /** 每篇文档最多贡献几段。默认 2——**这是防止单页霸榜**。 */
  readonly perDoc?: number;
}

/**
 * 排序。
 *
 * `perDoc` 不是为了好看：不设上限时，一个词在某一页出现密集就会
 * 把前几名全占满，跨文档组合类的问题永远拿不到第二篇文档。
 * 金标里有整整一类问题就是专门量这件事的。
 */
export function rank(
  passages: readonly Passage[],
  query: string,
  options: RankOptions = {},
): Ranked[] {
  const limit = options.limit ?? 6;
  const perDoc = options.perDoc ?? 2;

  const df = documentFrequency(passages);
  const docCount = new Set(passages.map((p) => p.docId)).size;
  const queryTerms = [...new Set(tokenize(query))];

  // 每个词的权重统一从 `queryWeights` 取——排序与门槛**必须同一把尺子**。
  // 两处各算一遍的话，会出现「排序觉得它重要、门槛觉得它不重要」这种自相矛盾，
  // 而那种 bug 的表征是「排序看着挺对，但系统总说没有依据」，极难反推。
  const weight = queryWeights(queryTerms, df, docCount);
  const totalWeight = [...weight.values()].reduce((a, b) => a + b, 0);

  const scored = passages.map((p) => {
    const tokens = new Set(tokenize(`${p.heading}\n${p.text}`));
    const matched = queryTerms.filter((t) => tokens.has(t));
    const score = matched.reduce((a, t) => a + (weight.get(t) ?? 0), 0);
    const coverage = totalWeight > 0 ? score / totalWeight : 0;
    return {
      ...p,
      score,
      coverage,
      matched: matched.sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0)),
    };
  });

  // 同分时的次序必须是确定的，否则金标会随机地红。
  // 先按分数，再按覆盖度，再按 id —— id 唯一，因此结果是全序。
  scored.sort((a, b) => b.score - a.score || b.coverage - a.coverage || (a.id < b.id ? -1 : 1));

  const used = new Map<string, number>();
  const out: Ranked[] = [];
  for (const s of scored) {
    if (s.score <= 0) break;
    const n = used.get(s.docId) ?? 0;
    if (n >= perDoc) continue;
    used.set(s.docId, n + 1);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 「没有依据」的判定——**两道闸，缺一不可**。
 *
 * ── 为什么必须有这道判定 ────────────────────────────────────────────
 *
 * 一个**永远给得出答案**的检索系统比一个会漏的系统更危险：它把
 * 「知识库里没有」伪装成「知识库里说有」。金标里那一类「无答案」
 * 问题量的就是这件事——它们只有在检索器诚实的时候才会通过。
 *
 * ── 闸一：覆盖度，而且**按文档算，不按段落算** ──────────────────────
 *
 * 查询里有多少比例的词真的出现在候选里（见 `termWeight` 对四种词的待遇）。
 * 用覆盖度而不是原始分数，是因为分数随语料规模浮动，
 * 而覆盖度是「这个问题被回答了多少」的直接度量。
 *
 * ⚠️ **按文档合并，不是按段落取最大。** 这一条也是实测定下来的：
 * 问「为什么不用 Tailwind」，`不用 Tailwind` 在 letterpress 的「不做什么」一节，
 * 而「样式 | 手写 CSS」在**同一页**的「技术选择」表格里。
 * 逐段算的话，两段各自都答不全，覆盖度双双掉到门槛下——
 * 而**「这一页答得出来」是文档级的事实**，不是段落级的事实。
 * 段是切法的产物，页才是知识单位。
 *
 * ── 闸二：最重的那个实词，知识层得**听说过** ────────────────────────
 *
 * 只看覆盖度会漏掉一类：**查询的实词缺席，虚词却命中得很密**。
 * 实测：问「Webmention 是怎么实现的」，候选段落命中了 `怎么`、`么实`、`实现`，
 * 覆盖度 0.53 轻松过闸——而全站根本没有 `webmention` 这个词。
 *
 * 所以再加一条：查询里权重最高的**实词**（见 `isSubjectTerm`）
 * 必须在**整个知识层**里出现过至少一次。
 *
 * ⚠️ 判据是「**语料里有没有**」，不是「**返回的那几段里有没有**」。
 * 这个区别是实测定下来的：问「为什么不用 Tailwind」，`tailwind` 明明
 * 在 letterpress 页里，但那一页进包的段落是「它想解决的三件事」，
 * 于是查返回集合会把一个**答得出来**的问题判成「没依据」。
 * 「这个词没人提过」和「提过但没排进前几段」是两回事。
 *
 * 两道闸都只读**查询与语料**，不读任何外部资源，因此可复现。
 */
export const MIN_COVERAGE = 0.34;

export interface Assessment {
  readonly passages: readonly Ranked[];
  /** 是否找到了依据。false 时 `reason` 说明是哪道闸拦下的。 */
  readonly supported: boolean;
  /** 给人和 agent 看的判定理由——**「没有」也是一个结论，要说清为什么**。 */
  readonly reason: string;
  /** 命中的文档，按覆盖度降序。这是「哪一页答得出来」的排序。 */
  readonly docs: readonly { readonly docId: string; readonly coverage: number }[];
}

/** 一篇文档里出现过的全部检索词（把该文档被选中的段落合起来看）。 */
function docCoverage(
  ranked: readonly Ranked[],
  weight: Map<string, number>,
  totalWeight: number,
): { docId: string; coverage: number }[] {
  const perDoc = new Map<string, Set<string>>();
  for (const r of ranked) {
    let set = perDoc.get(r.docId);
    if (!set) perDoc.set(r.docId, (set = new Set()));
    for (const t of r.matched) set.add(t);
  }
  return [...perDoc]
    .map(([docId, terms]) => ({
      docId,
      coverage: totalWeight > 0
        ? [...terms].reduce((a, t) => a + (weight.get(t) ?? 0), 0) / totalWeight
        : 0,
    }))
    .sort((a, b) => b.coverage - a.coverage || (a.docId < b.docId ? -1 : 1));
}

export function assess(
  passages: readonly Passage[],
  query: string,
  options: RankOptions = {},
): Assessment {
  const ranked = rank(passages, query, options);

  const df = documentFrequency(passages);
  const docCount = new Set(passages.map((p) => p.docId)).size;
  const queryTerms = [...new Set(tokenize(query))];
  const subjects = queryTerms.filter(isSubjectTerm);
  const weight = queryWeights(queryTerms, df, docCount);
  const totalWeight = [...weight.values()].reduce((a, b) => a + b, 0);
  const docs = docCoverage(ranked, weight, totalWeight);

  // 闸二先跑，**在「一个词都没命中」之前**。
  //
  // 顺序是有讲究的：两者都会判「没有依据」，但给出的理由完全不同。
  // 问「Webmention 是怎么实现的」时，若先跑空集判定，报的是
  // 「查询里没有任何一个词出现在知识层里」——**这是假的**，
  // `怎么` 和 `实现` 都命中了。真正的原因是那个实词缺席。
  // 理由错了，看的人就会去查错的地方。
  if (subjects.length > 0) {
    const heaviest = subjects
      .map((t) => ({ t, w: weight.get(t) ?? 0 }))
      .sort((a, b) => b.w - a.w || (a.t < b.t ? -1 : 1))[0];
    if (!df.has(heaviest.t)) {
      return {
        passages: ranked, docs, supported: false,
        reason:
          `查询的实词「${heaviest.t}」在整个知识层里一次都没出现过` +
          `（其余词命中得再密也不能替代它）。`,
      };
    }
  }

  if (ranked.length === 0) {
    return {
      passages: [], docs: [], supported: false,
      reason: '查询里没有任何一个词出现在知识层里。',
    };
  }

  // 闸一：按文档合并的覆盖度
  const best = docs[0];
  if (!best || best.coverage < MIN_COVERAGE) {
    return {
      passages: ranked, docs, supported: false,
      reason:
        `答得最全的一页（${best?.docId ?? '—'}）只覆盖了查询的 ` +
        `${((best?.coverage ?? 0) * 100).toFixed(0)}%，低于门槛 ${(MIN_COVERAGE * 100).toFixed(0)}%。`,
    };
  }

  return {
    passages: ranked, docs, supported: true,
    reason: `命中 ${docs.length} 篇文档，${best.docId} 覆盖 ${(best.coverage * 100).toFixed(0)}%。`,
  };
}

/** 一组词里已知词的中位 idf——`termWeight` 拿它当噪声基准。 */
function medianIdf(df: Map<string, number>, docCount: number, terms: readonly string[]): number {
  const known = terms
    .filter((t) => df.has(t))
    .map((t) => idf(df, docCount, t))
    .sort((a, b) => a - b);
  return known.length > 0 ? known[Math.floor(known.length / 2)] : Math.log(1 + docCount / 1);
}
