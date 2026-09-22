/**
 * 设计令牌契约：**组件里引用的每一个 `var(--x)` 都必须真的存在**。
 *
 * ── 为什么值得单独一条检查 ──────────────────────────────────────────
 *
 * CSS 自定义属性的失败方式是**静默的**：写了一个不存在的
 * `var(--color-border-subtle)`，浏览器不会报错、不会有警告，
 * 那条声明被整条丢弃——于是分隔线没了、颜色回落到继承值，
 * 页面只是"看起来有点不对"。
 *
 * 2026-09-23 实测踩到：新组件里写了 `var(--color-border-subtle)`，
 * 而令牌表里只有 `--color-border` / `--color-border-strong` /
 * `--color-border-interactive`。`astro check` 0 错误、196 项契约全过、
 * 构建成功——**没有任何东西会发现这件事**。
 *
 * ── 口径 ────────────────────────────────────────────────────────────
 *
 * 只认 tokens.css 里 `--x:` 形式**定义过的**名字。`var(--x, fallback)`
 * 这种带兜底值的也要求 `--x` 存在：兜底值是"更好看的失败"，
 * 不是"可以不定义"。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TOKENS = join(ROOT, 'src', 'styles', 'tokens.css');

/** 令牌表里定义过的全部名字。 */
function definedTokens(): Set<string> {
  const css = readFileSync(TOKENS, 'utf8');
  const names = new Set<string>();
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) names.add(m[1]);
  return names;
}

/** 递归收集需要检查的样式来源。 */
function styleSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      styleSources(full, out);
    } else if (/\.(?:astro|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * **不由令牌表提供**的变量，显式列出。
 *
 * 只有一类：Shiki 在构建期把双主题的颜色直接注入到 `<pre>` / `<span>` 上
 * （`--shiki-dark` 等）。它们不在 `tokens.css` 里，也不该在——
 * 那是高亮器按代码内容生成的。
 *
 * 列成白名单而不是"正则里排除 shiki"，是为了让**新增的豁免必须写下来**：
 * 一个静默放宽的检查，和没有检查是一回事。
 */
const INJECTED_BY_BUILD = new Set([
  '--shiki-dark',
  '--shiki-dark-bg',
  '--shiki-dark-font-style',
  '--shiki-dark-font-weight',
  '--shiki-dark-text-decoration',
]);

/** 文件里引用的所有 `var(--x)` 名字。 */
function usedTokens(source: string): Set<string> {
  const used = new Set<string>();
  for (const m of source.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) used.add(m[1]);
  return used;
}

describe('设计令牌契约', () => {
  const defined = definedTokens();
  const files = styleSources(join(ROOT, 'src'));

  it('令牌表本身不为空，且收集到了组件', () => {
    // 「被测集合是空的」是这个仓库反复踩的坑，先证明尺子量到了东西
    expect(defined.size).toBeGreaterThan(20);
    expect(files.length).toBeGreaterThan(5);
  });

  it('每个 var(--x) 都指向已定义的令牌', () => {
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const name of usedTokens(source)) {
        if (INJECTED_BY_BUILD.has(name)) continue;
        if (!defined.has(name)) {
          missing.push(`${file.slice(ROOT.length + 1).replace(/\\/g, '/')} → ${name}`);
        }
      }
    }
    expect(missing, `引用了不存在的令牌（浏览器会静默忽略整条声明）：\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('**检查本身会失败**：造一个假令牌，它必须被抓到', () => {
    // 负向验证。一条只会在真出问题时才跑到的检查，等于没验过。
    const fake = 'color: var(--color-definitely-not-defined-xyz);';
    const used = usedTokens(fake);
    expect([...used]).toEqual(['--color-definitely-not-defined-xyz']);
    expect(defined.has('--color-definitely-not-defined-xyz')).toBe(false);
  });
});
