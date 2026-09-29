import { describe, expect, it } from 'vitest';
import { rehypeMermaid } from './rehype-mermaid.js';
import type { Root, Element } from 'hast';

/**
 * mermaid 代码块转换的单元测试。
 *
 * ── 为什么它需要测试 ────────────────────────────────────────────────
 *
 * 2026-09-29 这个插件写完时**构建是绿的、图却没生效**，
 * 而**46 步门禁没有一条发现它**。那次靠的是人肉看产物——
 * **而「人肉看」不是机制**。
 *
 * 根因是 Shiki 抢在 rehype 插件之前处理代码块：
 * `language-mermaid` 被换成了 `astro-code`，
 * 原始语言标记被搬到 `pre` 上的 `data-language`。
 *
 * > **「构建通过」与「功能生效」在输出上完全一样**——
 * > 而这两条输入（`data-language` 在 `pre` 上 vs 在 `code` 的 class 上）
 * > **在 2026-09-29 之前没有一条测试覆盖**。
 */

/** 造一棵最小的 hast 树：一段带语言标记的代码块。 */
function treeWith(opts: {
  preClass?: string[];
  preDataLanguage?: string;
  codeClass?: string[];
  /** 子节点形态：纯文本 / 带高亮 span（Shiki 的产物） */
  highlighted?: boolean;
  value?: string;
}): Root {
  const inner: Element['children'] = opts.highlighted
    ? [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['line'] },
          children: [{ type: 'text', value: opts.value ?? 'flowchart TD' }],
        },
      ]
    : [{ type: 'text', value: opts.value ?? 'flowchart TD' }];

  return {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'pre',
        properties: {
          ...(opts.preClass ? { className: opts.preClass } : {}),
          ...(opts.preDataLanguage ? { dataLanguage: opts.preDataLanguage } : {}),
        },
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: opts.codeClass ? { className: opts.codeClass } : {},
            children: inner,
          },
        ],
      },
    ],
  };
}

const firstPre = (t: Root) => t.children[0] as Element;
const isMermaid = (t: Root) => {
  const cls = firstPre(t).properties?.className;
  return Array.isArray(cls) && cls.includes('mermaid');
};

describe('rehypeMermaid', () => {
  it('认 Shiki 加工后的形状（语言标记在 pre 的 data-language 上）', () => {
    // ⚠️ **这一条是 2026-09-29 那次失效的真实输入形状。**
    const t = treeWith({
      preClass: ['astro-code', 'astro-code-themes'],
      preDataLanguage: 'mermaid',
      highlighted: true,
    });
    rehypeMermaid()(t);
    expect(isMermaid(t)).toBe(true);
  });

  it('认 remark 默认的形状（class 里的 language-mermaid）', () => {
    const t = treeWith({ codeClass: ['language-mermaid'] });
    rehypeMermaid()(t);
    expect(isMermaid(t)).toBe(true);
  });

  it('剥掉语法高亮的 span——留着会让 mermaid 解析失败', () => {
    const t = treeWith({
      preClass: ['astro-code'],
      preDataLanguage: 'mermaid',
      highlighted: true,
      value: 'graph TD\n  A-->B',
    });
    rehypeMermaid()(t);
    const pre = firstPre(t);
    // 子节点必须只剩一个纯文本
    expect(pre.children).toHaveLength(1);
    expect(pre.children[0]).toEqual({ type: 'text', value: 'graph TD\n  A-->B' });
  });

  it('不碰非 mermaid 的代码块', () => {
    const t = treeWith({
      preClass: ['astro-code'],
      preDataLanguage: 'css',
      value: '.a { color: red }',
    });
    rehypeMermaid()(t);
    expect(isMermaid(t)).toBe(false);
    // ⚠️ **而且不能动它的内容**——那是别的代码块，动了就是回归
    expect(JSON.stringify(firstPre(t))).toContain('.a { color: red }');
  });

  it('不碰没有语言标记的 pre', () => {
    const t = treeWith({ preClass: ['astro-code'] });
    rehypeMermaid()(t);
    expect(isMermaid(t)).toBe(false);
  });

  it('空代码块不动（mermaid 遇到空源码会渲染出一个空框）', () => {
    const t = treeWith({
      preClass: ['astro-code'],
      preDataLanguage: 'mermaid',
      value: '   \n  ',
    });
    rehypeMermaid()(t);
    expect(isMermaid(t)).toBe(false);
  });

  it('已经是 mermaid 形状的不重复处理（插件在管线里可能跑多次）', () => {
    const t = treeWith({ preClass: ['astro-code'], preDataLanguage: 'mermaid' });
    rehypeMermaid()(t);
    const once = JSON.stringify(firstPre(t));
    rehypeMermaid()(t);
    expect(JSON.stringify(firstPre(t))).toBe(once);
  });

  it('enabled: false 时整条管线变成空操作', () => {
    const t = treeWith({ preClass: ['astro-code'], preDataLanguage: 'mermaid' });
    rehypeMermaid({ enabled: false })(t);
    expect(isMermaid(t)).toBe(false);
  });
});
