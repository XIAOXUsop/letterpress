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
 * 因此按 Markdown AST 的文本节点提取引用。这是**确定性**的（不需要理解语义），
 * 也因此可以被测试。
 */

import { visit, SKIP } from 'unist-util-visit';
import { parseMarkdown } from './markdown.ts';
import { decodeString } from 'micromark-util-decode-string';

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

/** Source intervals of actual Markdown code nodes, including nested containers. */
export function findCodeSpans(text: string): Array<readonly [number, number]> {
  const spans: Array<readonly [number, number]> = [];
  visit(parseMarkdown(text), (node) => {
    if (node.type !== 'code' && node.type !== 'inlineCode') return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) spans.push([start, end]);
  });
  return spans.sort((a, b) => a[0] - b[0]);
}

/**
 * 从 markdown 文本中抽出所有 wiki 链接引用。
 *
 * 代码区间内的方括号会被跳过——见文件头说明。
 */
export function parseWikiLinks(text: string): WikiLinkRef[] {
  const refs: WikiLinkRef[] = [];
  visit(parseMarkdown(text), (node) => {
    if (node.type === 'link' || node.type === 'linkReference') return SKIP;
    if (node.type !== 'text') return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    for (const ref of parseWikiLinkText(text.slice(start, end))) {
      refs.push({ ...ref, offset: start + ref.offset, end: start + ref.end });
    }
  });
  return refs;
}

/** Parse literal bracket syntax inside an already identified Markdown text node. */
export function parseWikiLinkText(text: string): WikiLinkRef[] {
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

    const decoded = decodeString(body);
    if (/[\[\]\r\n]/.test(decoded)) {
      i = close + 2;
      continue;
    }
    const ref = parseBody(decoded, open, close + 2);
    if (ref) refs.push(ref);

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
    const label = ref.label.replace(/[\\`*_[\]<>]/g, '\\$&');
    result += `[${label}](${withAnchor})`;
    cursor = ref.end;
  }

  result += text.slice(cursor);
  return result;
}
