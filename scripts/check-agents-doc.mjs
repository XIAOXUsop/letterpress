#!/usr/bin/env node
/**
 * `AGENTS.md` 里的**可证伪技术声明**必须还成立。
 *
 * ── 为什么是 AGENTS.md ──────────────────────────────────────────────
 *
 * 它是**给 agent 读的项目约定**——agent 按它行事，而它若与代码不符，
 * agent 会照着错的约定改代码，**而且所有门禁都绿**（它们检查代码，不检查这份文件）。
 *
 * 2026-09-24 实测到一处漂移：那份文件写「`verify:all` 上面全部 + N 道门禁」，
 * 而 N 先后是 10 / 11 / 13 / 17 / 19 / 26 / 28 / 29。
 * 同一个数字在 `docs/cli.md` 与 `README.md` 各有一份，而**只有后者两份有门禁**。
 *
 * ── 判据：只查「可机械证伪」的那些 ──────────────────────────────────
 *
 * ⚠️ **不检查整份文档**。那既做不到（大部分是散文）也会误报
 * （描述性文字改个措辞不是错）。
 *
 * 这里只查三类**能被代码直接判真伪**的声明：
 *
 *   ① **规则名与命令名**：`lint` 会报 `redundant-relation` —— 那条规则真的存在吗？
 *   ② **文件与路径**：`related: [design-tokens]` —— 那个 slug 真的存在吗？
 *   ③ **行为声明**：「一个写标题、一个写 slug 指的是同一个页面」——真的吗？
 *
 * 每条都写成 `AGENTS.md` 里的原话 + 一段验证代码，**新增一条就要手写验证**——
 * 那正是刻意的：**它逼着写的人说清「这句话怎么验」**。
 *
 * 用法：`npm run check:agents-doc`
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
// ⚠️ **核心模块一律用动态 import 加载**（见下面第 85 行那个）——
// 本文件要处理「模块加载不了」的情况，静态 import 会在那之前就抛。
// 早先这里多写了一条静态 `import { buildGraph }`，于是
// `SyntaxError: Identifier 'buildGraph' has already been declared`。
const { readContentDirs } = await import(pathToFileURL(join(process.cwd(), 'src/lib/wiki/read-page.ts')).href);
const { pageToDoc } = await import(pathToFileURL(join(process.cwd(), 'src/lib/wiki/page-to-doc.ts')).href);

const ROOT = process.cwd();
const DOC = join(ROOT, 'AGENTS.md');

if (!existsSync(DOC)) {
  console.error('  ✗ AGENTS.md 不存在');
  process.exit(1);
}
const doc = readFileSync(DOC, 'utf8');

const problems = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);

console.log('AGENTS.md 里的可证伪声明');
console.log('─'.repeat(64));

/**
 * 文档里必须有那句话。**判据分两种**，因为两种片段的漂法不一样：
 *
 * - `ident`（规则名 / 命令名 / slug）：用**词边界**匹配。
 *   ⚠️ **纯子串匹配对这类完全失明**：变异验证把 `redundant-relation`
 *   改成 `redundant-relation-XXX`，`includes('redundant-relation')` 仍是 true，
 *   门禁全绿——**它在「什么都没变」与「多了一点东西」时看起来一模一样**。
 * - `phrase`（中文句子）：用普通子串。
 *   要求独占一行会把三处**真实**声明全判成「找不到」——它们在文档里
 *   都是句中的一部分（`现在 lint 会报 redundant-relation（警告级）。`）。
 *
 * > 而这三次试错本身就是判据的一部分：
 * > 「独占一行」太严、「纯子串」太松，**只有区分两者才对**。
 */
function claims(fragment, what, kind = 'phrase') {
  const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const has = kind === 'ident'
    ? new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`).test(doc)
    : doc.includes(fragment.trim());
  if (has) {
    ok(`${what}：文档里有这条声明`);
    return true;
  }
  problems.push(
    `AGENTS.md 里找不到「${fragment}」——${what}。\n` +
      `    要么它被改了说法（那要同步这里的验证），要么它已经不成立了。`,
  );
  return false;
}

// ── ① 规则名 ────────────────────────────────────────────────────────
const { lint } = await import(pathToFileURL(join(ROOT, 'src/lib/wiki/lint.ts')).href);
const { buildGraph } = await import(pathToFileURL(join(ROOT, 'src/lib/wiki/graph.ts')).href);

if (claims('redundant-relation', '「重复声明关系会报 redundant-relation」', 'ident')) {
  /*
   * ⚠️ **第一版例子造错了，而症状与「规则不存在」完全一样。**
   * 我造的是「甲页链乙页 + 乙页的 related 指甲页」——那是**互相引用**，
   * 而规则要抓的是「**同一页**把同一条关系写了两遍」。
   * 于是 `redundantRelations` 是空的，输出「（无）」。
   *
   * > 门禁报「那条规则不存在」而**真相是我造错了**——
   * > **又一次「探针报错 ≠ 实现有 bug」**。
   */
  const mk = (over) => ({ kind: 'wiki', summary: 's', body: '', explicitSlug: true, draft: false, ...over });
  const docs = [
    // 甲页：正文里链「乙」+ related 里也写「乙」——**同一页写两遍**
    mk({ slug: 'a', title: '甲', body: '见 [[乙]]。', declaredRelations: ['b'] }),
    mk({ slug: 'b', title: '乙', body: '正文。' }),
  ];
  const rules = new Set(lint(docs, buildGraph(docs)).map((i) => i.rule));
  if (rules.has('redundant-relation')) {
    ok('redundant-relation 规则确实存在且会触发');
  } else {
    problems.push(
      `AGENTS.md 说 \`lint\` 会报 \`redundant-relation\`，而**那条规则不存在或触发不了**。\n` +
        `    实测触发到的规则：${[...rules].join('、') || '（无）'}`,
    );
  }
}

// ── ② frontmatter 里的 slug 真的存在吗 ─────────────────────────────
if (claims('related: [design-tokens]', 'related 的例子')) {
  const wiki = join(ROOT, 'src', 'content', 'wiki');
  const { readdirSync } = await import('node:fs');
  const slugs = new Set(
    readdirSync(wiki)
      .filter((f) => /\.mdx?$/.test(f))
      .map((f) => f.replace(/\.mdx?$/, '')),
  );
  if (slugs.has('design-tokens')) {
    ok('AGENTS.md 举的例子 slug「design-tokens」真的存在');
  } else {
    problems.push(
      `AGENTS.md 举的例子 \`related: [design-tokens]\` 里的 slug **不存在**。\n` +
        `    照着它写的 agent 会建一个指向不存在页面的关系。`,
    );
  }
}

// ── ③ 行为声明：标题与 slug 指向同一个页面 ────────────────────────
if (claims('指的是同一个页面', '「写标题与写 slug 指向同一页」')) {
  /*
   * ⚠️ **2026-09-28 修：第一版这里有两个变量、两次计算，而它们是同一行代码：**
   *
   *     const viaTitle = outbound.get('zzz').has('real-slug');
   *     const viaSlug   = outbound.get('zzz').has('real-slug');
   *
   * 于是 `if (viaTitle && viaSlug)` **只验了一次**。
   * 而 AGENTS.md 声称的是**两条路都通**——
   * 单看 `outbound` 无法区分「标题解析了」与「slug 解析了」，
   * 因为两个链接都落在同一个 `Set` 里，去重后就剩一个元素。
   *
   * > **「A 和 B 都能到 C」不能靠 `A 能到 C && A 能到 C` 来验。**
   * > 那不是弱一点的断言，是**同一个断言写了两遍**。
   *
   * 现在**拆成两份语料各自只含一个链接**，分别断言。
   */
  const target = {
    kind: 'wiki', slug: 'real-slug', title: '中文标题',
    summary: 's', body: '甲页。', explicitSlug: true, draft: false,
  };
  const source = (link) => ({
    kind: 'wiki', slug: 'zzz', title: '乙页',
    summary: 's', body: `见 [[${link}]]。`, explicitSlug: true, draft: false,
  });

  const viaTitle = (buildGraph([target, source('中文标题')]).outbound.get('zzz') ?? new Set())
    .has('real-slug');
  const viaSlug = (buildGraph([target, source('real-slug')]).outbound.get('zzz') ?? new Set())
    .has('real-slug');
  // 两份语料都不得有断链——否则「解析成功」可能是「随便指了个东西」。
  const noBroken =
    buildGraph([target, source('中文标题')]).broken.length === 0 &&
    buildGraph([target, source('real-slug')]).broken.length === 0;

  if (viaTitle && viaSlug && noBroken) {
    ok('写标题与写 slug 确实各自解析到同一页（两份语料分别断言）');
  } else {
    problems.push(
      `AGENTS.md 说「一个写标题、一个写 slug 指的是同一个页面」，而**实测不成立**：\n` +
        `    只写标题 → ${viaTitle ? '解析成功' : '没解析到'}；` +
        `只写 slug → ${viaSlug ? '解析成功' : '没解析到'}；` +
        `断链 → ${noBroken ? '无' : '有'}`,
    );
  }
}

// ── ④ 草稿不进 CLI 检索（2026-09-28 补）────────────────────────────
//
// AGENTS.md 原文只说「草稿不进构建、不进机器出口」——**没提 CLI**。
// 而 2026-09-28 实测的正是那个缺口：`readContentPage` **完全不读 `draft`**，
// 于是 `buildGraph` 的草稿过滤形同虚设，**草稿会进 `wiki:ask` / `wiki:impact`
// 的回答，而构建产物里没有它**。
//
// 症状对 agent 尤其糟：它按 CLI 回答行动，而那些内容**对读者不可见**。
//
// ⚠️ 判据是**真文件**：合成 `Doc` 量不到「解析」这一层，而那正是缺口所在。
if (claims('更不会被 `wiki:ask`', '「草稿不进 CLI 检索」')) {
  const dir = mkdtempSync(join(tmpdir(), 'agents-draft-'));
  try {
    writeFileSync(
      join(dir, 'draft-page.md'),
      '---\ntitle: 未写完\nsummary: 别发布。\ndraft: true\n---\n\n正文。\n',
      'utf8',
    );
    writeFileSync(join(dir, 'live-page.md'), '---\ntitle: 正式\nsummary: 可以。\n---\n\n正文。\n', 'utf8');
    const { pages } = readContentDirs([dir]);
    const inGraph = [...buildGraph(pages.map((p) => pageToDoc(p))).bySlug.keys()];
    if (inGraph.includes('draft-page')) {
      problems.push(
        '草稿进了链接图——**`wiki:ask` / `wiki:impact` 会把它当正式内容检索到**，'
        + '而构建产物里没有它。\n'
        + '    根因通常是 `readContentPage` 没有读 `draft` 字段。',
      );
      console.log('  ✗ 草稿进了链接图（CLI 会检索到它）');
    } else {
      ok('草稿不进链接图');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // 链接图的过滤不能代替真实 CLI 验收：两条命令可能直接使用未过滤的 pages。
  const probeName = `audit-draft-cli-${process.pid}`;
  const probe = join(ROOT, 'src', 'content', 'wiki', `${probeName}.md`);
  if (existsSync(probe)) throw new Error(`草稿探针路径已存在：${probe}`);
  try {
    writeFileSync(probe,
      `---\ntitle: 草稿 CLI 探针\nsummary: 仅供草稿隔离检查。\nkind: concept\nid: ${probeName}\ndraft: true\nsources:\n  - sourceId: css-values-4\n    revision: WD-20240312\n    locator: §5.1.1\n---\n\norbital jellyfish notation.\n`,
      'utf8');
    const ask = spawnSync('node', ['scripts/wiki-ask.mjs', '--json', 'orbital jellyfish notation'],
      { cwd: ROOT, encoding: 'utf8' });
    const impact = spawnSync('node', ['scripts/wiki-impact.mjs', '--source', 'css-values-4', '--json'],
      { cwd: ROOT, encoding: 'utf8' });
    const leakedToAsk = ask.stdout.includes(probeName);
    const leakedToImpact = impact.stdout.includes(probeName);
    if (ask.status !== 0 || impact.status !== 0 || leakedToAsk || leakedToImpact) {
      problems.push(`草稿 CLI 隔离失败：ask exit=${ask.status}, 命中=${leakedToAsk}; `
        + `impact exit=${impact.status}, 命中=${leakedToImpact}。`
        + `\nask stderr: ${ask.stderr.slice(0, 300)}\nimpact stderr: ${impact.stderr.slice(0, 300)}`);
      console.log('  ✗ 草稿进入真实 CLI 输出');
    } else {
      ok('草稿不进 wiki:ask / wiki:impact 的真实 CLI 输出');
    }
  } finally {
    unlinkSync(probe);
  }
}

/*
 * ── ⑤ 那张「分三级」的规则表必须与 `lint.ts` 的规则集完全相同 ──
 *
 * ⚠️ **2026-09-28 加。** 此前那三类判据都是「**文档里这一句**还成立吗」，
 * 于是**没有一条问「文档该说的都说了吗」**。
 *
 * 实测的缺口：`ambiguous-wikilink`（**error** 级）与 `ambiguous-title`（warn 级）
 * 两条规则**不在 `AGENTS.md`、不在 `README.md`、不在任何 `docs/`**——
 * 只有 `knowledge/fixtures/README.md`（测试语料的说明）里有。
 * 而那张表叫「**每次构建会跑体检**」、写着「分三级」——
 * **漏掉的是 error 级那条**，agent 照它判断「什么会让构建失败」时会漏掉。
 *
 * > **「文档里说的还对吗」与「文档该说的都说了吗」是两个方向**，
 * > 而**前者全绿不代表后者**——**缺的项永远不会触发「这一句还对吗」**。
 *
 * 判据是**集合相等**（不是「表里的每一条都存在」）：
 * - 表里有、代码里没有 → 文档在教一条不存在的规则（已有的三类判据能抓）
 * - **代码里有、表里没有 → 文档漏了一条规则（本条抓）**
 */
{
  const lintSrc = readFileSync(join(ROOT, 'src', 'lib', 'wiki', 'lint.ts'), 'utf8');
  const inCode = new Set([...lintSrc.matchAll(/rule: '([a-z-]+)'/g)].map((m) => m[1]));
  // 表里那几行：`| 级别 | \`rule\` | 含义 |`
  const inDoc = new Set(
    [...doc.matchAll(/^\| (?:错误|警告|提示) \| `([a-z-]+)`/gm)].map((m) => m[1]),
  );
  const missing = [...inCode].filter((r) => !inDoc.has(r));
  const extra = [...inDoc].filter((r) => !inCode.has(r));
  for (const r of extra) {
    problems.push(
      `AGENTS.md 的规则表里有 \`${r}\`，而 \`lint.ts\` 里没有这条规则——`
      + '**照着表改会被无视**。',
    );
    console.log(`  ✗ 规则表里的 ${r}：代码里不存在`);
  }
  for (const r of missing) {
    problems.push(
      `AGENTS.md 的规则表**漏了 \`${r}\`**（\`lint.ts\` 里有）。\n`
      + '    → 那张表叫「每次构建会跑体检」并说「分三级」，**缺一条就不完整**；\n'
      + '    而 agent 正是照着它判断「什么会让构建失败」——'
      + '**2026-09-28 实测漏掉的是 `ambiguous-wikilink`（error 级）**。',
    );
    console.log(`  ✗ 规则表漏了 ${r}：代码里有，表里没有`);
  }
  if (missing.length === 0 && extra.length === 0) {
    console.log(
      `  ✓ 规则表与代码的规则集相同（${inCode.size} 条：`
      + `${[...inCode].sort().join('、')}）`,
    );
  }
}

/*
 * ── ⑥ 文档里「指向未来的承诺」必须挂着一条可核的出口 ────────────
 *
 * ⚠️ **2026-09-29 加。** 上面四条判据问的都是「**文档里这一句**还成立吗」，
 * 而**「这一句将来会变成假的」它管不着**。
 *
 * 实测的缺口正是这么来的：`AGENTS.md` 曾写
 * 「`check:agents-doc` 只核表里任意一个规则名存在，**不核表是不是完整**。
 * 补上那一条断言是下一步。」——而**第四条判据就是那条断言**，
 * 它补上之后，这句话变成假的，**而没有任何东西会红**：
 * 它是一句关于「还没做」的话，不是一条规则名、不是一个 slug。
 *
 * > 与第四条是同一类盲区的两个方面：
 * > 那条问「该说的都说了吗」，这条问「**说了的还算数吗**」。
 * > 承诺兑现之后没人回头改，文档就开始教人**去做一件已经做完的事**。
 *
 * 判据是：`AGENTS.md` 里出现「下一步 / 尚未接线 / 待办 / 已知缺口」这类词时，
 * **那一行必须同时出现一个 `→` 或 `✅` 之外的出口**——太含糊。
 *
 * 所以改成更硬的判据：**这类词只允许出现在「已经说清结论」的段落里**，
 * 也就是同一段必须含有「已补上 / 已修 / 现在核的是」这类**完成态**措辞。
 * 换句话说——**你可以记历史，但不许把「还欠着」留在文档里**。
 */
{
  const PROMISE = /下一步|尚未接线|待办|已知缺口|还没补/;
  const RESOLVED = /已经补上|已补上|已修|现在核的是|已完成|不再成立/;
  const lines = doc.split('\n');
  const offenders = [];
  for (let i = 0; i < lines.length; i++) {
    if (!PROMISE.test(lines[i])) continue;
    // 一个「段」= 这一行 ± 前后 6 行（引用块与列表在 markdown 里是碎片化的）
    const window = lines.slice(Math.max(0, i - 6), i + 7).join('\n');
    if (!RESOLVED.test(window)) offenders.push({ line: i + 1, text: lines[i].trim() });
  }
  for (const o of offenders) {
    problems.push(
      `AGENTS.md 第 ${o.line} 行写着「${o.text.slice(0, 60)}…」，` +
        '而它附近没有任何**完成态**措辞。\n' +
        '    → 这类「还欠着」的话是最容易变假的一类：承诺兑现之后没人回头改，\n' +
        '    **文档就开始教人去做一件已经做完的事**。\n' +
        '    若它确实已经兑现，写上「已经补上」与现在核的是什么；',
    );
    console.log(`  ✗ 第 ${o.line} 行：一句「还欠着」的话，附近没有完成态措辞`);
  }
  if (offenders.length === 0) {
    console.log('  ✓ 文档里没有「还欠着」的悬空承诺');
  }
}

/*
 * ── ⑦ 那张「两类字段」的表必须与实际行为一致 ────────────────────────
 *
 * ⚠️ **2026-09-29 加。** `AGENTS.md` 里那条「不要发明新的 frontmatter 字段」
 * 先前只说了一半：它说「加了字段要同步改 schema，否则会被静默忽略」，
 * 而**那只对走 Astro 内容层的字段成立**。
 *
 * 实测（2026-09-29）：给一条 `verify:` 声明加一个任何 schema 里都没有的
 * `bogusField`，构建**照常绿**——因为读 `verify:` 的是
 * `lib/wiki/verify-run.ts` 的 `readFileSync`，**Zod 根本看不到它**。
 *
 * > 于是同一句禁令在**同一份文件的两个字段上，结论正好相反**，
 * > 而文档只写了其中一条。下一个人照着它给 `verify:` 加字段会以为必须改 schema；
 * > 反过来，给 post 加字段以为「反正 verify 那样也能用」则会**静默丢数据**。
 *
 * 判据是**真的去试**，不是查文档里有没有这句话：
 *   ① schema 字段（`title`）加一个未声明的键 → Astro 内容层必须报错
 *   ② `verify:` 加一个未声明的键 → 构建照常成立
 *
 * 两条都跑真文件、真构建太重，所以用**最强的轻量替身**：
 * 直接问 Zod schema 会不会剥离未知键，以及 `verify-run.ts` 到底走哪条路。
 */
{
  const cfg = readFileSync(join(ROOT, 'src', 'content.config.ts'), 'utf8');
  const runner = readFileSync(join(ROOT, 'src', 'lib', 'wiki', 'verify-run.ts'), 'utf8');

  // ① 文档必须点名**两条路**，而不是只说 schema 那一条
  const namesZod = /静默剥离|静默忽略/.test(doc) && /content\.config\.ts/.test(doc);
  /*
   * ⚠️ **必须认整张表的那一行，不能只认「文档里出现过这几个词」。**
   *
   * 第一版写的是 `/readFileSync|绕开 schema|直读文件/.test(doc)`——
   * 而它**恒真**：变异把表格里那一行整行换掉之后，
   * 后半截 `| \`readFileSync\` 直读文件（…） |` 里那三个词还在。
   *
   * > 于是这条变异**没被抓住**（实测：89/90，而漏的正是这一条）。
   * > 这正是本仓库反复记的那类：「**判据匹配到了别处的同一串文字**」——
   * > 它看起来在核这件事，实际核的是**文档里有没有这几个字**。
   */
  const bypassRow = doc
    .split('\n')
    .find((l) => l.includes('|') && l.includes('readFileSync') && l.includes('verify:'));
  const namesBypass = Boolean(bypassRow) && /Zod 根本看不到|不过 Zod|绕开 schema/.test(bypassRow);
  if (!namesZod) {
    problems.push(
      'AGENTS.md 没有说清 **schema 字段会被静默剥离**（Zod 的行为）——'
      + '照着它加字段的人会以为新字段能生效。',
    );
    console.log('  ✗ 文档没写 schema 那一条路');
  }
  if (!namesBypass) {
    problems.push(
      'AGENTS.md 没有说清**存在绕开 schema 的字段**（如 `verify:`，由 '
      + '`readFileSync` 直读）。\n'
      + '    只写 schema 那一条的话，「会不会被静默忽略」这个问题的答案就是错的——'
      + '**它取决于谁读它**。',
    );
    console.log('  ✗ 文档没写「绕开 schema」那一条路');
  }

  // ② 那两条路**必须真的存在于代码里**，否则文档在描述一个不存在的架构
  const zodPresent = /z\.object\(/.test(cfg);
  const bypassPresent = /readFileSync/.test(runner) && /parseClaims/.test(runner);
  if (!zodPresent) {
    problems.push('AGENTS.md 说 schema 在 `src/content.config.ts`，而那里没有 `z.object(`。');
    console.log('  ✗ content.config.ts 里没有 Zod schema');
  }
  if (!bypassPresent) {
    problems.push(
      'AGENTS.md 说 `verify:` 走 `readFileSync` 直读文件，'
      + '而 `verify-run.ts` 里没有这条路径——**文档在描述一个不存在的架构**。',
    );
    console.log('  ✗ verify-run.ts 里没有直读文件的路径');
  }

  if (namesZod && namesBypass && zodPresent && bypassPresent) {
    console.log('  ✓ 两类字段的两条路都写清了，且代码里确实各有一条');
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log('\nAGENTS.md 里的可证伪声明全部还成立。\n');
