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
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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
      ok('草稿不进链接图（CLI 检索不到它）');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log('\nAGENTS.md 里的可证伪声明全部还成立。\n');
