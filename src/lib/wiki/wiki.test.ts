import { describe, expect, it } from 'vitest';
import { containsCjk, resolveSlug, slugify } from './slug.js';
import { findCodeSpans, parseWikiLinks, renderWikiLinks } from './wikilink.js';
import { buildGraph, urlFor, urlOf, type Doc } from './graph.js';
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

  /**
   * 开发模式下草稿要参与链接图。
   *
   * 作者在 `npm run dev` 里预览未完成的文章时，那篇文章正文里的
   * `[[链接]]` 也必须被解析——否则草稿页面上所有链接都显示成方括号，
   * 看起来像功能坏了，而实际只是「草稿被排除了」。
   */
  it('includeDrafts 打开时草稿参与链接图', () => {
    const docs = [
      doc({ slug: 'draft-post', kind: 'post', draft: true, body: '指向 [[target]]' }),
      doc({ slug: 'target' }),
    ];

    const without = buildGraph(docs);
    expect(without.bySlug.has('draft-post')).toBe(false);

    const withDrafts = buildGraph(docs, { includeDrafts: true });
    expect(withDrafts.bySlug.has('draft-post')).toBe(true);
    expect(withDrafts.broken).toHaveLength(0);
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

  it('文章不能占用系统路由，否则 HTML 会被静默跳过', () => {
    const docs = [doc({ slug: 'about', title: '我的文章', kind: 'post' })];
    const issue = lint(docs, buildGraph(docs)).find((item) => item.rule === 'reserved-post-slug');

    expect(issue?.level).toBe('error');
    expect(issue?.message).toContain('/about/');
    expect(issue?.message).toContain('文章 HTML');
  });

  it('所有根层系统路由都受保护', () => {
    const reserved = ['404', 'about', 'archive', 'posts', 'search', 'tags', 'wiki'];
    for (const slug of reserved) {
      const docs = [doc({ slug, kind: 'post' })];
      expect(lint(docs, buildGraph(docs)).some((item) => item.rule === 'reserved-post-slug')).toBe(
        true,
      );
    }
  });

  it('知识库条目有命名空间，不误报与根层页面同名的 slug', () => {
    const docs = [doc({ slug: 'about', kind: 'wiki' })];
    expect(lint(docs, buildGraph(docs)).some((item) => item.rule === 'reserved-post-slug')).toBe(
      false,
    );
  });

  it('草稿即使使用保留 slug 也不阻塞生产构建', () => {
    const docs = [doc({ slug: 'about', kind: 'post', draft: true })];
    expect(lint(docs, buildGraph(docs)).some((item) => item.rule === 'reserved-post-slug')).toBe(
      false,
    );
  });

  /*
   * ── 2026-09-24：保留路由表改为可注入 ──────────────────────────────
   *
   * 这三条对着路线图阶段 4 第 6 项「剥离仅属于当前站点的展示逻辑」写。
   * 之前那 7 条是模块级常量、函数签名里没有注入口——
   * 第二个站点（如只有 `about` 与 `search`）要用它就得改核心源码。
   */

  it('保留路由表可以由调用方换成另一个站点的', () => {
    const docs = [doc({ slug: 'notes', kind: 'post' })];
    // 默认（本站）不认识 `notes`，所以不报
    expect(lint(docs, buildGraph(docs)).some((i) => i.rule === 'reserved-post-slug')).toBe(false);

    // 换一张表：`notes` 成了那个站点自己的路由，立刻要报
    const withTable = new Map([['notes', '文章列表']]);
    const issue = lint(docs, buildGraph(docs), { reservedPostRoutes: withTable }).find(
      (i) => i.rule === 'reserved-post-slug',
    );
    expect(issue?.level).toBe('error');
    expect(issue?.message).toContain('/notes/');
    expect(issue?.message).toContain('文章列表');
  });

  it('注入的表**取代**默认表，而不是与之合并', () => {
    // 若实现写成「两张表都查」，`about` 在注入表里不存在也仍会报——那就等于没注入
    const docs = [doc({ slug: 'about', kind: 'post' })];
    const issue = lint(docs, buildGraph(docs), { reservedPostRoutes: new Map([['notes', 'x']]) }).find(
      (i) => i.rule === 'reserved-post-slug',
    );
    expect(issue).toBeUndefined();
  });

  it('空表意味着「这个站点没有保留路由」，而不是「退回默认」', () => {
    const docs = [doc({ slug: 'about', kind: 'post' })];
    const issue = lint(docs, buildGraph(docs), { reservedPostRoutes: new Map() }).find(
      (i) => i.rule === 'reserved-post-slug',
    );
    expect(issue).toBeUndefined();
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

// ─────────────────────────────────────────────────────────────────────
// 同名标题歧义
// ─────────────────────────────────────────────────────────────────────

describe('同名标题：不能按遍历顺序任选一个', () => {
  /**
   * 这一组的存在理由是一次实测（2026-09-22）：
   *
   * 两篇文档都用标题「Shared」。调换输入顺序，同一个 `[[Shared]]`
   * **分别指向 a 和 b**，而两次 lint 都报 0 个错误——
   * 链接目标由文件顺序决定，没有任何东西发现。
   *
   * 下面第一条就是把这个性质钉死：**两种顺序必须给出同样多的歧义错误**。
   */
  const a = doc({ slug: 'a', title: 'Shared', body: '指向 [[Shared]]' });
  const b = doc({ slug: 'b', title: 'Shared', body: '没有链接' });

  it('调换输入顺序，结论必须一样（原 bug 就是顺序决定目标）', () => {
    const first = lint([a, b], buildGraph([a, b]));
    const second = lint([b, a], buildGraph([b, a]));
    const pick = (issues: ReturnType<typeof lint>) =>
      issues.filter((i) => i.rule === 'ambiguous-wikilink').length;
    expect(pick(first)).toBe(1);
    expect(pick(second)).toBe(1);
  });

  it('歧义标题不进查找表——不能解析成其中随便一个', () => {
    const graph = buildGraph([a, b]);
    expect(graph.lookup.has('shared')).toBe(false);
    expect(graph.ambiguousTitles.get('shared')).toEqual(['a', 'b']);
  });

  it('用了歧义标题 = error，并列出全部候选 slug', () => {
    const issues = lint([a, b], buildGraph([a, b]));
    const hit = issues.find((i) => i.rule === 'ambiguous-wikilink');
    expect(hit?.level).toBe('error');
    // 候选必须列全，作者才知道该选哪个
    expect(hit?.message).toContain('[[a]]');
    expect(hit?.message).toContain('[[b]]');
    expect(hit?.message).toContain('不能替作者选一个');
  });

  it('显式 slug 引用不受影响', () => {
    // 注意 a 自己的正文里就有 [[Shared]]，所以歧义记录仍会有**一条**——
    // 那条来自 a。这里要断言的是 **c 的 [[a]] 正常解析**，
    // 以及 c 的引用**没有**被算成歧义。
    const c = doc({ slug: 'c', title: 'C', body: '指向 [[a]]' });
    const graph = buildGraph([a, b, c]);
    expect(graph.lookup.get('a')).toBe('a');
    expect(graph.ambiguous.map((x) => x.fromSlug)).toEqual(['a']);
    expect(graph.backlinks.get('a')?.some((bl) => bl.fromSlug === 'c')).toBe(true);
  });

  it('歧义标题存在但没人引用 = warn，不阻断构建', () => {
    const issues = lint([a, b], buildGraph([a, b]));
    // 把 a 的链接去掉，歧义就只剩"存在"这一档
    const quiet = doc({ slug: 'a', title: 'Shared', body: '没有链接' });
    const only = lint([quiet, b], buildGraph([quiet, b]));
    const warn = only.find((i) => i.rule === 'ambiguous-title');
    expect(warn?.level).toBe('warn');
    expect(hasErrors(only)).toBe(false);
    // 而上面那个有引用的场景必须阻断
    expect(hasErrors(issues)).toBe(true);
  });

  it('只有一个主人的标题照常可用', () => {
    const x = doc({ slug: 'x', title: '独一无二', body: '' });
    const y = doc({ slug: 'y', title: 'Y', body: '指向 [[独一无二]]' });
    const graph = buildGraph([x, y]);
    expect(graph.lookup.get('独一无二')).toBe('x');
    expect(graph.ambiguousTitles.size).toBe(0);
  });

  it('标题与另一页的 slug 同名时，slug 赢', () => {
    // 不能因为建标题表而把 slug 入口覆盖掉
    const p1 = doc({ slug: 'topic', title: '主题', body: '' });
    const p2 = doc({ slug: 'other', title: 'topic', body: '' });
    const graph = buildGraph([p1, p2]);
    expect(graph.lookup.get('topic')).toBe('topic');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 两条引用通道的重叠
// ─────────────────────────────────────────────────────────────────────

/**
 * 正文 `[[wikilink]]` 与 frontmatter `related` 是**两条并行的引用通道**。
 *
 * 代价在实测里出现过：2026-09-24 做改名实验时，改完正文 `[[...]]`
 * 才发现 `related` 里也有同一个目标，于是构建被 `broken-wikilink` 拦下。
 * **只搜一种写法就会漏**，而漏了不会报错，只会在改名那天突然构建失败。
 *
 * 图用 `Set` 去重，所以它**不算错**——重复声明是无害的。
 * 这里量的是「有几处需要同步」，好让维护成本可见，而不是出错时才被发现。
 */
describe('redundantRelations', () => {
  it('同一目标被正文与 related 各写一次 → 记下来', () => {
    const a = doc({ slug: 'a', body: '指向 [[b]]', declaredRelations: ['b'] });
    const b = doc({ slug: 'b' });
    const graph = buildGraph([a, b]);
    expect(graph.redundantRelations.get('a')).toEqual(['b']);
  });

  it('只用 related 声明不算重复——那是它的正常用法', () => {
    const a = doc({ slug: 'a', body: '', declaredRelations: ['b'] });
    const b = doc({ slug: 'b' });
    const graph = buildGraph([a, b]);
    expect(graph.redundantRelations.size).toBe(0);
  });

  it('只在正文里链接也不算重复', () => {
    const a = doc({ slug: 'a', body: '指向 [[b]]' });
    const b = doc({ slug: 'b' });
    expect(buildGraph([a, b]).redundantRelations.size).toBe(0);
  });

  it('按解析后的目标比，不按字面比', () => {
    // related 写标题、正文写 slug——指向同一页，也算重复。
    // 只比字符串的话这两种写法看起来不同，重复就漏了。
    const a = doc({ slug: 'a', body: '指向 [[b]]', declaredRelations: ['标题B'] });
    const b = doc({ slug: 'b', title: '标题B' });
    const graph = buildGraph([a, b]);
    expect(graph.redundantRelations.get('a')).toEqual(['b']);
  });

  it('related 写了两遍同一个目标只记一次', () => {
    const a = doc({ slug: 'a', body: '指向 [[b]]', declaredRelations: ['b', 'b'] });
    const b = doc({ slug: 'b' });
    expect(buildGraph([a, b]).redundantRelations.get('a')).toEqual(['b']);
  });

  it('多个重复目标按字典序排好，保证输出可复现', () => {
    const a = doc({ slug: 'a', body: '[[c]] [[b]]', declaredRelations: ['c', 'b'] });
    const graph = buildGraph([a, doc({ slug: 'b' }), doc({ slug: 'c' })]);
    expect(graph.redundantRelations.get('a')).toEqual(['b', 'c']);
  });

  it('解析不了的 related 不算重复——那是断链，由另一条规则报', () => {
    const a = doc({ slug: 'a', body: '指向 [[b]]', declaredRelations: ['不存在'] });
    const b = doc({ slug: 'b' });
    const graph = buildGraph([a, b]);
    expect(graph.redundantRelations.size).toBe(0);
    expect(graph.broken.map((x) => x.target)).toContain('不存在');
  });

  it('重复声明不产生重复的边——图不会因此算错', () => {
    // 这条钉住「重复是无害的」：它是维护成本，不是正确性问题。
    const a = doc({ slug: 'a', body: '[[b]] [[b]] [[b]]', declaredRelations: ['b', 'b', 'b'] });
    const b = doc({ slug: 'b' });
    const graph = buildGraph([a, b]);
    expect([...graph.outbound.get('a')!]).toEqual(['b']);
    expect(graph.backlinks.get('b')?.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// urlFor / urlOf —— URL 规则（2026-09-24：路径前缀改为可注入）
// ─────────────────────────────────────────────────────────────────────

describe('urlFor / urlOf', () => {
  /*
   * 这组对着路线图阶段 4 第 6 项写：「剥离仅属于当前站点的展示逻辑」。
   *
   * 此前 `urlFor` 写死 `kind === 'wiki' ? '/wiki/' + slug + '/' : '/' + slug + '/'`，
   * 而 `/wiki/` 是**本站的目录选择**——第二个站点可能叫 `/notes/`。
   * 写死就等于让第二个站点改核心。
   */

  it('默认行为与 2026-09 之前逐字相同（加参数不该悄悄改产物）', () => {
    expect(urlFor('wiki', 'abc')).toBe('/wiki/abc/');
    expect(urlFor('post', 'abc')).toBe('/abc/');
    expect(urlOf(doc({ slug: 'abc', kind: 'wiki' }))).toBe('/wiki/abc/');
    expect(urlOf(doc({ slug: 'abc', kind: 'post' }))).toBe('/abc/');
  });

  it('第二个站点传自己的前缀即可，不必改核心', () => {
    expect(urlFor('wiki', 'abc', { wiki: '/notes' })).toBe('/notes/abc/');
    expect(urlFor('wiki', 'abc', { wiki: '' })).toBe('/abc/');
    expect(urlOf(doc({ slug: 'abc', kind: 'wiki' }), { wiki: '/kb' })).toBe('/kb/abc/');
  });

  it('前缀只影响知识库条目——文章路径不该跟着变', () => {
    // 若实现写成「一律套前缀」，文章会变成 /notes/abc/，第二站点的文章全错
    expect(urlFor('post', 'abc', { wiki: '/notes' })).toBe('/abc/');
  });

  it('前缀带不带结尾斜杠都给出正确结果', () => {
    // 传入 '/notes/' 若不规范化，拼接会得到 '/notes//abc/'：
    // 双斜杠在浏览器里通常还能跳转，但内容清单里的路径对不上、
    // 站内链接校验会失效，而且第二站点接入时才发现——**晚了**。
    //
    // > 这条测试**先写成钉住 bug 的版本**（`expect(...).toBe('/notes//abc/')`），
    // > 想了两秒才改过来：**把缺陷写成断言，等于让它从此合法**。
    // > 和「会误报的门禁」同族——一个把 bug 合法化的测试比没有测试更糟。
    expect(urlFor('wiki', 'abc', { wiki: '/notes/' })).toBe('/notes/abc/');
    expect(urlFor('wiki', 'abc', { wiki: '/notes///' })).toBe('/notes/abc/');
    expect(urlFor('wiki', 'abc', { wiki: '' })).toBe('/abc/');
  });
});
