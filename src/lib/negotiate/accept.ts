/**
 * HTTP 内容协商：判断一个请求是否应该拿到 markdown 而不是 HTML。
 *
 * 为什么这段代码需要单独存在、单独测试：
 * 它是这个项目唯一「别人没做对」的地方，而做错的方式是**静默的**——
 * 实现写错了不会报错，只会永远返回 HTML，看起来一切正常。
 *
 * 依据 RFC 9110 §12.5.1（Accept）与 RFC 7763（text/markdown 媒体类型）。
 *
 * ── 三件必须做对的事 ──────────────────────────────────────────────
 *
 * 1. **缺省 q 值是 1.0，平局时靠前的胜出。**
 *    Claude Code 发的是 `text/markdown` 与 `text/html` 外加一个通配符，
 *    **它不写 q 值**，只靠顺序表达偏好。若用严格的 `>` 比较
 *    （而非「q 相等时比顺序」），两个候选都是 q=1.0，判定就落到 HTML 上，
 *    Claude Code 永远拿不到 markdown。实测来源见 README。
 *
 * 2. **通配符不算「想要 markdown」。**
 *    Gemini CLI 与 Windsurf 只发一个通配符，意思是「给什么都行」。
 *    通配符会让 markdown 与 html 同时命中且 q 相同；若不把它排除在
 *    markdown 的候选之外，就会把「无所谓」误判成「要 markdown」，
 *    于是把 markdown 强塞给一个本来接受 HTML 的普通客户端。
 *    因此 markdown 一侧**只认显式声明**（text/markdown、text/x-markdown）。
 *
 * 3. **`text/plain` 不当作 markdown 请求。**
 *    OpenCode 会带 `text/plain;q=0.8`，但那是它的降级选项，不是偏好。
 *    我们只在显式请求 markdown 时返回 markdown；其余一律 HTML。
 *    宁可漏给（客户端仍拿到可用的 HTML），不可错给。
 *
 * 注：本文档里一律把通配符写作「通配符」而不是字面量。原因是块注释中的
 * `星号 斜杠 星号` 正是块注释的结束标记——写进来会**提前闭合注释**，
 * 让后面的中文变成代码并触发解析错误。这个坑很隐蔽，所以在这里说明白。
 */

/** 一个解析后的媒体范围。`index` 保留头部中的原始顺序，用于平局判定。 */
export interface MediaRange {
  readonly type: string;
  readonly subtype: string;
  readonly q: number;
  /** 在 Accept 头里出现的次序，越小越靠前 */
  readonly index: number;
}

/** 被视为「请求 markdown」的媒体类型。只认显式声明，不认通配符。 */
const MARKDOWN_TYPES: ReadonlyArray<readonly [string, string]> = [
  ['text', 'markdown'],
  ['text', 'x-markdown'],
];

/** 与 markdown 竞争「同一份内容」的表示形式。 */
const HTML_TYPES: ReadonlyArray<readonly [string, string]> = [
  ['text', 'html'],
  ['application', 'xhtml+xml'],
];

/**
 * 解析 Accept 头。
 *
 * 容错而非抛错：Accept 头来自网络，畸形输入是常态，
 * 而「因为客户端发了个畸形头就 500」比「降级返回 HTML」糟得多。
 */
export function parseAccept(header: string): MediaRange[] {
  const ranges: MediaRange[] = [];

  header.split(',').forEach((raw, index) => {
    const parts = raw.split(';');
    const range = (parts[0] ?? '').trim().toLowerCase();
    if (range === '') return;

    let q = 1;
    for (const param of parts.slice(1)) {
      const eq = param.indexOf('=');
      if (eq === -1) continue;
      const key = param.slice(0, eq).trim().toLowerCase();
      if (key !== 'q') continue;
      const value = Number.parseFloat(param.slice(eq + 1).trim());
      // q 必须落在 [0,1]；越界或非数字一律按缺省 1.0 处理
      if (Number.isFinite(value) && value >= 0 && value <= 1) q = value;
    }

    const slash = range.indexOf('/');
    if (slash === -1) return; // 没有 type/subtype 形状的条目直接忽略

    ranges.push({
      type: range.slice(0, slash),
      subtype: range.slice(slash + 1),
      q,
      index,
    });
  });

  return ranges;
}

/**
 * 一个媒体范围对具体表示的匹配精度。
 *
 * RFC 9110 §12.5.1 的顺序是：具体类型 > 类型通配符 > 全局通配符。
 * 这个顺序**先于 q 值**。例如 HTML 被显式赋予 q=0、全局通配符为 q=1 时，
 * HTML 的质量仍然是 0；显式拒绝不能被宽泛的通配符重新放行。
 */
function specificity(range: MediaRange, candidate: readonly [string, string]): number {
  const [type, subtype] = candidate;
  if (range.type === type && range.subtype === subtype) return 2;
  if (range.type === type && range.subtype === '*') return 1;
  if (range.type === '*' && range.subtype === '*') return 0;
  return -1;
}

/**
 * 算出一组等价表示的有效质量。
 *
 * 对每个具体表示，先取**最具体**的媒体范围；精度相同时才比较 q 与顺序。
 * 最后再在等价表示之间选 q 更高的一个。`requireExplicit` 用来守住本项目的
 * 保守原则：客户端没有点名 markdown 时，绝不只凭通配符把 markdown 塞过去。
 */
function qualityFor(
  ranges: readonly MediaRange[],
  candidates: ReadonlyArray<readonly [string, string]>,
  requireExplicit: boolean,
): MediaRange | null {
  let bestCandidate: MediaRange | null = null;

  for (const [candidateIndex, candidate] of candidates.entries()) {
    const explicitlyMentioned = ranges.some((range) => specificity(range, candidate) === 2);
    /*
     * 第一项是服务端真正提供的媒体类型，其余是兼容别名。
     * 别名只有被客户端点名时才参与竞争；否则一个全局通配符会凭空制造出
     * application/xhtml+xml 表示，再覆盖 text/html 的明确降权。
     */
    if ((requireExplicit || candidateIndex > 0) && !explicitlyMentioned) {
      continue;
    }

    let bestMatch: MediaRange | null = null;
    let bestSpecificity = -1;

    for (const range of ranges) {
      const currentSpecificity = specificity(range, candidate);
      if (currentSpecificity < 0) continue;

      if (
        bestMatch === null ||
        currentSpecificity > bestSpecificity ||
        (currentSpecificity === bestSpecificity && range.q > bestMatch.q) ||
        (currentSpecificity === bestSpecificity &&
          range.q === bestMatch.q &&
          range.index < bestMatch.index)
      ) {
        bestMatch = range;
        bestSpecificity = currentSpecificity;
      }
    }

    if (bestMatch === null) continue;

    if (
      bestCandidate === null ||
      bestMatch.q > bestCandidate.q ||
      (bestMatch.q === bestCandidate.q && bestMatch.index < bestCandidate.index)
    ) {
      bestCandidate = bestMatch;
    }
  }

  return bestCandidate;
}

/**
 * 该请求是否应当收到 markdown。
 *
 * 真值表（前 7 行取自 2026-02 对真实 agent 的实测，见 README）：
 *
 * | 客户端       | Accept 头                                     | 结果  |
 * |--------------|-----------------------------------------------|-------|
 * | Claude Code  | `text/markdown, text/html`, 通配符            | true  |
 * | Cursor       | `text/markdown`, `text/html;q=0.9`, …         | true  |
 * | OpenCode     | `text/markdown;q=1.0`, `text/x-markdown`, …   | true  |
 * | Codex        | `text/html`, `application/xhtml+xml`, …       | false |
 * | Gemini CLI   | 通配符                                        | false |
 * | Copilot      | `text/html`, `application/xhtml+xml`, …       | false |
 * | Windsurf     | 通配符                                        | false |
 * | （空 / 缺失） | `-`                                           | false |
 */
export function prefersMarkdown(accept: string | null | undefined): boolean {
  if (!accept) return false;

  const ranges = parseAccept(accept);
  const markdown = qualityFor(ranges, MARKDOWN_TYPES, /* requireExplicit */ true);
  if (markdown === null) return false;

  // q=0 按 RFC 9110 §12.4.2 是**明确拒绝**，不是「偏好程度为零」。
  // 少了这一条，`text/markdown;q=0` 会被下面的「没有 HTML 备选就返回 true」
  // 判成肯定——把客户端的明确拒绝读成了明确要求，方向正好相反。
  if (markdown.q === 0) return false;

  const html = qualityFor(ranges, HTML_TYPES, /* requireExplicit */ false);
  if (html === null) return true; // 只点名要 markdown，没有任何 HTML 备选

  if (markdown.q !== html.q) return markdown.q > html.q;
  // q 平局：靠前的胜出。Claude Code 走的就是这一条。
  return markdown.index < html.index;
}

/** 响应用的内容类型常量。 */
export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';

/** HTTP 头只能可靠承载 ASCII；中文 slug 在这里统一转成 URI 百分号编码。 */
function headerUri(pathname: string): string {
  const url = new URL(pathname, 'https://letterpress.invalid');
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Markdown 表示的公共响应头。
 *
 * 静态 `.md` 路由与边缘协商必须共用这一处，否则两条访问路径会逐渐漂移：
 * 一条有 token 提示，另一条没有；一条可发现 HTML，另一条变成信息孤岛。
 */
export function markdownResponseHeaders(
  body: string,
  canonicalPath: string,
  representationPath: string,
): Headers {
  const canonical = headerUri(canonicalPath);
  const representation = headerUri(representationPath);

  return new Headers({
    'Content-Type': MARKDOWN_CONTENT_TYPE,
    'Content-Location': representation,
    Link: `<${canonical}>; rel="canonical"; type="text/html", <${representation}>; rel="alternate"; type="text/markdown"`,
    Vary: 'Accept',
    'x-markdown-tokens': String(estimateTokens(body)),
  });
}

/**
 * 估算文本的 token 数。
 *
 * 这是**给 agent 看的提示值**，不是计费数字，所以刻意用可解释的启发式而非
 * 引入 tokenizer 依赖：CJK 约 1 字 1 token，其余按约 4 字符 1 token。
 * 宁可偏保守（高估），也不要让 agent 以为塞得下。
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x3040 && code <= 0x30ff) || // 日文假名
      (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
      (code >= 0x4e00 && code <= 0x9fff) || // CJK 基本区
      (code >= 0xac00 && code <= 0xd7af) || // 谚文
      (code >= 0xf900 && code <= 0xfaff) // CJK 兼容表意
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return cjk + Math.ceil(other / 4);
}
