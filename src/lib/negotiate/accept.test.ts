import { describe, expect, it } from 'vitest';
import {
  MARKDOWN_CONTENT_TYPE,
  estimateTokens,
  parseAccept,
  prefersMarkdown,
} from './accept.js';

/**
 * 这些 Accept 头**不是编出来的**，是 2026-02 对真实 agent 实测抓到的原文
 * （Checkly《The Current State of Content Negotiation for AI Agents》）。
 * 固件取自真实流量这件事本身很重要：自己编的固件只会验证自己以为的语义。
 */
const REAL_AGENT_HEADERS = {
  'Claude Code': 'text/markdown, text/html, */*',
  'Cursor': 'text/markdown,text/html;q=0.9,application/xhtml+xml;q=0.8,application/xml;q=0.7,image/webp;q=0.6,*/*;q=0.5',
  'OpenCode': 'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1',
  'Codex': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
  'Gemini CLI': '*/*',
  'Copilot': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Windsurf': '*/*',
} as const;

describe('prefersMarkdown — 真实 agent 请求头', () => {
  // 每一条都注明「为什么」，因为判定结果本身不直观
  const expectations: ReadonlyArray<readonly [keyof typeof REAL_AGENT_HEADERS, boolean, string]> = [
    ['Claude Code', true, '显式要 markdown 且排在 html 前面；不写 q 值，靠顺序取胜'],
    ['Cursor', true, 'markdown q=1.0 高于 html q=0.9'],
    ['OpenCode', true, 'markdown q=1.0 高于 html q=0.7'],
    ['Codex', false, '从头到尾没提 markdown'],
    ['Gemini CLI', false, '只发通配符，意思是「给什么都行」，不是「要 markdown」'],
    ['Copilot', false, '没提 markdown'],
    ['Windsurf', false, '只发通配符'],
  ];

  it.each(expectations)('%s → %s（%s）', (agent, expected) => {
    expect(prefersMarkdown(REAL_AGENT_HEADERS[agent])).toBe(expected);
  });

  it('七个真实 agent 里恰好三个要 markdown，与实测一致', () => {
    const requesting = Object.values(REAL_AGENT_HEADERS).filter((h) => prefersMarkdown(h));
    expect(requesting).toHaveLength(3);
  });
});

describe('prefersMarkdown — 会把实现写错的地方', () => {
  /**
   * 这是整个文件里最重要的一条。
   *
   * Claude Code 不写 q 值，`text/markdown` 与 `text/html` 因此都是 q=1.0。
   * 用严格的 `>` 比较（`if (md.q > html.q)`）会判定为「没有偏好」并落到默认的
   * HTML 上——**不报错、不警告，只是永远不生效**。必须平局时比顺序。
   */
  it('q 平局时靠前者胜出，而不是判给 HTML', () => {
    expect(prefersMarkdown('text/markdown, text/html')).toBe(true);
    expect(prefersMarkdown('text/html, text/markdown')).toBe(false);
  });

  /**
   * 通配符必须被排除在 markdown 候选之外。
   * 否则它会让两侧同时命中且 q 相同，Gemini CLI 与 Windsurf 会被塞 markdown。
   */
  it('通配符不构成对 markdown 的偏好', () => {
    expect(prefersMarkdown('*/*')).toBe(false);
    expect(prefersMarkdown('text/*')).toBe(false);
    expect(prefersMarkdown('*/*;q=1.0, text/html;q=0.9')).toBe(false);
  });

  it('通配符可以成为 HTML 一侧的备选', () => {
    // 只要 markdown 是显式声明的，通配符就足以证明「HTML 也是可接受的」，
    // 于是比较退化为 markdown 与通配符之间的 q 值 / 顺序比较。
    expect(prefersMarkdown('text/markdown;q=0.9, */*;q=0.5')).toBe(true);
    expect(prefersMarkdown('*/*;q=0.9, text/markdown;q=0.5')).toBe(false);
  });

  /**
   * RFC 9110 §12.5.1：先用最具体的媒体范围确定某个表示的质量，再比较 q。
   * 不能先挑 q 最大的范围，否则宽泛通配符会覆盖客户端对 HTML 的明确降权/拒绝。
   */
  it('具体 HTML 类型优先于 q 更高的全局通配符', () => {
    expect(prefersMarkdown('text/html;q=0.2, */*;q=0.9, text/markdown;q=0.5')).toBe(true);
  });

  it('具体 HTML 拒绝不能被全局通配符重新放行', () => {
    expect(prefersMarkdown('text/html;q=0, */*;q=1, text/markdown;q=0.5')).toBe(true);
  });

  it('类型通配符比全局通配符更具体', () => {
    expect(prefersMarkdown('*/*;q=0.9, text/*;q=0.2, text/markdown;q=0.5')).toBe(true);
  });

  /**
   * `text/plain` 是 OpenCode 的降级选项，不是 markdown 请求。
   * 宁可漏给（客户端仍拿到可用的 HTML），不可错给。
   */
  it('text/plain 不当作 markdown 请求', () => {
    expect(prefersMarkdown('text/plain')).toBe(false);
    expect(prefersMarkdown('text/plain, text/html')).toBe(false);
  });

  it('text/x-markdown 是 markdown 的合法别名', () => {
    expect(prefersMarkdown('text/x-markdown')).toBe(true);
    expect(prefersMarkdown('text/x-markdown;q=0.8, text/html;q=0.5')).toBe(true);
  });

  it('q=0 表示明确拒绝，不得被当作偏好', () => {
    expect(prefersMarkdown('text/markdown;q=0, text/html')).toBe(false);
    expect(prefersMarkdown('text/markdown;q=0')).toBe(false);
  });
});

describe('parseAccept — 畸形输入', () => {
  // Accept 头来自网络，畸形是常态。这里要的不是「正确」而是「不崩、不误判」。
  const malformed = [
    '',
    '   ',
    ',,,',
    'garbage',
    'text',
    '/',
    'text/',
    '/markdown',
    'text/markdown;q=',
    'text/markdown;q=abc',
    'text/markdown;q=99',
    'text/markdown;q=-1',
    ';;;',
    'TEXT/MARKDOWN',
  ];

  it.each(malformed)('不会抛异常：%j', (header) => {
    expect(() => prefersMarkdown(header)).not.toThrow();
  });

  it('null 与 undefined 一律返回 false', () => {
    expect(prefersMarkdown(null)).toBe(false);
    expect(prefersMarkdown(undefined)).toBe(false);
  });

  it('大小写不敏感', () => {
    expect(prefersMarkdown('TEXT/MARKDOWN')).toBe(true);
    expect(prefersMarkdown('Text/Markdown;Q=0.9, Text/Html;Q=0.5')).toBe(true);
  });

  it('越界的 q 值退回缺省 1.0，而不是当成 0', () => {
    // 当成 0 会让「客户端发了个格式怪的头」变成「客户端拒绝了 markdown」，
    // 但前者显然更接近事实。
    const [range] = parseAccept('text/markdown;q=99');
    expect(range?.q).toBe(1);
  });

  it('忽略除 q 以外的参数', () => {
    expect(prefersMarkdown('text/markdown;charset=utf-8;level=1, text/html;q=0.5')).toBe(true);
  });

  it('容忍多余空白', () => {
    expect(prefersMarkdown('  text/markdown  ,   text/html;q=0.5  ')).toBe(true);
  });
});

describe('estimateTokens', () => {
  it('纯 CJK 约每字一 token', () => {
    // 中文一个字通常就是一个 token，用西文的 4 字符/token 会低估到四分之一
    expect(estimateTokens('中文内容')).toBe(4);
  });

  it('纯西文约每四字符一 token', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('中英混排各自计算', () => {
    // 4 个汉字 + 8 个西文字符 = 4 + 2
    expect(estimateTokens('中文内容abcdefgh')).toBe(6);
  });

  it('空串为 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('宁可高估也不低估（向上取整）', () => {
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('内容类型常量', () => {
  it('带 charset，避免客户端按 latin-1 解读中文', () => {
    expect(MARKDOWN_CONTENT_TYPE).toBe('text/markdown; charset=utf-8');
  });
});
