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

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log('\n规则表里的 11 个级别与真跑出来的一致。\n');
