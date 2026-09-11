import { describe, expect, it } from 'vitest';
import { extractToc, shouldShowToc, stripInlineMarkdown } from './toc.js';

/**
 * 下面这组「markdown 标题 → id」的对应关系**全部取自真实构建产物**
 * （`dist/how-this-works/index.html` 里的 `<h2 id="...">`），不是编的。
 *
 * 这是本文件里最重要的一组测试。锚点 id 与渲染器不一致的后果是
 * **目录点下去页面不动**——而构建、测试、lint 全都不会报错。
 * 用真实产物做固件，才能在 Astro 升级换了 slug 算法时第一时间发现。
 */
const REAL_IDS: ReadonlyArray<readonly [string, string]> = [
  ['## 你只需要改一个文件', '你只需要改一个文件'],
  ['## 东西都在哪', '东西都在哪'],
  ['## 两种内容，两种组织方式', '两种内容两种组织方式'],
  ['## 用 `[[方括号]]` 连起来', '用-方括号-连起来'],
  ['## 构建时会做体检', '构建时会做体检'],
  ['## 给 AI 读者那一份', '给-ai-读者那一份'],
  ['## 部署', '部署'],
  ['## 详细说明', '详细说明'],
];

describe('extractToc — 与真实构建产物的 id 对齐', () => {
  it.each(REAL_IDS)('%s → #%s', (markdown, expectedId) => {
    const [entry] = extractToc(markdown);
    expect(entry?.id).toBe(expectedId);
  });

  it('连续抽取时 id 与逐条抽取一致', () => {
    // slugger 是状态化的，批量处理不能改变单条的结果
    const markdown = REAL_IDS.map(([md]) => md).join('\n\n');
    const ids = extractToc(markdown).map((e) => e.id);
    expect(ids).toEqual(REAL_IDS.map(([, id]) => id));
  });
});

describe('extractToc', () => {
  it('只取 h2 与 h3', () => {
    const toc = extractToc('# 一级\n\n## 二级\n\n### 三级\n\n#### 四级\n');
    expect(toc.map((e) => e.depth)).toEqual([2, 3]);
  });

  it('保留层级信息', () => {
    const toc = extractToc('## 甲\n\n### 甲一\n\n## 乙\n');
    expect(toc).toEqual([
      { depth: 2, text: '甲', id: '甲' },
      { depth: 3, text: '甲一', id: '甲一' },
      { depth: 2, text: '乙', id: '乙' },
    ]);
  });

  /** 讲解语法的文章必然在代码块里写 `## 假标题`，不能把它当成真标题。 */
  it('跳过围栏代码块里的井号', () => {
    const md = ['## 真标题', '', '```markdown', '## 假标题', '```', '', '## 另一个真标题'].join('\n');
    expect(extractToc(md).map((e) => e.text)).toEqual(['真标题', '另一个真标题']);
  });

  it('波浪号围栏同样跳过', () => {
    expect(extractToc('~~~\n## 假的\n~~~\n\n## 真的').map((e) => e.text)).toEqual(['真的']);
  });

  /**
   * **重复标题的编号必须连续**。
   *
   * github-slugger 给第二个同名标题加 `-1`。如果实现里「跳过某些标题时不调用
   * slug()」，编号就会错位——第三个同名标题会变成 `-1` 而不是 `-2`，
   * 与渲染出的 id 对不上。
   */
  it('重复标题得到递增后缀', () => {
    const toc = extractToc('## 同名\n\n## 同名\n\n## 同名');
    expect(toc.map((e) => e.id)).toEqual(['同名', '同名-1', '同名-2']);
  });

  it('末尾的井号被忽略', () => {
    expect(extractToc('## 标题 ##')[0]?.text).toBe('标题');
  });

  it('标题里的行内标记被剥离', () => {
    expect(extractToc('## **加粗**与`代码`')[0]?.text).toBe('加粗与代码');
  });

  it('空标题被跳过', () => {
    expect(extractToc('##\n\n##   \n\n## 有内容')).toHaveLength(1);
  });

  it('空文档返回空数组', () => {
    expect(extractToc('')).toEqual([]);
    expect(extractToc('没有标题的一段话。')).toEqual([]);
  });

  it('# 号后面没有空格不是标题（CommonMark 规定）', () => {
    expect(extractToc('##没有空格')).toEqual([]);
  });
});

describe('stripInlineMarkdown', () => {
  it('去掉强调符号', () => {
    expect(stripInlineMarkdown('**粗**与*斜*')).toBe('粗与斜');
  });

  it('链接保留文字', () => {
    expect(stripInlineMarkdown('见 [那篇](https://example.com)')).toBe('见 那篇');
  });

  it('图片保留 alt', () => {
    expect(stripInlineMarkdown('![示意图](/a.png)')).toBe('示意图');
  });

  it('行内代码保留内容去掉反引号', () => {
    expect(stripInlineMarkdown('用 `code` 说明')).toBe('用 code 说明');
  });

  it('去掉 HTML 标签', () => {
    expect(stripInlineMarkdown('<kbd>Ctrl</kbd>+C')).toBe('Ctrl+C');
  });

  it('纯文本原样返回', () => {
    expect(stripInlineMarkdown('普通标题')).toBe('普通标题');
  });
});

describe('shouldShowToc', () => {
  it('二级标题少于三个时不显示', () => {
    // 两三个小节的短文加目录只是噪声
    expect(shouldShowToc(extractToc('## 甲\n\n## 乙'))).toBe(false);
  });

  it('三个二级标题时显示', () => {
    expect(shouldShowToc(extractToc('## 甲\n\n## 乙\n\n## 丙'))).toBe(true);
  });

  it('只有三级标题时不显示', () => {
    expect(shouldShowToc(extractToc('### 甲\n\n### 乙\n\n### 丙\n\n### 丁'))).toBe(false);
  });

  it('空目录不显示', () => {
    expect(shouldShowToc([])).toBe(false);
  });
});
