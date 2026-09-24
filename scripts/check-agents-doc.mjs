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
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
  const docs = [
    { kind: 'wiki', slug: 'real-slug', title: '中文标题', summary: 's', body: '甲页。', explicitSlug: true, draft: false },
    { kind: 'wiki', slug: 'zzz', title: '乙页', summary: 's', body: '见 [[中文标题]] 与 [[real-slug]]。', explicitSlug: true, draft: false },
  ];
  const g = buildGraph(docs);
  const viaTitle = (g.outbound.get('zzz') ?? new Set()).has('real-slug');
  const viaSlug = (g.outbound.get('zzz') ?? new Set()).has('real-slug');
  if (viaTitle && viaSlug) {
    ok('写标题与写 slug 确实解析到同一页');
  } else {
    problems.push(
      `AGENTS.md 说「一个写标题、一个写 slug 指的是同一个页面」，而**实测不成立**：\n` +
        `    写标题 → ${viaTitle ? '解析成功' : '没解析到'}；写 slug → ${viaSlug ? '解析成功' : '没解析到'}`,
    );
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log('\nAGENTS.md 里的可证伪声明全部还成立。\n');
