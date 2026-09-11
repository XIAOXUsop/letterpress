/**
 * `[[wiki-link]]` 的解析与解析。
 *
 * 语法（与 Obsidian / Karpathy 的 llm-wiki 模式一致）：
 *
 *     [[target]]                  → 链接到 target，显示文本即 target
 *     [[target|显示文本]]          → 自定义显示文本
 *     [[target#小节]]              → 指向 target 页内某小节
 *     [[target#小节|显示文本]]      → 三者组合
 *
 * ── 一个必须处理对的地方 ────────────────────────────────────────────
 *
 * **代码块与行内代码里的方括号不是链接。**
 *
 * 技术博客里讲解语法的文章几乎必然出现 `[[something]]` 的字面量，
 * 比如「在 frontmatter 里写 `[[foo]]` 就能引用」。如果解析器把它们
 * 也当成链接，这些文章会被 lint 报一堆断链——于是用户学会忽略 lint，
 * 那 lint 就白做了。
 *
 * 因此扫描时先切出代码区间并跳过。这是**确定性**的（不需要理解语义），
 * 也因此可以被测试。
 */

/** 一条从文本中抽出的 wiki 链接引用。 */
export interface WikiLinkRef {
  /** 目标页面的标识（`#` 之前的部分，已 trim） */
  readonly target: string;
  /** 页内锚点（`#` 之后的部分），无则为 null */
  readonly anchor: string | null;
  /** 显示文本，未指定时等于 target */
  readonly label: string;
  /** 在原文中的起始偏移（指向第一个 `[`），用于报错定位与替换 */
  readonly offset: number;
  /** 在原文中的结束偏移（指向 `]]` 之后一位），用于替换 */
  readonly end: number;
}

/**
 * 匹配围栏代码块的一行：缩进不超过 3 空格，然后是 3 个及以上同种字符
 * （反引号或波浪号）。返回字符与长度，因为**闭合围栏必须用同种字符
 * 且不少于同样的长度**——这是 CommonMark 的规定。
 */
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

interface Fence {
  readonly char: '`' | '~';
  readonly length: number;
  /** 开围栏后跟的信息串；闭围栏要求为空（反引号围栏尤其如此） */
  readonly info: string;
}

function matchFence(line: string): Fence | null {
  const m = FENCE_PATTERN.exec(line);
  if (!m) return null;
  const marker = m[1] ?? '';
  return {
    char: marker[0] as '`' | '~',
    length: marker.length,
    info: (m[2] ?? '').trim(),
  };
}

/**
 * 找出所有「代码区间」——围栏代码块与行内代码——的偏移范围。
 *
 * 返回的区间是 `[start, end)`，按 start 升序且互不重叠。
 *
 * 围栏配对遵循 CommonMark：开围栏 `N` 个字符，只有同种字符且**不少于 N 个**
 * 的围栏能闭合它。少了这条，```` 开的块会被 ` ``` ` 提前闭合，
 * 后面本该是代码的内容就会被当成正文——而技术博客里演示嵌套代码块
 * 恰恰会写出这种结构。
 */
export function findCodeSpans(text: string): Array<readonly [number, number]> {
  const spans: Array<readonly [number, number]> = [];
  const lines = text.split('\n');

  let offset = 0;
  let open: (Fence & { readonly start: number }) | null = null;

  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    const fence = matchFence(line);

    if (open === null) {
      if (fence) {
        open = { ...fence, start: lineStart };
      } else {
        // 行内代码：在非围栏行里逐对找出反引号
        for (const span of findInlineCodeSpans(line, lineStart)) spans.push(span);
      }
    } else if (
      fence &&
      fence.char === open.char &&
      fence.length >= open.length &&
      (open.char === '~' || fence.info === '')
    ) {
      spans.push([open.start, lineEnd]);
      open = null;
    }

    offset = lineEnd + 1; // +1 是换行符
  }

  // 未闭合的围栏延伸到文末：按 CommonMark，未闭合代码块一直持续到文档结束
  if (open !== null) spans.push([open.start, text.length]);

  return spans.sort((a, b) => a[0] - b[0]);
}

/** 找出一行里的行内代码区间（反引号配对）。 */
function findInlineCodeSpans(line: string, baseOffset: number): Array<readonly [number, number]> {
  const spans: Array<readonly [number, number]> = [];
  let open = -1;
  let openTicks = 0;
  let i = 0;

  while (i < line.length) {
    if (line[i] !== '`') {
      i++;
      continue;
    }
    // 数一数连续多少个反引号——`` 与 ` 是不同的定界符
    let ticks = 0;
    while (line[i + ticks] === '`') ticks++;

    if (open === -1) {
      open = i;
      openTicks = ticks;
    } else if (ticks === openTicks) {
      spans.push([baseOffset + open, baseOffset + i + ticks]);
      open = -1;
    }
    i += ticks;
  }

  return spans;
}

function isInside(offset: number, spans: ReadonlyArray<readonly [number, number]>): boolean {
  return spans.some(([start, end]) => offset >= start && offset < end);
}

/**
 * 从 markdown 文本中抽出所有 wiki 链接引用。
 *
 * 代码区间内的方括号会被跳过——见文件头说明。
 */
export function parseWikiLinks(text: string): WikiLinkRef[] {
  const codeSpans = findCodeSpans(text);
  const refs: WikiLinkRef[] = [];
  let i = 0;

  while (i < text.length) {
    const open = text.indexOf('[[', i);
    if (open === -1) break;

    const close = text.indexOf(']]', open + 2);
    if (close === -1) break; // 没有闭合，后面都不会再有完整的链接

    // 链接体内不允许再出现 `[`——避免把 `[[a] [b]]` 这种误配成一条
    const body = text.slice(open + 2, close);
    if (body.includes('[') || body.includes(']') || body.includes('\n')) {
      i = open + 2;
      continue;
    }

    if (!isInside(open, codeSpans)) {
      const ref = parseBody(body, open, close + 2);
      if (ref) refs.push(ref);
    }

    i = close + 2;
  }

  return refs;
}

function parseBody(body: string, offset: number, end: number): WikiLinkRef | null {
  const pipe = body.indexOf('|');
  const rawTarget = pipe === -1 ? body : body.slice(0, pipe);
  const rawLabel = pipe === -1 ? null : body.slice(pipe + 1);

  const hash = rawTarget.indexOf('#');
  const target = (hash === -1 ? rawTarget : rawTarget.slice(0, hash)).trim();
  const anchor = hash === -1 ? null : rawTarget.slice(hash + 1).trim();

  // 空 target 不是有效链接——`[[#小节]]` 这种「指向本文档的锚点」在博客语境下
  // 没有对应物（每篇文章自成一个页面），直接忽略比报错更合适。
  if (target === '') return null;

  const label = rawLabel !== null && rawLabel.trim() !== '' ? rawLabel.trim() : target;

  return { target, anchor: anchor === '' ? null : anchor, label, offset, end };
}

/** 按目标名归一化，用于「不同写法指向同一页」的比较。 */
export function normalizeTarget(target: string): string {
  return target.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * 把 markdown 里的 wiki 链接替换成标准 markdown 链接。
 *
 * `resolve` 返回 null 表示目标不存在——此时保留原文并交给 lint 报告，
 * **不要**静默删掉：读者看不到、作者也不知道自己写错了。
 */
export function renderWikiLinks(
  text: string,
  resolve: (target: string) => string | null,
): string {
  // parseWikiLinks 已经跳过了代码区间，这里直接用它的结果即可——
  // refs 的 offset/end 就是原文里 `[[...]]` 的精确边界。
  const refs = parseWikiLinks(text);
  if (refs.length === 0) return text;

  let result = '';
  let cursor = 0;

  for (const ref of refs) {
    const href = resolve(ref.target);
    if (href === null) continue; // 断链：保持原样，由 lint 报出

    const withAnchor = ref.anchor ? `${href}#${encodeURIComponent(ref.anchor)}` : href;
    result += text.slice(cursor, ref.offset);
    result += `[${ref.label}](${withAnchor})`;
    cursor = ref.end;
  }

  result += text.slice(cursor);
  return result;
}
