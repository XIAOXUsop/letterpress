#!/usr/bin/env node
/**
 * **`AGENTS.md` 那张规则表里的「级别」必须与真跑出来的一致。**
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 那张表叫「**每次构建会跑体检**」，两列：**规则名**与**级别**。
 * 2026-09-28 之前：
 * - 规则名那一列，`check:agents-doc` 只核了**任意一个**（`redundant-relation`）；
 *   2026-09-28 补了「规则集相等」——**当时那张表漏了 2 条**（含一条 **error** 级）。
 * - **级别那一列，一条都没核。**
 *
 * > 而「`broken-wikilink` 是 error（会让构建失败）」正是 **agent 最会照着用的那一列**——
 * > `AGENTS.md` 开头就写着「那是**给 agent 读的约定**」。
 * > **级别错了，agent 的整个决策就错了，而所有门禁都绿。**
 *
 * ── 为什么必须真跑，不能静态分析 ────────────────────────────────────
 *
 * ⚠️ **试过静态分析，不可靠**：`level:` 散在各规则函数内部，
 * 「从 `rule:` 往上找 12 行」只捞到 **1/11** 条。
 * 而 `check:field-coverage` 那次也栽在同一处（字面匹配三次自己失败）。
 *
 * **级别是运行期属性，只能跑出来。**
 *
 * ── 语料要造到 11 条全触发，而那需要三件事 ─────────────────────────
 *
 * ① **跑两轮**：`docKind: 'post'` 会让 `orphan-page` / `redundant-relation`
 *    都不报（wiki 专属），而 wiki 那轮不报 `reserved-post-slug`
 *    （它判 `doc.kind !== 'post'`）。**一轮只测得到一部分。**
 *    ⚠️ 第一次只跑 wiki 一轮，7 条里少了 2 条，我一度以为是「语料不对」。
 * ② **同名标题要造两对**：一对**被引用**（→ `ambiguous-wikilink`），
 *    一对**没人引用**（→ `ambiguous-title`）。只有一对时后者被盖掉。
 * ③ **两个「同名但不同」别搞混**：`duplicate-slug` 是 **slug 相同、标题不同**；
 *    `ambiguous-*` 是**标题相同、slug 不同**。第一次造反了，只触发到后者。
 *
 * 用法：`node scripts/check-rule-levels.mjs`
 */
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const problems = [];

console.log('规则表里的级别与实测是否一致');
console.log('─'.repeat(64));

const { readContentDirs } = await import(
  pathToFileURL(join(ROOT, 'src/lib/wiki/read-page.ts')).href
);
const { pageToDoc } = await import(
  pathToFileURL(join(ROOT, 'src/lib/wiki/page-to-doc.ts')).href
);
const { buildGraph } = await import(
  pathToFileURL(join(ROOT, 'src/lib/wiki/graph.ts')).href
);
const { lint } = await import(pathToFileURL(join(ROOT, 'src/lib/wiki/lint.ts')).href);

const dir = mkdtempSync(join(tmpdir(), 'rule-levels-'));
/** 一篇内容页。`summary` 由调用方给全——**助手再写一遍会覆盖它**。 */
const page = (title, slug, extra = '', body = '正文。') =>
  `---\ntitle: ${title}\nslug: ${slug}\nkind: concept\nsummary: 一句话。\n${extra}---\n\n${body}\n`;

try {
  // ── 语料：每条规则一个触发点 ──────────────────────────────────────
  writeFileSync(join(dir, '断链.md'), page('断链', '断链', '', '见 [[根本不存在的目标]]。'), 'utf8');
  // duplicate-slug：**slug 相同、标题不同**
  writeFileSync(join(dir, '撞名-a.md'), page('甲篇', '同一个'), 'utf8');
  writeFileSync(join(dir, '撞名-b.md'), page('乙篇', '同一个'), 'utf8');
  // ambiguous-wikilink：**标题相同、slug 不同**，且被引用
  writeFileSync(join(dir, '导出-甲.md'), page('导出', '导出-甲'), 'utf8');
  writeFileSync(join(dir, '导出-乙.md'), page('导出', '导出-乙'), 'utf8');
  writeFileSync(join(dir, '引用歧义.md'), page('引用歧义', '引用歧义', '', '见 [[导出]]。'), 'utf8');
  // ambiguous-title：同名但**没人引用**
  writeFileSync(join(dir, '附录-甲.md'), page('附录', '附录-甲'), 'utf8');
  writeFileSync(join(dir, '附录-乙.md'), page('附录', '附录-乙'), 'utf8');
  // orphan-page：没有入链
  writeFileSync(join(dir, '孤儿.md'), page('孤儿', '孤儿'), 'utf8');
  // missing-summary
  writeFileSync(
    join(dir, '无摘要.md'),
    '---\ntitle: 无摘要\nslug: 无摘要\nkind: concept\n---\n\n正文。\n', 'utf8',
  );
  // empty-body
  writeFileSync(
    join(dir, '空正文.md'),
    '---\ntitle: 空正文\nslug: 空正文\nkind: concept\nsummary: x\n---\n\n', 'utf8',
  );
  // redundant-relation：正文链接与 related 各写一次
  writeFileSync(
    join(dir, '重复关系.md'),
    page('重复关系', '重复关系', 'related: [断链]\n', '见 [[断链]]。'), 'utf8',
  );
  // summary-too-long：摘要超限（**不能走 `page()`**——它会再写一个 summary 覆盖掉）
  writeFileSync(
    join(dir, '长摘要.md'),
    `---\ntitle: 长摘要\nslug: 长摘要\nkind: concept\nsummary: ${'长'.repeat(260)}\n---\n\n正文。\n`,
    'utf8',
  );
  // cjk-slug：没有显式 slug（**info 级，默认关闭** → 要显式打开）
  /*
   * ⚠️ **2026-09-29 变异验证的第一条就是这一段。**
   * 删掉它 → `cjk-slug` 触发不到 → **报的是「语料没能触发」那条**，
   * **而级别那条仍然全过**。
   *
   * > **这正是本检查最该被看见的失败方向**：
   * > 「没测到」与「测到且一致」在结果上无法区分（形态四），
   * > **而它选了「红」**——那是对的（语料缺一条就是没核到），
   * > **但它红的是「我漏了」而不是「它错了」**，**诊断里必须说清**。
   */
  writeFileSync(
    join(dir, '中文标题.md'),
    '---\ntitle: 中文标题没写 slug\nkind: concept\nsummary: x\n---\n\n正文。\n', 'utf8',
  );
  // reserved-post-slug：文章占用系统路由（**只在 docKind: 'post' 那轮报**）
  writeFileSync(
    join(dir, '占位.md'),
    '---\ntitle: about\nslug: about\nkind: post\nsummary: x\n---\n\n正文。\n', 'utf8',
  );
  // 入口页：给孤儿/长摘要/空正文/无摘要/重复关系/中文标题各一条入链，
  // 免得它们全被 orphan-page 淹没（那是预期的另一条，会盖掉别的）
  writeFileSync(
    join(dir, '入口.md'),
    page('入口', '入口', '', '见 [[孤儿]]、[[长摘要]]、[[空正文]]、[[无摘要]]、[[重复关系]]、[[中文标题没写slug]]。'),
    'utf8',
  );

  const { pages: wikiPages } = readContentDirs([dir]);
  const wikiDocs = wikiPages.map((p) => pageToDoc(p));
  const { pages: postPages } = readContentDirs([dir], { docKind: 'post' });
  const postDocs = postPages.map((p) => pageToDoc(p));

  const issues = [
    ...lint(wikiDocs, buildGraph(wikiDocs), { warnOnCjkSlug: true }),
    ...lint(postDocs, buildGraph(postDocs), {
      warnOnCjkSlug: true,
      reservedPostRoutes: new Map([['about', '关于页']]),
    }),
  ];

  /** 实测：规则名 → 级别集合。 */
  const measured = new Map();
  for (const i of issues) {
    if (!measured.has(i.rule)) measured.set(i.rule, new Set());
    measured.get(i.rule).add(i.level);
  }

  // ── 文档声称：级别中文 → 代码里的 level ───────────────────────────
  const LEVEL_CN = { 错误: 'error', 警告: 'warn', 提示: 'info' };
  const doc = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  const claimed = new Map();
  for (const m of doc.matchAll(/^\| (错误|警告|提示) \| `([a-z-]+)`/gm)) {
    claimed.set(m[2], LEVEL_CN[m[1]]);
  }

  console.log(`  语料触发 ${measured.size} 条规则；文档声称 ${claimed.size} 条\n`);

  // ⚠️ **语料没触发到的规则必须报，不能默认通过**——
  // 「没触发」与「触发且一致」在结果上无法区分（形态四）。
  for (const rule of measured.keys()) {
    const actual = [...measured.get(rule)];
    if (actual.length > 1) {
      problems.push(
        `\`${rule}\` 在同一份语料上报了**多个级别**（${actual.join(' / ')}）——`
        + '**一条规则一个级别**，否则文档那一列没法写。',
      );
      console.log(`  ✗ ${rule}：级别不唯一（${actual.join(' / ')}）`);
      continue;
    }
    const got = actual[0];
    if (!claimed.has(rule)) continue; // 「表里没有」由 check:agents-doc 第四条报
    if (claimed.get(rule) !== got) {
      problems.push(
        `AGENTS.md 说 \`${rule}\` 是「${claimed.get(rule)}」，实测是「${got}」。\n`
        + '    → **那张表是 agent 照着判断「什么会让构建失败」的地方**，'
        + '而级别错了整个决策就错了。',
      );
      console.log(`  ✗ ${rule}：文档写 ${claimed.get(rule)}，实测 ${got}`);
    } else {
      console.log(`  ✓ ${rule}：${got}`);
    }
  }

  const notTriggered = [...claimed.keys()].filter((r) => !measured.has(r));
  for (const r of notTriggered) {
    problems.push(
      `文档声称的 \`${r}\` **这份语料没能触发它**——所以它的级别此刻没被核。\n`
      + '    → 「没触发」与「触发且一致」在结果上无法区分。'
      + '**语料要造到每条规则都能触发**（见文件头的三件事）。',
    );
    console.log(`  ✗ ${r}：语料没能触发，级别未被核对`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

/*
 * ── 第三列「含义」：**能跑出真假的那些，逐条核** ──────────────────────
 *
 * 那张表有三列：规则名（已核集合相等）、级别（已核逐条真跑）、
 * **含义（唯一一列写给人看的）** ——「agent 照着它理解每条规则到底在说什么」。
 *
 * ⚠️ **11 条里只有 5 条能机械核**，其余 6 条描述的是**机制**
 * （而机制由 `check:field-coverage` 在字段层核过）。
 * **核不了的那 6 条必须写明**，否则「核了 5 条」会被读成「11 条都核了」。
 *
 * 每条都是一个**能跑出真假的具体说法**，不是「描述得像不像」——
 * 「默认关闭」要真的默认不报，「没有任何页面指向它」要有入链/没入链各跑一次。
 */
{
  /** 跑一份临时语料，返回它报出的规则名集合。 */
  const probe = (files, opts = {}) => {
    const d = mkdtempSync(join(tmpdir(), 'rule-claims-'));
    try {
      for (const [n, b] of Object.entries(files)) writeFileSync(join(d, n), b, 'utf8');
      const { pages: ps } = readContentDirs([d]);
      const ds = ps.map((x) => pageToDoc(x));
      return { rules: new Set(lint(ds, buildGraph(ds), opts).map((i) => i.rule)), orphans: buildGraph(ds).orphans };
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  };
  const P = (title, slug, extra = '', body = '正文。') =>
    `---\ntitle: ${title}\nslug: ${slug}\nkind: concept\nsummary: 一句话。\n${extra}---\n\n${body}\n`;

  /** @type {{rule: string, claim: string, ok: boolean, detail: string}[]} */
  const claims = [];
  const claim = (rule, text, ok, detail) => {
    claims.push({ rule, claim: text, ok, detail });
    console.log(`  ${ok ? '✓' : '✗'} ${rule}：${text}${ok ? '' : ` —— ${detail}`}`);
  };

  // ① cjk-slug：「默认关闭，可在配置里开」
  {
    const noSlug = {
      '无slug.md': '---\ntitle: 没有显式 slug\nkind: concept\nsummary: x\n---\n\n正文。\n',
    };
    const off = probe(noSlug).rules;
    const on = probe(noSlug, { warnOnCjkSlug: true }).rules;
    const docLine = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
      .split('\n').find((l) => /^\| (?:错误|警告|提示) \| `cjk-slug`/.test(l)) ?? '';
    const saysOn = /默认开启|默认打开|默认启用/.test(docLine);
    const saysOff = /默认关闭|默认关/.test(docLine);
    /*
     * ⚠️ **我第一版在这里多写了一个 `actuallyOff !== actuallyOn`，而它恒假。**
     *
     * `actuallyOff` 是「默认**不**报」、`actuallyOn` 是「**开选项后**报」——
     * **两者本来就都是 true**（「默认不报」与「开选项会报」并不矛盾）。
     * 我把「两句话」当成「一对互斥的取值」来比，于是干净态就红了。
     *
     * > **「默认关闭，可在配置里开」是两句话，不是一个二选一**——
     * > 核它要**两件独立的事**：① 文档说的默认行为与实测一致
     * > ② 那个选项**真的能打开它**（否则「可配置」是假的）。
     */
    const docMatchesReality = saysOn
      ? off.has('cjk-slug')              // 文档说默认开 → 默认就该报
      : saysOff && !off.has('cjk-slug');  // 文档说默认关 → 默认就不该报
    const optionActuallyToggles = on.has('cjk-slug') && !off.has('cjk-slug');
    claim(
      'cjk-slug', '「默认关闭，可在配置里开」——**文档那句话**与实测一致，且那个选项真能打开它',
      // 文档必须**明确说开或关**（两说都不说也要红）
      saysOn !== saysOff && docMatchesReality && optionActuallyToggles,
      `文档说「${saysOn ? '默认开启' : saysOff ? '默认关闭' : '（没说）'}」，`
      + `实测默认${off.has('cjk-slug') ? '会报' : '不报'}、开选项后${on.has('cjk-slug') ? '会报' : '不报'}`
      + (optionActuallyToggles ? '' : '（**那个选项根本没改变行为**）'),
    );
  }
  // ② orphan-page：「没有任何页面指向它」
  {
    /*
     * ⚠️ **断言要写成「有入链的不在 orphans 里、没入链的在」**，
     * 而**不是**「整份语料不报 orphan-page」。
     *
     * 第一版那么写，红了——而**规则完全正确**：语料只有 2 篇，
     * **入口那篇自己没有任何入链**，所以它**必然是孤儿**、必然被报。
     *
     * > **这是 2026-09-28 第四次「我以为对不上，其实量错了东西」**
     * > （前三次：注释量 HTML 侧而 docs 量 MD 侧 / 静态分析只捞到 1 条 /
     * > 探针正则漏了「检查了 N 个」）。
     */
    const files = { '被链.md': P('被链', '被链'), '入口.md': P('入口', '入口', '', '见 [[被链]]。') };
    const { rules, orphans } = probe(files);
    claim(
      'orphan-page', '「没有任何页面指向它」——有入链的不报、没入链的报',
      !orphans.includes('被链') && orphans.includes('入口') && rules.has('orphan-page'),
      `orphans=${JSON.stringify(orphans)}（期望含「入口」不含「被链」）`,
    );
  }
  // ③ empty-body：「没写完就加 draft: true」
  {
    const body = '---\ntitle: 空正文\nslug: 空正文\nkind: concept\nsummary: x\n---\n\n';
    const asPost = probe({ '空正文.md': body }).rules;
    const asDraft = probe({ '空正文.md': body.replace('summary: x', 'summary: x\ndraft: true') }).rules;
    claim(
      'empty-body', '「没写完就加 draft: true」——加了草稿标记就不再报',
      asPost.has('empty-body') && !asDraft.has('empty-body'),
      `未标草稿报了=${asPost.has('empty-body')}，标了仍报=${asDraft.has('empty-body')}`,
    );
  }
  // ④ summary-too-long：「摘要过长」（默认上限 200）
  {
    const mk = (n) => ({
      '摘要.md': `---\ntitle: 摘要\nslug: 摘要\nkind: concept\nsummary: ${'长'.repeat(n)}\n---\n\n正文。\n`,
    });
    const at = probe(mk(200)).rules;
    const over = probe(mk(201)).rules;
    claim(
      'summary-too-long', '「摘要过长」——超过上限（默认 200）才报',
      !at.has('summary-too-long') && over.has('summary-too-long'),
      `恰好 200 字报了=${at.has('summary-too-long')}，201 字报了=${over.has('summary-too-long')}`,
    );
  }
  // ⑤ ambiguous-title：「还没有人引用它」——被引用后改报 ambiguous-wikilink
  {
    const pair = { '导出-甲.md': P('导出', '导出-甲'), '导出-乙.md': P('导出', '导出-乙') };
    const un = probe(pair).rules;
    const re = probe({ ...pair, '引用方.md': P('引用方', '引用方', '', '见 [[导出]]。') }).rules;
    claim(
      'ambiguous-title', '「还没有人引用它」——被引用后改报 ambiguous-wikilink',
      un.has('ambiguous-title') && !un.has('ambiguous-wikilink')
        && re.has('ambiguous-wikilink') && !re.has('ambiguous-title'),
      `没人引用时=${[...un].join('、')}；有人引用时=${[...re].join('、')}`,
    );
  }

  // ⚠️ **核不了的要显式列出来**——「核了 5 条」不等于「11 条都核了」
  const NOT_CLAIMABLE = [
    'broken-wikilink', 'duplicate-slug', 'reserved-post-slug',
    'missing-summary', 'redundant-relation',
  ];
  console.log(
    '  ℹ 另有 ' + NOT_CLAIMABLE.length + ' 条的「含义」核不了（'
    + NOT_CLAIMABLE.join('、')
    + '）——它们描述的是**机制**，而机制由 `check:field-coverage` 在字段层核。',
  );

  for (const c of claims) {
    if (!c.ok) {
      problems.push(
        `AGENTS.md 说 \`${c.rule}\` ${c.claim}——**实测不成立**。\n`
        + `    ${c.detail}\n`
        + '    → 那一列是**唯一写给人看的**，agent 照着它理解规则在做什么。',
      );
    }
  }
  if (claims.every((c) => c.ok)) {
    console.log(`  ✓ ${claims.length} 条可机械核的「含义」全部成立`);
  }
}

/*
 * ── 自测：**「没触发」与「触发且一致」必须能被分开** ──────────────────
 *
 * ⚠️ **2026-09-29 补的。** 本检查原来**只有正例**（11 个 `✓`），
 * **没有一条「不该红」的样本**。
 *
 * 而它有**两种完全不同的红**：
 * ① 「`X` 的级别是 A，实测是 B」——**实现错了**
 * ② 「`X` 这份语料没能触发它」——**语料缺一条**，而**实现可能完全正确**
 *
 * > **②不是误报**（那条规则此刻真的没被核），**但它红的是「我漏了」而不是「它错了」**——
 * > **而这两种红在输出上必须能分开**，否则读的人会去改实现。
 *
 * 这个自测验的正是：**「级别那条全过」与「没触发那条红」能否同时成立**。
 * 若它们绑在一起，那么**实现对不对就永远分不清**了。
 */
{
  /** 重跑一次**故意少一条语料**的语料，看「没触发」会不会被抓到。 */
  const shrunk = mkdtempSync(join(tmpdir(), 'rule-levels-selftest-'));
  try {
    // 只造 `broken-wikilink` 需要的那一篇 → 其余 10 条**都触发不到**
    writeFileSync(
      join(shrunk, '断链.md'),
      '---\ntitle: 断链\nslug: 断链\nkind: concept\nsummary: s\n---\n\n见 [[不存在]]。\n', 'utf8',
    );
    const { pages: sp } = readContentDirs([shrunk]);
    const sd = sp.map((p) => pageToDoc(p));
    const rules = new Set(
      lint(sd, buildGraph(sd), { warnOnCjkSlug: true }).map((i) => i.rule),
    );
    // ⚠️ **自己解析文档声称的规则集**——`claimed` 定义在上面那个 `try` 块里，
    // 而这个自测在块**外**，引用不到（第一版就这么写的，运行时会 ReferenceError）。
    const LEVEL_CN = { 错误: 'error', 警告: 'warn', 提示: 'info' };
    const claimedHere = new Map(
      [...readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
        .matchAll(/^\| (错误|警告|提示) \| `([a-z-]+)`/gm)]
        .map((m) => [m[2], LEVEL_CN[m[1]]]),
    );
    const restMiss = [...claimedHere.keys()].filter((r) => !rules.has(r));
    const total = claimedHere.size;
    if (rules.size + restMiss.length === total && restMiss.length > 0) {
      console.log(
        `  ✓ 自测：语料只造一篇时触发 ${rules.size} 条、其余 ${restMiss.length} 条被「没能触发」抓到，`
        + `    ${rules.size}+${restMiss.length}=${total}（**「没测到」与「测到且一致」分得开**）`,
      );
    } else {
      problems.push(
        '**自测失效**：「只造一条语料」本该只触发 1 条规则，'
        + `实际触发 ${rules.size} 条（${[...rules].join('、')}）、`
        + `「没触发」抓到 ${restMiss.length} 条（期望 10）。\n`
        + '    → 而**「没测到」与「测到且一致」分不开**时，'
        + '**「实现对不对」就永远分不清**。',
      );
      console.log(`  ✗ 自测失效：触发 ${rules.size} 条、没触发抓到 ${restMiss.length} 条`);
    }
  } finally {
    rmSync(shrunk, { recursive: true, force: true });
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log('\n规则表里的 11 个级别与真跑出来的一致。\n');
