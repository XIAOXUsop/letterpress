/**
 * HTTP 内容协商：判断一个请求是否应该拿到 markdown 而不是 HTML。
 *
 * 为什么这段代码需要单独存在、单独测试：
 * 它是这个项目唯一「别人没做对」的地方，而做错的方式是**静默的**——
 * 实现写错了不会报错，只会永远返回 HTML，看起来一切正常。
 *
 * 依据 RFC 7231 §5.3.2（Accept）与 RFC 7763（text/markdown 媒体类型）。
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
 * 在候选类型里找出最优匹配。
 *
 * 只在**显式**命中时返回结果（`allowWildcard` 控制是否接受 `*`）。
 * 「最优」的判据是 q 大者胜，q 相同则头部里靠前者胜——后者正是
 * Claude Code 那种不写 q 值的客户端能working的前提。
 */
function bestMatch(
  ranges: readonly MediaRange[],
  candidates: ReadonlyArray<readonly [string, string]>,
  allowWildcard: boolean,
): MediaRange | null {
  let best: MediaRange | null = null;

  for (const range of ranges) {
    const explicit = candidates.some(([t, s]) => range.type === t && range.subtype === s);
    const wildcard = allowWildcard && range.subtype === '*' && (range.type === '*' || range.type === 'text');
    if (!explicit && !wildcard) continue;

    if (best === null || range.q > best.q || (range.q === best.q && range.index < best.index)) {
      best = range;
    }
  }

  return best;
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
  const markdown = bestMatch(ranges, MARKDOWN_TYPES, /* allowWildcard */ false);
  if (markdown === null) return false;

  // q=0 按 RFC 7231 §5.3.1 是**明确拒绝**，不是「偏好程度为零」。
  // 少了这一条，`text/markdown;q=0` 会被下面的「没有 HTML 备选就返回 true」
  // 判成肯定——把客户端的明确拒绝读成了明确要求，方向正好相反。
  if (markdown.q === 0) return false;

  const html = bestMatch(ranges, HTML_TYPES, /* allowWildcard */ true);
  if (html === null) return true; // 只点名要 markdown，没有任何 HTML 备选

  if (markdown.q !== html.q) return markdown.q > html.q;
  // q 平局：靠前的胜出。Claude Code 走的就是这一条。
  return markdown.index < html.index;
}

/** 响应用的内容类型常量。 */
export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';

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
