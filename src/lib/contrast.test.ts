import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 对比度测试。
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────
 *
 * README 里写着「全部文字对比度实测 ≥4.5:1」，而**在写下这句话的时候，
 * 站点上有一个元素是 1.42:1**——`.meta__sep`（元信息里那个 `·`），
 * 每页出现三到七处。
 *
 * 它逃过检查的原因很典型：**没有任何自动化的对比度检查**。
 * 手测的时候只看正文和标题，而 `·` 长得像个装饰点，不会有人去量它。
 *
 * 这个文件直接解析 `tokens.css`——测的是**真实的来源**，
 * 而不是在这里抄一份色值（抄一份就会漂移，而漂移的色值测了等于没测）。
 *
 * ── 两类要求，别混 ──────────────────────────────────────────────────
 *
 *   WCAG 1.4.3（文字）        ≥ 4.5:1   正文、标签、分隔点等一切**字符**
 *   WCAG 1.4.11（非文本对比度）≥ 3.0:1   可交互元素的边界、图标、焦点环
 *
 * 搞混这两类是常见错误：把边框色拿去当文字色，在 1.4.3 下就不达标了——
 * 而那正是本项目踩过的坑。
 */

const TOKENS = readFileSync(
  join(process.cwd(), 'src', 'styles', 'tokens.css'),
  'utf8',
);

/** 从 CSS 里取一个自定义属性的值。只处理直接的十六进制色值。 */
function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(TOKENS);
  if (!m) throw new Error(`tokens.css 里找不到 --${name}（或它不是一个直接色值）`);
  return m[1]!.toLowerCase();
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 解析一个自定义属性，**跟着 `var(--x)` 别名走到底**。
 *
 * <p>`token()` 只认直接的十六进制值，而语义色几乎都是别名
 * （`--color-text-subtle: var(--zinc-500)`、`--color-surface-sunken: var(--zinc-100)`）。
 * 要按"元素自己声明的那个颜色"去算对比度，就得把这层别名解开——
 * 否则只能测试手抄进来的 zinc-500/zinc-100，而那正是"抄一份就会漂移"。
 *
 * <p>同名 token 有多处定义时（亮色块 + 暗色媒体查询 + 强制暗色选择器），
 * 取**第一处**即亮色那份，与 `token()` 的行为一致。
 */
function resolveColor(name: string, depth = 0): string {
  if (depth > 4) throw new Error(`--${name} 的别名链太深或成环`);
  const m = new RegExp(`--${name}:\\s*([^;]+)`).exec(TOKENS);
  if (!m) throw new Error(`tokens.css 里找不到 --${name}`);
  const value = m[1]!.trim();
  const alias = /^var\(--([a-z0-9-]+)\)$/i.exec(value);
  if (alias) return resolveColor(alias[1]!, depth + 1);
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`--${name} 不是色值（解析到 ${value}）——别名链要在 hex 上收住`);
  }
  return value.toLowerCase();
}

/** 断言一对颜色达到要求。失败信息里带上实测值，省得再算一遍。 */
function expectContrast(fg: string, bg: string, min: number, label: string): void {
  const ratio = contrast(fg, bg);
  expect(
    ratio,
    `${label}：${fg} 对 ${bg} 实测 ${ratio.toFixed(2)}:1，要求 ≥${min}:1`,
  ).toBeGreaterThanOrEqual(min);
}

describe('亮色模式的配色对比度', () => {
  /**
   * 文字：WCAG 1.4.3 要求 4.5:1。
   *
   * `--color-text-subtle` 是**下限所在**——它用在日期、标签、目录摘要
   * 这类小号文字上，一不达标就是满屏的问题。
   */
  it('所有文字色对画布达到 4.5:1', () => {
    const canvas = token('zinc-50');
    expectContrast(token('zinc-900'), canvas, 4.5, '正文');
    expectContrast(token('zinc-700'), canvas, 4.5, '次要文字');
    expectContrast(token('zinc-500'), canvas, 4.5, '弱化文字（日期/标签/分隔点）');
    expectContrast(token('klein-blue'), canvas, 4.5, '链接');
    expectContrast(token('red-600'), canvas, 4.5, '错误');
    expectContrast(token('green-700'), canvas, 4.5, '成功');
  });

  it('文字在抬升表面上也达标（代码块、行内代码用 zinc-100）', () => {
    const sunken = token('zinc-100');
    expectContrast(token('zinc-900'), sunken, 4.5, '正文在锌-100 上');
    expectContrast(token('klein-blue'), sunken, 4.5, '链接在锌-100 上');
  });

  /**
   * ── 弱化文字**只能**用在画布上 ────────────────────────────────────
   *
   * zinc-500 对画布（zinc-50）是 4.63:1，达标；
   * 但对抬升表面（zinc-100）只有 **4.40:1**，不达标。
   *
   * 这个差别很小、很容易踩：行内 `<code>` 有 zinc-100 背景，如果它继承
   * 了所在段落的弱化色，就会出现「同一段标记在某些上下文里达标、
   * 在另一些里不达标」——而且**只在特定组合下才暴露**。
   *
   * 这就是 `code { color: var(--color-text) }` 写死不继承的原因。
   * 下面两条把两个事实都记下来：差异真实存在，且当前设计避开了它。
   */
  it('zinc-500 在画布上达标', () => {
    expectContrast(token('zinc-500'), token('zinc-50'), 4.5, '弱化文字在画布上');
  });

  it('zinc-500 在抬升表面上**不**达标——所以不能拿它当那里的文字色', () => {
    const ratio = contrast(token('zinc-500'), token('zinc-100'));
    expect(ratio, `zinc-500 对 zinc-100 实测 ${ratio.toFixed(2)}:1`).toBeLessThan(4.5);
  });

  /**
   * 可交互边界：WCAG 1.4.11 要求 3:1。
   *
   * 注意这里用的是 `--zinc-450` 而不是 `--zinc-300`：后者是**装饰性**
   * 分隔线的颜色（1.42:1），拿它当按钮或输入框的边框是不达标的。
   */
  it('可交互元素的边界达到 3:1', () => {
    const canvas = token('zinc-50');
    expectContrast(token('zinc-450'), canvas, 3, '可交互边框');
    expectContrast(token('klein-blue'), canvas, 3, '焦点环');
  });

  /**
   * 装饰性分隔线**不受** 1.4.11 约束——它不是识别任何组件所必需的信息。
   * 这条测试是刻意存在的：写下来，免得以后有人「顺手」把它调深而破坏版式层次。
   */
  it('装饰性分隔线保持浅色（不要求达标，但记录在案）', () => {
    const ratio = contrast(token('zinc-200'), token('zinc-50'));
    expect(ratio).toBeLessThan(3);
  });
});

describe('悬停态的改色覆盖', () => {
  const SITE_CSS = readFileSync(join(process.cwd(), 'src', 'styles', 'site.css'), 'utf8');
  const POST_LIST = readFileSync(
    join(process.cwd(), 'src', 'components', 'PostList.astro'),
    'utf8',
  );

  const looksLikeClass = (c: string) => /^[a-z][a-z0-9_-]*$/i.test(c);

  /** 模板里会出现的类名（`class="a b"` 与 `class:list={['a', 'b']}` 两种写法都抓） */
  function templateClasses(): Set<string> {
    const found = new Set<string>();
    for (const m of POST_LIST.matchAll(/class="([^"]*)"/g)) {
      for (const c of (m[1] ?? '').split(/\s+/)) if (looksLikeClass(c)) found.add(c);
    }
    for (const m of POST_LIST.matchAll(/class:list=\{\[([^\]]*)\]\}/g)) {
      for (const c of (m[1] ?? '').split(/['",\s]+/)) if (looksLikeClass(c)) found.add(c);
    }
    return found;
  }

  /** site.css 里**自带** color 声明的类 → 它用的颜色 token（`inherit` 之类返回 null） */
  function selfColoredClasses(): Map<string, string | null> {
    const found = new Map<string, string | null>();
    for (const m of SITE_CSS.matchAll(/\.([a-z0-9_-]+)\s*\{([^}]*)\}/gi)) {
      const decl = /(?:^|[;\s])color\s*:\s*([^;]+)/.exec(m[2] ?? '');
      if (!decl) continue;
      const value = decl[1]!.trim();
      // `inherit` / `currentColor` 是**跟着父级走**的，不是自带颜色——悬停改父级就够
      const fromToken = /^var\(--([a-z0-9-]+)\)$/i.exec(value);
      found.set(m[1]!, fromToken ? fromToken[1]! : null);
    }
    return found;
  }

  /** `.post-list__row:hover <某类>` 的改色规则覆盖到了哪些类 */
  function hoverCoveredClasses(): Set<string> {
    const found = new Set<string>();
    for (const m of SITE_CSS.matchAll(/\.post-list__row:hover\s+([^{]+)\{([^}]*)\}/g)) {
      if (!/(^|[;\s])color\s*:/.test(m[2] ?? '')) continue;
      for (const sel of (m[1] ?? '').split(',')) {
        const name = sel.trim().replace(/^\.post-list__row:hover\s+/, '').replace(/^\./, '');
        if (looksLikeClass(name)) found.add(name);
      }
    }
    return found;
  }

  /**
   * **悬停时行内每一个会显示的字符，都得在悬停底色上读得清。**
   *
   * <p>这条是补的，补的是一次真实的 4.40:1。`site.css` 里那段注释已经承认
   * 「锌-500 落在锌-100 上只有 4.39:1，**记了却没检查这个组合**」，并因此加了
   * `.post-list__row:hover` 的改色规则——**但那条规则漏了 `.meta__sep`**。
   *
   * <p>原因正是 CSS 里最常见的那种"我以为它继承了"：分隔点自带
   * `color: var(--color-text-subtle)`（锌-500），而它是**自己的声明**，
   * 父级 `.meta` 在悬停时改色对它无效（声明赢过继承）。于是悬停时它仍然是
   * 锌-500 落在锌-100 上，也就是上面那个"记在案却没检查"的组合本身。
   *
   * <p>手测不可能发现它：要悬停、要恰好那一行有标签、还要去量一个 `·` 的对比度。
   *
   * <p>判据是**逐元素二选一**，而不是"必须都在改色列表里"：
   * 要么被 `.post-list__row:hover` 改到（那改后的颜色另行断言），
   * 要么它自带的那个颜色本身就在悬停底色上达标。
   * `color: inherit` / `currentColor` 不算自带颜色——它跟着父级走，父级已覆盖。
   */
  it('悬停时行内每个自带颜色的字符都达标', () => {
    const covered = hoverCoveredClasses();
    const offenders: string[] = [];

    for (const [name, colorToken] of selfColoredClasses()) {
      if (!templateClasses().has(name)) continue; // 不在这个行内出现
      if (colorToken === null) continue; // inherit / currentColor：跟着父级
      if (covered.has(name)) continue; // 已被悬停规则改色，改后的颜色另有一条断言

      const hex = resolveColor(colorToken);
      const ratio = contrast(hex, resolveColor('color-surface-sunken'));
      if (ratio < 4.5) {
        offenders.push(`.${name}（--${colorToken} → ${hex} 在悬停底色上只有 ${ratio.toFixed(2)}:1）`);
      }
    }

    expect(
      offenders,
      `悬停时底色变成 zinc-100。这些元素自带颜色、又没被 .post-list__row:hover 覆盖，`
        + `而在那个底色上不达标：${offenders.join('；')}`,
    ).toEqual([]);
  });

  /** 被悬停规则改色之后，用的那个颜色必须达标 */
  it('悬停态的文字色在悬停底色上达标', () => {
    expectContrast(token('zinc-700'), token('zinc-100'), 4.5, '悬停态文字');
  });
});

describe('暗色模式的配色对比度', () => {
  it('所有文字色对深色画布达到 4.5:1', () => {
    const canvas = token('zinc-950');
    expectContrast(token('zinc-100'), canvas, 4.5, '正文');
    expectContrast(token('zinc-300'), canvas, 4.5, '次要文字');
    // 暗色下用的是提亮过的 zinc-450，不是 zinc-500——后者只有 4.12:1
    expectContrast(token('zinc-450'), canvas, 4.5, '弱化文字');
    expectContrast(token('klein-blue-lifted'), canvas, 4.5, '链接');
    expectContrast(token('red-400'), canvas, 4.5, '错误');
    expectContrast(token('green-400'), canvas, 4.5, '成功');
  });

  it('可交互元素的边界达到 3:1', () => {
    const canvas = token('zinc-950');
    expectContrast(token('zinc-550'), canvas, 3, '可交互边框');
    expectContrast(token('klein-blue-lifted'), canvas, 3, '焦点环');
  });

  /**
   * 反例：如果把 zinc-500 直接用在暗色背景上会怎样。
   *
   * 这条测试把「为什么暗色需要单独的弱化文字色」钉住——
   * 免得以后有人图省事把两档合并成一个。
   */
  it('zinc-500 在深色底上不达标——所以暗色必须单独指定', () => {
    const ratio = contrast(token('zinc-500'), token('zinc-950'));
    expect(ratio, `zinc-500 对 zinc-950 实测 ${ratio.toFixed(2)}:1`).toBeLessThan(4.5);
  });
});

describe('强调色的克制', () => {
  /**
   * 克莱因蓝在深色底上对比度只有约 2:1，读不了——所以暗色模式必须换一个提亮版。
   * 这条记录的是「为什么不能直接复用同一个强调色」。
   */
  it('克莱因蓝直接用在深色底上不达标——所以有 --klein-blue-lifted', () => {
    const ratio = contrast(token('klein-blue'), token('zinc-950'));
    expect(ratio, `klein-blue 对 zinc-950 实测 ${ratio.toFixed(2)}:1`).toBeLessThan(3);
  });
});
