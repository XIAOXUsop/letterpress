import { describe, expect, it } from 'vitest';
import { buildGraph, type Doc } from './graph.js';
import { buildLlmsFullTxt, buildLlmsTxt, buildMarkdownTwin, stats } from './llms.js';

function doc(over: Partial<Doc> & { slug: string }): Doc {
  return {
    kind: 'wiki',
    title: over.slug,
    summary: '摘要',
    body: '正文',
    explicitSlug: true,
    draft: false,
    date: 0,
    ...over,
  };
}

const OPTIONS = {
  siteName: '示例站',
  siteUrl: 'https://example.com',
  tagline: '一句话说清这个站是什么',
  notes: ['内容以中文为主。'],
};

describe('buildLlmsTxt', () => {
  const docs = [
    doc({ slug: 'concept-a', kind: 'wiki', title: '概念 A', summary: 'A 是什么' }),
    doc({ slug: 'post-1', kind: 'post', title: '文章一', summary: '讲了什么' }),
  ];

  it('H1 有且只有一个', () => {
    const txt = buildLlmsTxt(docs, OPTIONS);
    expect(txt.match(/^# /gm)).toHaveLength(1);
  });

  it('定位用 blockquote 紧随其后', () => {
    const lines = buildLlmsTxt(docs, OPTIONS).split('\n');
    expect(lines[0]).toBe('# 示例站');
    expect(lines[2]).toBe('> 一句话说清这个站是什么');
  });

  it('知识层排在文章之前（这是目录，不是归档）', () => {
    const txt = buildLlmsTxt(docs, OPTIONS);
    expect(txt.indexOf('## 知识层')).toBeLessThan(txt.indexOf('## 文章'));
  });

  it('条目是「链接 + 一句话说明」的格式', () => {
    const txt = buildLlmsTxt(docs, OPTIONS);
    expect(txt).toContain('- [概念 A](https://example.com/wiki/concept-a/): A 是什么');
    expect(txt).toContain('- [文章一](https://example.com/post-1/): 讲了什么');
  });

  it('没有 siteUrl 时用相对路径', () => {
    const txt = buildLlmsTxt(docs, { ...OPTIONS, siteUrl: undefined });
    expect(txt).toContain('(/wiki/concept-a/)');
  });

  it('草稿不出现在目录里', () => {
    const withDraft = [...docs, doc({ slug: 'draft-1', title: '草稿', draft: true })];
    expect(buildLlmsTxt(withDraft, OPTIONS)).not.toContain('草稿');
  });

  it('空的分类不输出标题', () => {
    const txt = buildLlmsTxt([doc({ slug: 'w' })], OPTIONS);
    expect(txt).toContain('## 知识层');
    expect(txt).not.toContain('## 文章');
  });

  /**
   * 缺摘要时不能省掉冒号——格式要求每行都有说明。
   * 省掉会让解析器把这一行当成纯链接，而且掩盖了「这页没写摘要」这件事。
   */
  it('缺摘要时仍保持格式完整', () => {
    const txt = buildLlmsTxt([doc({ slug: 'a', summary: '' })], OPTIONS);
    expect(txt).toContain('- [a](https://example.com/wiki/a/): （暂无摘要）');
  });

  it('注释段被写进正文', () => {
    expect(buildLlmsTxt(docs, OPTIONS)).toContain('内容以中文为主。');
  });
});

describe('buildLlmsFullTxt', () => {
  it('每篇用 doc 标签包裹并带路径', () => {
    const txt = buildLlmsFullTxt(
      [doc({ slug: 'a', title: '标题 A', body: '正文内容' })],
      OPTIONS,
    );
    expect(txt).toContain('<doc title="标题 A" path="wiki/a.md">');
    expect(txt).toContain('</doc>');
    expect(txt).toContain('正文内容');
  });

  it('标题里的引号被转义，不会破坏属性', () => {
    const txt = buildLlmsFullTxt([doc({ slug: 'a', title: '带 "引号" 的标题' })], OPTIONS);
    expect(txt).toContain('title="带 &quot;引号&quot; 的标题"');
  });

  it('内联了全部内容，因此不需要 agent 再遍历', () => {
    const docs = [doc({ slug: 'a', body: 'AAA' }), doc({ slug: 'b', body: 'BBB' })];
    const txt = buildLlmsFullTxt(docs, OPTIONS);
    expect(txt).toContain('AAA');
    expect(txt).toContain('BBB');
  });

  it('草稿不被内联', () => {
    const txt = buildLlmsFullTxt([doc({ slug: 'd', body: '机密', draft: true })], OPTIONS);
    expect(txt).not.toContain('机密');
  });
});

describe('buildMarkdownTwin', () => {
  const docs = [
    doc({ slug: 'target', title: '被引用的页', body: '目标正文' }),
    doc({ slug: 'source', title: '来源页', body: '[[target]]' }),
  ];
  const graph = buildGraph(docs);

  it('标题与摘要放在最前', () => {
    const md = buildMarkdownTwin(docs[0]!, graph, {});
    const lines = md.split('\n');
    expect(lines[0]).toBe('# 被引用的页');
    expect(lines[2]).toBe('> 摘要');
  });

  it('列出被引用关系——这是 agent 判断重要性的信号', () => {
    const md = buildMarkdownTwin(docs[0]!, graph, {});
    expect(md).toContain('## 被引用');
    // wiki 页的 URL 带 /wiki/ 前缀，与文章区分
    expect(md).toContain('[来源页](/wiki/source/)');
  });

  it('没有入链时不输出空的「被引用」小节', () => {
    const md = buildMarkdownTwin(docs[1]!, graph, {});
    expect(md).not.toContain('## 被引用');
  });

  it('带 siteUrl 时元信息里的链接是绝对地址', () => {
    const md = buildMarkdownTwin(docs[0]!, graph, { siteUrl: 'https://example.com' });
    expect(md).toContain('来源：https://example.com/wiki/target/');
  });

  it('正文原样保留', () => {
    expect(buildMarkdownTwin(docs[0]!, graph, {})).toContain('目标正文');
  });
});

describe('stats', () => {
  it('统计各类数量与平均连接度', () => {
    const docs = [
      doc({ slug: 'w1', kind: 'wiki', body: '[[w2]]' }),
      doc({ slug: 'w2', kind: 'wiki', body: '[[w1]]' }),
      doc({ slug: 'p1', kind: 'post', body: '[[w1]]' }),
    ];
    const s = stats(docs, buildGraph(docs));

    expect(s.posts).toBe(1);
    expect(s.wikiPages).toBe(2);
    expect(s.links).toBe(3);
    expect(s.orphans).toBe(0);
    expect(s.broken).toBe(0);
    expect(s.avgOutbound).toBe(1);
  });

  it('空集合不除零', () => {
    const s = stats([], buildGraph([]));
    expect(s.avgOutbound).toBe(0);
  });

  it('草稿不计入', () => {
    const s = stats([doc({ slug: 'd', draft: true })], buildGraph([doc({ slug: 'd', draft: true })]));
    expect(s.wikiPages).toBe(0);
  });
});
