/**
 * 可证伪声明（`verify:`）的单元测试。
 *
 * ── `globToRegExp` 为什么占了这么多条 ────────────────────────────────
 *
 * 它是这个机制里**唯一一处自己写的解析**，而它被写坏了三次，
 * 三次的症状都是「正则看着挺对、而且测试是绿的」：
 *
 *   ① `**` 换成自带尾斜杠的 `(?:[^/]+/)* + /`，又叠加循环补的斜杠
 *      → 要求**至少一层**子目录，`src/config.ts` 匹配不上；
 *   ② 改成「上一段是 `**` 就不补斜杠」
 *      → `src` 与 `**` 之间那个斜杠丢了，**全都匹配不上**；
 *   ③ 分隔符补在 `**` 分支之后
 *      → `src/**` 那类正常了，`src/** / *.ts` 又全不中。
 *
 * 三次都是**我盯着 `.source` 数斜杠**，而 `new RegExp` 的 `.source`
 * 会对 `/` 补反斜杠——数出来的是 `\/`，肉眼极容易多数或少数一个。
 * 所以下面的断言**一律用 `test()`**，不碰 `.source`。
 *
 * 最后一组拿**真实文件树**交叉验证：手写的期望值可以跟实现一起错，
 * 而仓库里真实存在的文件不会。
 */
import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { evaluateClaims, globToRegExp, parseClaims } from './verify.js';

describe('声明解析', () => {
  const page = (block: string, body = '正文') => `---\n${block}\n---\n${body}`;

  it('读出块数组里的每条声明', () => {
    const claims = parseClaims(
      page(
        [
          'title: 甲',
          'verify:',
          '  - claim: 来源登记',
          '    stated: 计划中，尚未实现',
          '    path: knowledge/sources/*.json',
          '    expect: absent',
        ].join('\n'),
      ),
    );
    expect(claims).toEqual([
      {
        claim: '来源登记',
        stated: '计划中，尚未实现',
        path: 'knowledge/sources/*.json',
        expect: 'absent',
      },
    ]);
  });

  it('没有 verify: 就返回空数组，而不是抛错', () => {
    expect(parseClaims(page('title: 甲'))).toEqual([]);
    expect(parseClaims('没有 frontmatter')).toEqual([]);
  });

  it('expect 默认 exists', () => {
    const claims = parseClaims(page(['verify:', '  - claim: 甲', '    path: a/*.ts'].join('\n')));
    expect(claims[0].expect).toBe('exists');
  });

  it('**expect 写错要抛，不能悄悄放行**', () => {
    // 含糊的值会让这条声明悄悄失效——那比没有声明更糟
    expect(() =>
      parseClaims(page(['verify:', '  - claim: 甲', '    path: a', '    expect: maybe'].join('\n'))),
    ).toThrow(/expect/);
  });

  it('缩进回到顶层就结束，不会吃掉后面的字段', () => {
    const claims = parseClaims(
      page(['verify:', '  - claim: 甲', '    path: a', 'title: 乙'].join('\n')),
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].path).toBe('a');
  });

  it('多条声明各自独立', () => {
    const claims = parseClaims(
      page(
        [
          'verify:',
          '  - claim: 甲',
          '    path: a',
          '  - claim: 乙',
          '    path: b',
          '    expect: absent',
        ].join('\n'),
      ),
    );
    expect(claims.map((c) => c.claim)).toEqual(['甲', '乙']);
    expect(claims[1].expect).toBe('absent');
  });
});

describe('通配路径', () => {
  /** 断言一律用 `test()`——理由见文件开头。 */
  const cases: [string, string, boolean][] = [
    // 单星：段内
    ['knowledge/sources/*.json', 'knowledge/sources/a.json', true],
    ['knowledge/sources/*.json', 'knowledge/sources/a.md', false],
    ['knowledge/sources/*.json', 'knowledge/sources/sub/a.json', false],
    ['src/content/wiki/*.md', 'src/content/wiki/a.md', true],
    ['src/content/wiki/*.md', 'src/content/wiki/sub/a.md', false],
    // 双星：跨段，**且零层目录也要匹配**
    ['src/**/*.ts', 'src/config.ts', true],
    ['src/**/*.ts', 'src/lib/wiki/verify.ts', true],
    ['src/**/*.ts', 'src/a/b/c.ts', true],
    ['src/**/*.ts', 'src/lib/wiki/verify.tsx', false],
    ['src/**/*.ts', 'other/config.ts', false],
    // 末段的双星吃掉后面所有东西
    ['src/**', 'src/config.ts', true],
    ['src/**', 'src/a/b/c.ts', true],
    // 开头的双星
    ['**/*.ts', 'src/a/b.ts', true],
    ['**/*.ts', 'a.ts', true],
    // 不含通配符时是精确匹配
    ['scripts/wiki-impact.mjs', 'scripts/wiki-impact.mjs', true],
    ['scripts/wiki-impact.mjs', 'scripts/wiki-impact.mjs.bak', false],
  ];

  for (const [glob, path, want] of cases) {
    it(`${glob} ${want ? '⊃' : '⊅'} ${path}`, () => {
      expect(globToRegExp(glob).test(path)).toBe(want);
    });
  }

  it('正则元字符被当字面量，不当通配符', () => {
    // `knowledge/sources/a.json` 里的 `.` 不能匹配任意字符
    expect(globToRegExp('a.json').test('axjson')).toBe(false);
    expect(globToRegExp('a+b').test('a+b')).toBe(true);
    expect(globToRegExp('a+b').test('aab')).toBe(false);
  });

  it('**与真实文件树交叉验证**', () => {
    // 手写的期望值可以跟实现一起错；仓库里真实存在的文件不会。
    const root = process.cwd();
    const all: string[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'dist') continue;
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) walk(join(dir, e.name), rel);
        else all.push(rel);
      }
    };
    walk(root, '');

    const expectAtLeast: [string, number][] = [
      ['knowledge/sources/*.json', 5],
      ['src/content/wiki/*.md', 6],
      ['src/**/*.ts', 20],
    ];
    for (const [glob, min] of expectAtLeast) {
      const hit = all.filter((f) => globToRegExp(glob).test(f));
      expect(hit.length, `${glob} 只命中 ${hit.length} 个文件`).toBeGreaterThanOrEqual(min);
    }

    // 反向：不该命中的一个都不能多
    const json = all.filter((f) => globToRegExp('knowledge/sources/*.json').test(f));
    expect(json.every((f) => f.endsWith('.json'))).toBe(true);
  });

  it('分隔符归一：Windows 的反斜杠先换成 / 再匹配', () => {
    // 调用方负责归一，这里钉住「归一之后一定匹配得上」这个前提
    const win = ['src', 'lib', 'wiki', 'verify.ts'].join(sep);
    expect(globToRegExp('src/**/*.ts').test(win.split(sep).join('/'))).toBe(true);
  });
});

describe('声明核对', () => {
  const page = '---\n---\n这张表里写着「计划中，尚未实现」。\n';

  it('文件本该不在、却在了 → 报错，并复述页面上的说法', () => {
    const problems = evaluateClaims(
      [{ claim: '来源登记', stated: '计划中，尚未实现', path: 'knowledge/sources/*.json', expect: 'absent' }],
      page,
      () => true,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('计划中，尚未实现');
    expect(problems[0].message).toContain('功能已经落地');
  });

  it('文件本该在、却不在 → 报错', () => {
    const problems = evaluateClaims(
      [{ claim: '甲', path: 'scripts/wiki-impact.mjs', expect: 'exists' }],
      page,
      () => false,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('它不在');
  });

  it('**正文改了、声明没改 → 报错**（这一条堵的是声明与正文漂移）', () => {
    // 只查文件的话，声明还写着「计划中」，而那句话早从页面上删了——
    // 检查照样绿，但它绿得毫无意义（它在验一句没人说过的话）。
    const problems = evaluateClaims(
      [{ claim: '甲', stated: '计划中，尚未实现', path: 'whatever', expect: 'exists' }],
      '页面上已经没有那句话了。\n',
      () => true,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('已经不在页面上了');
  });

  it('没写 stated 时只查文件，不报措辞问题', () => {
    expect(
      evaluateClaims([{ claim: '甲', path: 'a', expect: 'exists' }], '', () => true),
    ).toEqual([]);
  });

  it('没有 path 的声明要报出来——它查不了任何东西', () => {
    const problems = evaluateClaims([{ claim: '甲', path: '', expect: 'exists' }], page, () => true);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('查不了任何东西');
  });

  it('一切正常时零问题', () => {
    expect(
      evaluateClaims(
        [{ claim: '甲', stated: '计划中，尚未实现', path: 'a/*.json', expect: 'absent' }],
        page,
        () => false,
      ),
    ).toEqual([]);
  });
});
