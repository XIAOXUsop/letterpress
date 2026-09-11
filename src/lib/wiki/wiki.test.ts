import { describe, expect, it } from 'vitest';
import { containsCjk, resolveSlug, slugify } from './slug.js';
import { findCodeSpans, parseWikiLinks, renderWikiLinks } from './wikilink.js';
import { buildGraph, type Doc } from './graph.js';
import { formatIssues, hasErrors, lint } from './lint.js';

// ─────────────────────────────────────────────────────────────────────
// slug
// ─────────────────────────────────────────────────────────────────────

describe('slugify', () => {
  /**
   * 这是本文件最重要的一组测试。
   *
   * npm 上主流 slugify 库的默认行为是把非 ASCII 全部删掉，中文标题
   * 产出空字符串。空 slug 会让所有中文文章塌到同一个路径互相覆盖——
   * 而且**不报错**，你只会在某天发现文章少了。
   */
  it('保留中文，而不是删成空字符串', () => {
    expect(slugify('论可复现的评测')).toBe('论可复现的评测');
    expect(slugify('论可复现的评测')).not.toBe('');
  });

  it('中英混排时两边都保留', () => {
    expect(slugify('Hello 世界')).toBe('hello-世界');
  });

  it('标点折叠成单个连字符，不留首尾连字符', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('  spaced  out  ')).toBe('spaced-out');
    expect(slugify('a---b')).toBe('a-b');
  });

  it('纯标点产出空串（调用方需自行兜底）', () => {
    expect(slugify('！！！')).toBe('');
    expect(slugify('---')).toBe('');
  });

  it('日文与韩文同样保留', () => {
    expect(slugify('こんにちは')).toBe('こんにちは');
    expect(slugify('안녕하세요')).toBe('안녕하세요');
  });

  it('emoji 被丢弃但不影响其余部分', () => {
    expect(slugify('发布 🎉 了')).toBe('发布-了');
  });

  it('超长标题被截断且不留尾部连字符', () => {
    const long = slugify('a'.repeat(200));
    expect(long.length).toBe(80);
    expect(long.endsWith('-')).toBe(false);
  });

  it('数字与下划线以外的符号都折叠', () => {
    expect(slugify('v0.2.0 发布')).toBe('v0-2-0-发布');
  });
});

describe('resolveSlug', () => {
  it('显式 slug 优先于文件名与标题', () => {
    expect(resolveSlug('论可复现的评测', 'reproducible-eval', 'some-file')).toBe('reproducible-eval');
  });

  /**
   * 文件名优先于标题，与 Hugo / Jekyll / Astro 一致。
   * 这也顺带解决中文标题的 URL 问题：文件用英文名，URL 就是英文。
   */
  it('文件名优先于标题', () => {
    expect(resolveSlug('你的博客该不该给 AI 一份 markdown', null, 'markdown-for-agents')).toBe(
      'markdown-for-agents',
    );
  });

  it('文件名里的路径分隔符折叠成连字符', () => {
    expect(resolveSlug('标题', null, 'notes/2026/hello')).toBe('notes-2026-hello');
  });

  it('文件名拿不出有效 slug 时退回标题', () => {
    expect(resolveSlug('标题', null, '！！！')).toBe('标题');
    expect(resolveSlug('标题', null, '')).toBe('标题');
    expect(resolveSlug('标题', null, null)).toBe('标题');
  });

  it('显式 slug 为空串时退回文件名，再退回标题', () => {
    expect(resolveSlug('标题', '', 'file-name')).toBe('file-name');
    expect(resolveSlug('Hello', '   ', null)).toBe('hello');
  });
});

describe('containsCjk', () => {
  it('识别中文', () => {
    expect(containsCjk('论可复现')).toBe(true);
    expect(containsCjk('hello-world')).toBe(false);
    expect(containsCjk('hello-世界')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// wikilink
// ─────────────────────────────────────────────────────────────────────

describe('parseWikiLinks', () => {
  it('解析基本形式', () => {
    const refs = parseWikiLinks('见 [[某页]] 一节。');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.target).toBe('某页');
    expect(refs[0]?.label).toBe('某页');
    expect(refs[0]?.anchor).toBeNull();
  });

  it('解析自定义显示文本', () => {
    const refs = parseWikiLinks('见 [[某页|那个页面]]。');
    expect(refs[0]?.target).toBe('某页');
    expect(refs[0]?.label).toBe('那个页面');
  });

  it('解析页内锚点', () => {
    const refs = parseWikiLinks('见 [[某页#小节]]。');
    expect(refs[0]?.target).toBe('某页');
    expect(refs[0]?.anchor).toBe('小节');
  });

  it('解析锚点与显示文本的组合', () => {
    const refs = parseWikiLinks('见 [[某页#小节|点这里]]。');
    expect(refs[0]?.target).toBe('某页');
    expect(refs[0]?.anchor).toBe('小节');
    expect(refs[0]?.label).toBe('点这里');
  });

  it('一篇文档里的多个链接都抽出来', () => {
    const refs = parseWikiLinks('[[a]] 和 [[b]] 以及 [[c|看 c]]');
    expect(refs.map((r) => r.target)).toEqual(['a', 'b', 'c']);
  });

  /**
   * 技术博客里讲解语法的文章必然出现 `[[foo]]` 字面量。
   * 如果这些也当成链接，lint 会报一堆断链——于是用户学会忽略 lint。
   */
  it('围栏代码块里的方括号不算链接', () => {
    const md = [
      '教程如下：',
      '',
      '```markdown',
      '在正文里写 [[某页]] 就能引用。',
      '```',
      '',
      '这里才是真的 [[真链接]]。',
    ].join('\n');

    const refs = parseWikiLinks(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.target).toBe('真链接');
  });

  it('行内代码里的方括号不算链接', () => {
    const refs = parseWikiLinks('写 `[[某页]]` 即可，例如 [[真链接]]。');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.target).toBe('真链接');
  });

  it('未闭合的围栏会让后面全部视为代码（与 CommonMark 一致）', () => {
    const md = '```\n[[不该算]]\n';
    expect(parseWikiLinks(md)).toHaveLength(0);
  });

  it('忽略空目标与自锚点', () => {
    expect(parseWikiLinks('[[#小节]]')).toHaveLength(0);
    expect(parseWikiLinks('[[]]')).toHaveLength(0);
    expect(parseWikiLinks('[[   ]]')).toHaveLength(0);
  });

  it('未闭合的链接不产生引用', () => {
    expect(parseWikiLinks('[[开头没结束')).toHaveLength(0);
  });

  it('嵌套方括号不会被误配', () => {
    // `[[a] [b]]` 的链接体里含 `[`，不是合法链接
    const refs = parseWikiLinks('[[a] [b]]');
    expect(refs).toHaveLength(0);
  });

  it('跨行的方括号不算链接', () => {
    expect(parseWikiLinks('[[跨\n行]]')).toHaveLength(0);
  });

  it('记录精确的起止偏移，供替换使用', () => {
    const text = '前 [[目标]] 后';
    const refs = parseWikiLinks(text);
    expect(text.slice(refs[0]!.offset, refs[0]!.end)).toBe('[[目标]]');
  });
});

describe('findCodeSpans', () => {
  it('识别围栏代码块', () => {
    const spans = findCodeSpans('前\n```\n中\n```\n后');
    expect(spans).toHaveLength(1);
  });

  it('识别行内代码', () => {
    const spans = findCodeSpans('前 `代码` 后');
    expect(spans).toHaveLength(1);
  });

  it('波浪号围栏同样识别', () => {
    expect(findCodeSpans('~~~\nx\n~~~')).toHaveLength(1);
  });

  it('四个反引号与三个反引号不互配', () => {
    // ```` 开的块不能被 ``` 闭合
    const spans = findCodeSpans('````\n```\n````');
    expect(spans).toHaveLength(1);
  });
});

describe('renderWikiLinks', () => {
  const resolve = (t: string) => (t === '存在' ? '/cunzai/' : null);

  it('把链接替换成标准 markdown', () => {
    expect(renderWikiLinks('见 [[存在]]。', resolve)).toBe('见 [存在](/cunzai/)。');
  });

  it('保留显示文本', () => {
    expect(renderWikiLinks('[[存在|点这里]]', resolve)).toBe('[点这里](/cunzai/)');
  });

  it('锚点被百分号编码', () => {
    expect(renderWikiLinks('[[存在#中文小节]]', resolve)).toBe('[存在](/cunzai/#%E4%B8%AD%E6%96%87%E5%B0%8F%E8%8A%82)');
  });

  /**
   * 断链**必须保持原样**，不能静默删掉。
   * 删掉的话读者看不到、作者也不知道自己写错了——而 lint 还指望能找到它。
   */
  it('断链保持原样，不静默删除', () => {
    expect(renderWikiLinks('见 [[不存在]]。', resolve)).toBe('见 [[不存在]]。');
  });

  it('代码块里的内容原样保留', () => {
    const md = '```\n[[存在]]\n```';
    expect(renderWikiLinks(md, resolve)).toBe(md);
  });

  it('多个链接混合真假时各按各的处理', () => {
    expect(renderWikiLinks('[[存在]] 与 [[不存在]]', resolve)).toBe('[存在](/cunzai/) 与 [[不存在]]');
  });

  it('没有链接时原样返回', () => {
    expect(renderWikiLinks('普通文本', resolve)).toBe('普通文本');
  });
});

// ─────────────────────────────────────────────────────────────────────
// graph
// ─────────────────────────────────────────────────────────────────────

function doc(over: Partial<Doc> & { slug: string }): Doc {
  return {
    kind: 'wiki',
    title: over.slug,
    summary: '摘要',
    body: '',
    explicitSlug: true,
    draft: false,
    ...over,
  };
}

describe('buildGraph', () => {
  it('建立入链与出链', () => {
    const graph = buildGraph([
      doc({ slug: 'a', body: '指向 [[b]]' }),
      doc({ slug: 'b' }),
    ]);

    expect(graph.backlinks.get('b')?.map((x) => x.fromSlug)).toEqual(['a']);
    expect([...(graph.outbound.get('a') ?? [])]).toEqual(['b']);
    expect(graph.broken).toHaveLength(0);
  });

  it('同时用 slug 与标题作为解析入口', () => {
    const graph = buildGraph([
      doc({ slug: 'concept-eval', title: '可复现评测' }),
      doc({ slug: 'post', body: '见 [[可复现评测]]' }),
    ]);
    expect(graph.broken).toHaveLength(0);
    expect(graph.backlinks.get('concept-eval')).toHaveLength(1);
  });

  it('解析大小写与空格的差异', () => {
    const graph = buildGraph([
      doc({ slug: 'my-page' }),
      doc({ slug: 'post', body: '[[My Page]]' }),
    ]);
    expect(graph.broken).toHaveLength(0);
  });

  it('记录断链', () => {
    const graph = buildGraph([doc({ slug: 'a', body: '[[不存在]]' })]);
    expect(graph.broken).toHaveLength(1);
    expect(graph.broken[0]?.target).toBe('不存在');
  });

  it('自链接不计入入链', () => {
    const graph = buildGraph([doc({ slug: 'a', body: '[[a]]' })]);
    expect(graph.backlinks.get('a')).toBeUndefined();
    expect(graph.orphans).toEqual(['a']);
  });

  it('同一来源重复链接同一目标只记一次入链', () => {
    const graph = buildGraph([
      doc({ slug: 'a', body: '[[b]] 又 [[b]]' }),
      doc({ slug: 'b' }),
    ]);
    expect(graph.backlinks.get('b')).toHaveLength(1);
  });

  it('草稿不参与链接图', () => {
    const graph = buildGraph([
      doc({ slug: 'a', draft: true, body: '[[b]]' }),
      doc({ slug: 'b', draft: true }),
    ]);
    expect(graph.bySlug.size).toBe(0);
    expect(graph.broken).toHaveLength(0);
  });

  it('孤儿页只统计 wiki 页，不含文章', () => {
    const graph = buildGraph([
      doc({ slug: 'post-1', kind: 'post' }),
      doc({ slug: 'wiki-1', kind: 'wiki' }),
    ]);
    expect(graph.orphans).toEqual(['wiki-1']);
  });

  /**
   * 输出必须可复现。否则每次构建的 diff 都在抖，
   * 「构建产物字节一致」这条契约就没法验。
   */
  it('输出顺序稳定，与输入顺序无关', () => {
    const docs = [
      doc({ slug: 'z', body: '[[a]]' }),
      doc({ slug: 'a', body: '[[z]]' }),
      doc({ slug: 'm', body: '[[不存在]]' }),
    ];
    const forward = buildGraph(docs);
    const backward = buildGraph([...docs].reverse());

    expect(forward.orphans).toEqual(backward.orphans);
    expect(forward.broken.map((b) => b.fromSlug)).toEqual(backward.broken.map((b) => b.fromSlug));
  });
});

// ─────────────────────────────────────────────────────────────────────
// lint
// ─────────────────────────────────────────────────────────────────────

describe('lint', () => {
  it('干净的知识库没有任何问题', () => {
    const docs = [
      doc({ slug: 'a', title: 'A', body: '指向 [[b]]' }),
      doc({ slug: 'b', title: 'B', body: '指向 [[a]]' }),
    ];
    expect(lint(docs, buildGraph(docs))).toEqual([]);
  });

  it('断链是错误级', () => {
    // 用两篇互相引用、其中一篇又引用了不存在的页面，避免把「孤儿页」
    // 也带进来——这条测试要验的是断链，不是孤儿。
    const docs = [
      doc({ slug: 'a', body: '[[不存在]] 与 [[b]]' }),
      doc({ slug: 'b', body: '[[a]]' }),
    ];
    const issues = lint(docs, buildGraph(docs));

    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('broken-wikilink');
    expect(issues[0]?.level).toBe('error');
    expect(hasErrors(issues)).toBe(true);
  });

  it('重复 slug 是错误级，且把冲突双方都列出来', () => {
    const docs = [
      doc({ slug: 'same', title: '第一篇' }),
      doc({ slug: 'same', title: '第二篇' }),
    ];
    const issues = lint(docs, buildGraph(docs));
    const dup = issues.find((i) => i.rule === 'duplicate-slug');
    expect(dup?.level).toBe('error');
    expect(dup?.message).toContain('第一篇');
    expect(dup?.message).toContain('第二篇');
  });

  it('孤儿页是警告级', () => {
    const docs = [doc({ slug: 'lonely', title: '没人引用我' })];
    const issues = lint(docs, buildGraph(docs));
    expect(issues.find((i) => i.rule === 'orphan-page')?.level).toBe('warn');
  });

  it('缺摘要是警告级', () => {
    const docs = [doc({ slug: 'a', summary: '', body: '[[a]]' })];
    const issues = lint(docs, buildGraph(docs));
    expect(issues.find((i) => i.rule === 'missing-summary')?.level).toBe('warn');
  });

  it('摘要过长是提示级', () => {
    const docs = [doc({ slug: 'a', summary: 'x'.repeat(300), body: '[[a]]' })];
    const issues = lint(docs, buildGraph(docs));
    expect(issues.find((i) => i.rule === 'summary-too-long')?.level).toBe('info');
  });

  it('空正文是警告级', () => {
    const docs = [doc({ slug: 'a', body: '' })];
    const issues = lint(docs, buildGraph(docs));
    expect(issues.find((i) => i.rule === 'empty-body')?.level).toBe('warn');
  });

  it('草稿不产生任何告警', () => {
    const docs = [doc({ slug: 'a', draft: true, summary: '', body: '' })];
    expect(lint(docs, buildGraph(docs))).toEqual([]);
  });

  /**
   * 中文 slug 提示**默认关闭**：保留 CJK 的 URL 合法且好读，
   * 不该一上来就报警。打开后也只是 info，因为这是取舍不是错误。
   */
  it('中文 slug 提示默认关闭，开启后为提示级', () => {
    const docs = [
      doc({ slug: '论评测', title: '论评测', explicitSlug: false, body: '[[论评测]]' }),
    ];
    const graph = buildGraph(docs);

    expect(lint(docs, graph).some((i) => i.rule === 'cjk-slug')).toBe(false);

    const on = lint(docs, graph, { warnOnCjkSlug: true });
    expect(on.find((i) => i.rule === 'cjk-slug')?.level).toBe('info');
  });

  it('显式指定过 slug 的中文页不提示', () => {
    const docs = [doc({ slug: '论评测', title: '论评测', explicitSlug: true })];
    const on = lint(docs, buildGraph(docs), { warnOnCjkSlug: true });
    expect(on.some((i) => i.rule === 'cjk-slug')).toBe(false);
  });

  it('输出按级别稳定排序', () => {
    const docs = [
      doc({ slug: 'a', summary: '', body: '[[不存在]]' }),
      doc({ slug: 'b', summary: '' }),
    ];
    const issues = lint(docs, buildGraph(docs));
    const levels = issues.map((i) => i.level);
    expect(levels.indexOf('error')).toBeLessThan(levels.indexOf('warn'));
  });

  it('报告可读，且说清为什么是问题', () => {
    const issues = lint([doc({ slug: 'a', body: '[[不存在]]' })], buildGraph([doc({ slug: 'a', body: '[[不存在]]' })]));
    const text = formatIssues(issues);
    expect(text).toContain('错误');
    expect(text).toContain('broken-wikilink');
    // 不只是一句「违反了规则」，要说明后果
    expect(text).toContain('知识库');
  });

  it('没有问题时给出明确通过结论', () => {
    expect(formatIssues([])).toContain('通过');
  });
});
