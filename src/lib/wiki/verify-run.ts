/**
 * 核对知识页里的**可证伪声明**（`verify:`）。
 *
 * ── 它和 lint 的分工 ────────────────────────────────────────────────
 *
 * `lint.ts` 管的是**页与页之间**：断链、重复 slug、孤儿页。
 * 这里管的是**页与仓库之间**：页面陈述了一个关于代码库的事实，
 * 代码库变了，页面没变。
 *
 * 后一类更阴，因为它**读起来像事实，所以没人会去核实**。
 *
 * ── 为什么读文件系统的是这个模块，而不是 `verify.ts` ────────────────
 *
 * 那边是纯函数（不碰 fs），可以被穷举测试。而「哪些文件算数」是调用方的
 * 决定——它知道仓库根在哪、要不要忽略 `.git` 与 `node_modules`。
 * 这个模块就是那个调用方。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { evaluateClaims, globToRegExp, parseClaims, type ClaimProblem } from './verify.js';

export interface PageClaims {
  readonly file: string;
  readonly problems: readonly ClaimProblem[];
}

/** 仓库里所有文件的相对路径（`/` 分隔），跳过 `.git` / `node_modules` / `dist`。 */
function allFiles(root: string, dir = '', out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) allFiles(root, rel, out);
    else out.push(rel);
  }
  return out;
}

/** 页面正文（去掉 frontmatter 块）。`stated` 的逐字核对只该查这一部分。 */
function bodyOf(source: string): string {
  const end = source.indexOf('\n---', 3);
  if (!source.startsWith('---') || end === -1) return source;
  const nl = source.indexOf('\n', end + 1);
  return nl === -1 ? '' : source.slice(nl + 1);
}

/**
 * 扫一个目录下的所有 `.md` / `.mdx`，核对它们的 `verify:` 声明。
 *
 * `contentRoot` 只用来定位**页面**；而 `path` 是相对**仓库根**的——
 * 声明会指向 `src/`、`scripts/`、`knowledge/` 等各处，
 * 所以两件事必须分开算，用同一个根会全部查错地方。
 */
export function checkVerifyClaims(contentRoot: string, repoRoot = process.cwd()): PageClaims[] {
  const known = allFiles(repoRoot);
  const exists = (glob: string): boolean => {
    const re = globToRegExp(glob);
    return known.some((f) => re.test(f));
  };

  const results: PageClaims[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 目录不存在是合法状态（比如关掉了知识层）
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.mdx?$/.test(entry.name)) {
        const source = readFileSync(full, 'utf8');
        const claims = parseClaims(source);
        if (claims.length === 0) continue;
        results.push({
          file: relative(repoRoot, full).split(sep).join('/'),
          // 逐字核对**必须只查正文**：喂整个文件的话，`stated` 会命中
          // frontmatter 里它自己那一行——**声明在验证自己的字符串**，
          // 于是无论正文怎么改它都是绿的。负向验证抓到的。
          problems: evaluateClaims(claims, bodyOf(source), exists),
        });
      }
    }
  };
  walk(contentRoot);

  return results;
}

/** 把一组核对结果渲染成构建时能直接打印的字符串数组。 */
export function formatVerifyProblems(results: readonly PageClaims[]): string[] {
  const lines: string[] = [];
  for (const page of results) {
    for (const p of page.problems) {
      lines.push(`${page.file}\n    [${p.claim}] ${p.message}`);
    }
  }
  return lines;
}
