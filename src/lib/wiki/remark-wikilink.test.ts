/**
 * `frontmatterField` 的用例。
 *
 * ── 为什么这个不起眼的函数值得单独测 ──────────────────────────────
 *
 * 它给 `[[wiki-link]]` 建查找表。它**解析错**的后果不是报错，而是
 * 链接静默指向另一个页面——构建通过、测试全绿、页面看起来正常。
 *
 * 而它是**手写的 YAML 子集解析器**（`remark-wikilink.ts` 里那个），
 * 与 Astro 内容层用的是两套东西。2026-09-23 与真实 YAML 逐例比对：
 * 12 个边界用例里 **6 个分歧**，现有内容恰好一条都不触发。
 *
 * 所以这里的用例分两组：
 *   1. **支持子集**——必须取到对的值；
 *   2. **越界写法**——必须**抛**，而不是猜一个值。
 *
 * 第二组是这次改动新增的行为。它把"静默解析错"变成"构建停下来"。
 * 要放宽任何一条，先改这里的用例，再改实现。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { buildLookup } from './remark-wikilink.js';
// frontmatter 的解析已抽成独立模块（脚本也要用它，重写一份就是三份实现）
import { frontmatterField, collectFrontmatterProblems } from './frontmatter.js';

const doc = (frontmatter: string) => `---\n${frontmatter}\n---\n正文\n`;

describe('frontmatterField：支持的子集', () => {
  it('取到普通单行值', () => {
    expect(frontmatterField(doc('title: 中文排版'), 'title')).toBe('中文排版');
  });

  it('冒号后面的空格可有可无', () => {
    expect(frontmatterField(doc('title:紧贴冒号'), 'title')).toBe('紧贴冒号');
    expect(frontmatterField(doc('title:    多个空格'), 'title')).toBe('多个空格');
  });

  it('整体加引号时去掉引号', () => {
    expect(frontmatterField(doc('title: "双引号"'), 'title')).toBe('双引号');
    expect(frontmatterField(doc("title: '单引号'"), 'title')).toBe('单引号');
  });

  it('引号里的冒号和井号是普通字符', () => {
    expect(frontmatterField(doc('title: "标题: 带冒号"'), 'title')).toBe('标题: 带冒号');
    expect(frontmatterField(doc('title: "带 # 号"'), 'title')).toBe('带 # 号');
  });

  it('只取顶层字段，不误取缩进的子项', () => {
    // tags 之类的子项常与顶层字段同名
    const src = doc('seo:\n  title: 子项里的标题\ntitle: 顶层标题');
    expect(frontmatterField(src, 'title')).toBe('顶层标题');
  });

  it('CRLF 行尾不影响取值', () => {
    expect(frontmatterField('---\r\ntitle: 中文排版\r\n---\r\n正文', 'title')).toBe('中文排版');
  });

  it('字段不存在时返回 null', () => {
    expect(frontmatterField(doc('title: 有标题'), 'slug')).toBeNull();
  });

  it('没有 frontmatter 块时返回 null', () => {
    expect(frontmatterField('就是一段正文', 'title')).toBeNull();
  });
});

describe('frontmatterField：越界写法必须抛，不能猜', () => {
  /**
   * 下面每一条都对应真实 YAML 与手写解析的**实测分歧**。
   * 抛错而不是猜——错的值会静默把链接指到别的页面。
   */

  it('行尾注释：真 YAML 会丢掉注释，这里会把它当成标题的一部分', () => {
    expect(() => frontmatterField(doc('title: 中文排版 # 注释'), 'title')).toThrow(/行尾注释/);
  });

  it('折叠块标量 `>`', () => {
    expect(() => frontmatterField(doc('title: >\n  折成\n  两行'), 'title')).toThrow(/块标量/);
  });

  it('竖线块标量 `|`', () => {
    expect(() => frontmatterField(doc('title: |\n  第一行\n  第二行'), 'title')).toThrow(/块标量/);
  });

  it('保留换行的块标量 `|-`', () => {
    expect(() => frontmatterField(doc('title: |-\n  内容'), 'title')).toThrow(/块标量/);
  });

  it('值写在下一行', () => {
    expect(() => frontmatterField(doc('title:\n  缩进的值'), 'title')).toThrow(/值不在同一行/);
  });

  it('双引号里的转义序列', () => {
    expect(() => frontmatterField(doc('title: "第一行\\n第二行"'), 'title')).toThrow(/转义序列/);
  });

  it("单引号里的 `''` 转义", () => {
    expect(() => frontmatterField(doc("title: '它''说'"), 'title')).toThrow(/''/);
  });
});

describe('frontmatterField：报错要可操作', () => {
  it('错误信息里带字段名与写法说明', () => {
    let message = '';
    try {
      frontmatterField(doc('title: >\n  折行'), 'title');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('title');
    expect(message).toContain('块标量');
    // 得告诉人怎么改，而不只是"出错了"
    expect(message).toMatch(/改法|写成一行/);
  });

  it('字段名不同，报错里的名字也跟着变', () => {
    expect(() => frontmatterField(doc('slug: |\n  x'), 'slug')).toThrow(/`slug`/);
  });
});

describe('collectFrontmatterProblems：给配置加载期用的全量扫描', () => {
  /**
   * 这一步存在的理由只有一个：**在 remark 管道里抛错，Astro 不会让构建失败**。
   * 实测（2026-09-23，清缓存后注入 `title: >`）：错误打印 22 次、
   * 页面退化（链接 4→3）、而 build exit code 是 **0**。
   *
   * 所以校验必须发生在**任何渲染之前**——`astro.config.mjs` 加载期。
   * 这些用例钉的就是"它能一次把问题都找出来"。
   */
  const dirs: string[] = [];

  const makeContent = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), 'lp-fm-'));
    dirs.push(root);
    for (const sub of ['posts', 'wiki']) mkdirSync(join(root, sub), { recursive: true });
    for (const [rel, body] of Object.entries(files)) {
      writeFileSync(join(root, rel), body, 'utf8');
    }
    return root;
  };

  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('全都合规时返回空数组', () => {
    const root = makeContent({
      'posts/a.md': '---\ntitle: 正常标题\n---\n正文',
      'wiki/b.md': '---\ntitle: 另一个\nslug: b\n---\n正文',
    });
    expect(collectFrontmatterProblems(root)).toEqual([]);
  });

  it('一次报出**多处**问题，而不是遇到第一个就停', () => {
    const root = makeContent({
      'posts/a.md': '---\ntitle: >\n  折行\n---\n正文',
      'wiki/b.md': '---\ntitle: 有问题 # 注释\n---\n正文',
    });
    const problems = collectFrontmatterProblems(root);
    expect(problems).toHaveLength(2);
    expect(problems.some((p) => p.includes('posts/a.md'))).toBe(true);
    expect(problems.some((p) => p.includes('wiki/b.md'))).toBe(true);
  });

  it('报错里带文件相对路径与字段名', () => {
    const root = makeContent({ 'wiki/x.md': '---\ntitle: |\n  竖线\n---\n正文' });
    const problems = collectFrontmatterProblems(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('wiki/x.md');
    expect(problems[0]).toContain('[title]');
  });

  it('目录不存在时返回空，而不是抛', () => {
    // 关掉知识层、或者内容目录还没建，都是合法状态
    expect(collectFrontmatterProblems(join(tmpdir(), 'lp-definitely-missing-xyz'))).toEqual([]);
  });
});

describe('两套查找表必须算出同一批 URL', () => {
  /**
   * 这个项目**故意**有两套解析：`graph.ts` 走 Astro 内容层（真 YAML），
   * `remark-wikilink.ts` 走 fs 扫描（手写子集解析）。理由是 remark 插件在
   * markdown 管线里拿不到内容集合。
   *
   * 重复本身可以接受，**漂开不可以**——两边一旦不一致，
   * HTML 里的链接与链接图/内容清单就会各指各的，而构建照样通过。
   *
   * URL 前缀原先就是手写的第二份（`collect('posts', '/')` /
   * `collect('wiki', '/wiki/')`）。这条用例钉住的就是"现在只有一份规则"。
   */
  const dirs: string[] = [];
  const root = () => {
    const r = mkdtempSync(join(tmpdir(), 'lp-consist-'));
    dirs.push(r);
    return r;
  };
  const write = (r: string, rel: string, body: string) => {
    const full = join(r, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body, 'utf8');
  };
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('文章与 wiki 条目的前缀对得上', () => {
    const r = root();
    write(r, 'posts/a.md', '---\ntitle: 文章甲\n---\n正文');
    write(r, 'wiki/b.md', '---\ntitle: 条目乙\n---\n正文');

    const lookup = buildLookup(r);
    // 与 `urlFor` 同一套规则；写死在这里，是为了让规则变化时这条会红
    expect(lookup.byName.get('文章甲')).toBe('/a/');
    expect(lookup.byName.get('条目乙')).toBe('/wiki/b/');
  });

  it('部署子路径会统一加在前面', () => {
    const r = root();
    write(r, 'posts/a.md', '---\ntitle: 甲\n---\n正文');
    write(r, 'wiki/b.md', '---\ntitle: 乙\n---\n正文');
    const lookup = buildLookup(r, '/letterpress/');
    expect(lookup.byName.get('甲')).toBe('/letterpress/a/');
    expect(lookup.byName.get('乙')).toBe('/letterpress/wiki/b/');
  });
});
