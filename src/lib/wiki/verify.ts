/**
 * 页面里的**可证伪声明**：把「这一页说的某件事」变成 CI 能查的东西。
 *
 * ── 它解决的是什么 ──────────────────────────────────────────────────
 *
 * `llm-wiki.md` 里有一张「已实现 / 计划实现」表。2026-09-23 实测：
 * **表里三行写着「计划中，尚未实现」，而它们全都已经落地**
 * （`knowledge/sources/*.json`、`Doc.sources` / `Doc.review`、
 * `scripts/wiki-impact.mjs`）。
 *
 * 没有任何东西会发现这件事。lint 只管断链、重复 slug、孤儿页——
 * 那些都是**页与页之间**的问题。而这一条是**页与仓库之间**的问题：
 * 页面陈述了一个关于代码库的事实，代码库变了，页面没变。
 *
 * 这是最阴的一类陈旧：**它读起来像事实，所以没人会去核实。**
 *
 * ── 声明长什么样 ────────────────────────────────────────────────────
 *
 * ```yaml
 * verify:
 *   - claim: 来源登记与版本固定
 *     stated: 计划中，尚未实现
 *     path: knowledge/sources/*.json
 *     expect: absent
 * ```
 *
 * - `claim`——这条声明叫什么，出问题时用来指名道姓。
 * - `stated`——**页面正文里那句原话**，必须逐字出现（见下）。
 * - `path`——仓库里的路径，支持 `*` 与 `**`。
 * - `expect`——`exists` 或 `absent`。
 *
 * ── 两个都查，缺一不可 ──────────────────────────────────────────────
 *
 * 只查 `path` 有一个漏洞：**正文改了、声明没改**。那时声明还在说
 * 「计划中，尚未实现」，而这句话已经从页面上删掉了——检查照样绿，
 * 但它绿得毫无意义（它在验一句没人说过的话）。
 *
 * 所以 `stated` 必须**逐字出现在页面里**。这一条把漂移堵死了：
 * 谁改了正文里那句话，谁就得同时改声明，而改声明时就会看到
 * `path` 与 `expect`——**那时他才知道这件事是可以被核实的**。
 *
 * ── 它**不**声称什么 ────────────────────────────────────────────────
 *
 * 它只查**文件在不在**。查不了「这个功能写对了吗」——
 * 那是单元测试与构建探针的事。一条声明能覆盖的范围，
 * 恰好就是「有没有」这个层级，写清楚比写宽重要。
 */

export interface Claim {
  /** 这条声明叫什么。出问题时用来指名道姓。 */
  readonly claim: string;
  /** 页面正文里那句原话。省略表示只查文件、不查措辞。 */
  readonly stated?: string;
  /** 仓库相对路径，支持 `*`（段内）与 `**`（跨段）。 */
  readonly path: string;
  readonly expect: 'exists' | 'absent';
}

export interface ClaimProblem {
  readonly claim: string;
  readonly path: string;
  readonly message: string;
}

/**
 * 从 frontmatter 块里取出 `verify:` 声明。
 *
 * 沿用本仓库手写 frontmatter 子集的形状（块数组 + `- key: value`），
 * **刻意不实现完整 YAML**——理由与 `frontmatter.ts` 里那套一样：
 * 支持的子集写死，越界就抛，而不是悄悄解析成别的东西。
 *
 * 传的是**整个文件内容**（含 frontmatter），因为 `stated` 的逐字核对
 * 要扫正文；只传 frontmatter 块会让这一条永远查不到东西。
 */
export function parseClaims(source: string): Claim[] {
  const end = source.indexOf('\n---', 3);
  if (!source.startsWith('---') || end === -1) return [];
  const block = source.slice(3, end);

  const lines = block.split('\n');
  const start = lines.findIndex((l) => /^verify:\s*$/.test(l));
  if (start === -1) return [];

  const claims: Claim[] = [];
  // 用**可变**的形状累积，最后再落成 `Claim`。
  // 直接用 `Partial<Claim>` 不行：`Claim` 的字段是 `readonly`，
  // `Partial` 会把只读一起继承过来，于是每一处赋值都报 ts(2540)。
  let cur: { claim: string; stated?: string; path?: string; expect: 'exists' | 'absent' } | null = null;

  for (const line of lines.slice(start + 1)) {
    // 缩进回到顶层就是这一段结束了
    if (line.trim() !== '' && !/^\s/.test(line)) break;

    const item = /^\s*-\s*claim:\s*(.+?)\s*$/.exec(line);
    if (item) {
      if (cur) claims.push(cur as Claim);
      cur = { claim: unquote(item[1]), expect: 'exists' };
      continue;
    }
    if (!cur) continue;

    const field = /^\s+(stated|path|expect):\s*(.+?)\s*$/.exec(line);
    if (!field) continue;
    const value = unquote(field[2]);
    if (field[1] === 'expect') {
      if (value !== 'exists' && value !== 'absent') {
        throw new Error(
          `verify 声明里的 expect 只能是 exists 或 absent，读到 "${value}"。` +
            `—— 含糊的值会让这条声明悄悄失效。`,
        );
      }
      cur.expect = value;
    } else if (field[1] === 'path') {
      cur.path = value;
    } else {
      cur.stated = value;
    }
  }
  if (cur) claims.push(cur as Claim);
  return claims;
}

function unquote(raw: string): string {
  const t = raw.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * 把 `*` / `**` 的通配路径转成正则。
 *
 * ⚠️ **不要用占位符再替换的写法。** 第一版是把 `**` 换成 `' '`、
 * 最后 `.replace(/ /g, '.*')`——结果那个占位符在写文件时变成了一个
 * **真的 NUL 字节**（`\x00`），于是 `grep` 把这个源文件当成二进制，
 * 而 `RegExp` 里躺着一个看不见的控制字符。改成一次遍历拼出来，
 * 没有中间态，也就没有可被弄坏的地方。
 */
/**
 * 正则里需要转义的字符。
 *
 * 写成常量而不是内联字面量，是因为**内联那份被写坏过两次**——
 * `\` 在正则字符类里要写两次，而经过 shell / Python 一层层转义之后
 * 很容易变成 `[\]`（提前闭合字符类，后面整行变成语法错误）。
 * 抽出来之后，这行只在一处、只写一遍。
 */
const ESCAPE_RE = /[.+^${}()|[\]\\]/g;

export function globToRegExp(glob: string): RegExp {
  // 只转义**正则里有意义**的字符。注意字符类里要写 `\\]` 与 `\\\\`：
  // 漏掉反斜杠自己会让 `\d` 这类片段被当成转义继续跑下去。
  const escapeSegment = (seg: string) =>
    seg.replace(ESCAPE_RE, '\\$&').replace(/\*/g, '[^/]*');

  const segments = glob.split('/');
  let out = '';
  // `**` 段代表「零个或多个目录」，每个都自带尾斜杠。
  //   - 它**前面**那个分隔符照常补（`src/**/*.ts` 里 `src` 后的 `/`）；
  //   - 它**后面**那个不补（补了就变成「至少一层子目录」）。
  let skipNextSeparator = false;
  segments.forEach((seg, i) => {
    if (i > 0 && !skipNextSeparator) out += '/';
    skipNextSeparator = false;
    if (seg === '**') {
      out += i === segments.length - 1 ? '.*' : '(?:[^/]+/)*';
      skipNextSeparator = true;
      return;
    }
    out += escapeSegment(seg);
  });
  return new RegExp(`^${out}$`);
}

/**
 * 核对一组声明。
 *
 * `exists` 由调用方注入——这样这个模块是纯的（不读文件系统），
 * 可以被穷举测试；而「哪些文件算数」是调用方的决定，
 * 它知道仓库根在哪、要不要忽略 `.git`。
 */
export function evaluateClaims(
  claims: readonly Claim[],
  pageSource: string,
  exists: (glob: string) => boolean,
): ClaimProblem[] {
  const problems: ClaimProblem[] = [];

  for (const c of claims) {
    if (!c.path) {
      problems.push({ claim: c.claim, path: '', message: '声明里没有 path——这条声明查不了任何东西' });
      continue;
    }

    // ① 正文里那句原话还在不在
    if (c.stated !== undefined && !pageSource.includes(c.stated)) {
      problems.push({
        claim: c.claim,
        path: c.path,
        message:
          `声明里写的是「${c.stated}」，但这句话已经不在页面上了。` +
          `—— 正文改了、声明没改。这条声明此刻在验一句没人说过的话。`,
      });
      continue;
    }

    // ② 文件在不在
    const found = exists(c.path);
    const want = c.expect === 'exists';
    if (found !== want) {
      problems.push({
        claim: c.claim,
        path: c.path,
        message: want
          ? `声明说 ${c.path} 应该存在，但它不在。` +
            (c.stated ? `（页面上的说法：「${c.stated}」）` : '')
          : `声明说「${c.stated ?? c.claim}」，也就是 ${c.path} **不该存在**，但它在了。` +
            `—— 功能已经落地，页面上的话没跟着改。`,
      });
    }
  }

  return problems;
}
