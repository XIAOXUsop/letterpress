#!/usr/bin/env node
/**
 * **同一份清单不许在两处各写一遍。**
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 2026-09-28 一天之内在 `letterpress` 找到**四处**「同一件事两处实现」：
 *
 * | # | 重复的东西 | 漂开的后果 |
 * |---|---|---|
 * 1 | frontmatter 解析（`wiki-impact.mjs` / `check-impact.mjs` 各一份逐行扫描） | 两个命令对同一页给出不同的引用集，**两边都绿** |
 * 2 | `urlFor` 的 URL 前缀（`graph.ts` / remark 插件各一份） | 站内链接与页面路由对不上——**死链** |
 * 3 | `readContentDirs` 与 `readContentPage` 各算一遍 `summary` / `original` | 同一个字段两个真值，差异是「两个方向各缺一半」 |
 * 4 | `DOC_GLOBS` 与 `ROOTS`（两份逐字相同的文档清单） | 两道门禁扫不同的东西，**而读者只看到一道的结论** |
 *
 * > **共同形态：漂开时不报错。** 每处都要靠人偶然发现，
 * > 而发现成本随项目变大而上升——所以第 4 处是在**已经找到第 3 处之后**
 * > 才用一条 grep 找到的。
 *
 * ── 判据 ────────────────────────────────────────────────────────────
 *
 * **已登记的清单不许在别处再写一遍字面量。**
 * `SHARED_LITERALS` 是登记处，每条写清**它是什么、为什么该只有一处**。
 * 扫全部 `.ts` / `.mjs`，报出「除登记处以外还出现的地方」。
 *
 * ⚠️ **它量的是「字面量又出现了」，不是「逻辑又实现了」。**
 * 后者量不到（那要读懂每个函数）——但**字面量是绝大多数漂开的载体**，
 * 而漏报的代价（悄悄多一处真值）高于误报的代价（多写一行注释）。
 *
 * 用法：`node scripts/check-single-literal.mjs`
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const problems = [];
/** 刻意不校验的条目——**要让读输出的人看见**，否则它与「忘了填」无法区分。 */
const skipped = [];

/**
 * 登记：**这个字面量只允许在这里出现。**
 *
 * ⚠️ 加一条之前先答：**它漂开的后果是什么？** 答不上来就别登记——
 * 那只是一次重构，不是门禁。
 */
const SHARED_LITERALS = [
  {
    literal: "'README.md', 'AGENTS.md', 'docs', 'src/content'",
    where: 'scripts/lib/doc-roots.mjs',
    what: '「哪些文件算文档」的清单',
    why: '两份拷贝时，check-doc-refs 与 check-anchor-links 会扫不同的东西，'
      + '而读者只看到其中一道的结论',
  },
  {
    // 「解析 frontmatter 里的 sources / review / original」没有单一字面量——
    // 它的实现标志是**取一个顶层字段下面那些缩进行**。
    // 所以这条走 `implOf` 而不是 `literal`。
    //
    // ⚠️ **2026-09-28 改过两次标志**：
    // ① 原先认 `for (const line of block.split`（逐行扫整份 frontmatter），
    //    而那**正是下面 `sources` 被别的块覆盖那个 bug 的成因**；
    // ② 修 bug 时把切块逻辑抽成 `indentedBlockOf`，两处共用。
    //
    // > **这个门禁在那一刻红了，而它红得对**——判据指向的写法真的变了。
    // > 它的诊断（「要么它被改名，要么它真的没了」）正是为这种情况写的。
    // > **判据抓到了「实现变了」而不是「实现坏了」**——而这要靠人去分。
    implOf: (t) => /indentedBlockOf\(block, '(?:sources|review|original)'\)/.test(t),
    where: 'src/lib/wiki/read-page.ts',
    what: 'frontmatter 块（sources / review / original）的切块与解析',
    why: '两份实现时 wiki:impact 与 check:impact 会对同一页给出不同的引用集，'
      + '**而两个命令都是绿的**；而逐行扫整份 frontmatter 时，'
      + '**别的块里的 `revision:` 会覆盖当前那条来源**（实测复现，2026-09-28 已修）',
  },
  {
    // ⚠️ **2026-09-28 补登记。** 收敛 `['scripts','src']` 那天，
    // `check-portability` 的 `PROD_CALLERS` 与 `check-no-duplicate-lists` 的
    // `ROOT_DIRS` 逐字相同，于是抽成了 `scripts/lib/source-dirs.mjs`。
    //
    // > **这份登记表是「哪些清单必须只有一处」的完整清单**，
    // > 而那天我只加了新门禁（它们各自抓得住），**没往这里登记**——
    // > 于是「登记处」与「实际收敛点」不同步，而**没有任何东西会发现**。
    // >
    // > 这与「同一份清单在两个文件里」不同：`check:no-duplicate-lists`
    // > 只在**一个文件内**查重复，**跨文件那 1 份是探针量出来的**，
    // > 而量完就删了探针——**结论没有落进任何常跑的门禁**。
    // > 「量过一次」不等于「会一直成立」。
    literal: "'scripts', 'src'",
    where: 'scripts/lib/source-dirs.mjs',
    what: '「我们自己的源码在哪」这两个目录',
    why: '两份拷贝时 check-portability 的「哪些算核心调用方」与 '
      + 'check-no-duplicate-lists 的「扫哪些文件」会扫不同的范围，'
      + '**而读者只看到其中一道的结论**',
  },
  {
    // ⚠️ **2026-09-28 补登记。** 那天实测 61 个单文件命令里 8 个的命令名与
    // 脚本名对不上，于是建了 `scripts/lib/command-scripts.mjs` 存那张册子。
    // **册子本身也是「同一份事实写两遍」**（package.json 一份、册子一份），
    // 所以它必须只有一处定义。
    //
    // ⚠️ **锚点不能用 `'scripts/bundle-and-verify.mjs'`**——
    // 第一次登记时就用了它，于是报「`check-exit-codes.mjs` 里也有」。
    // 那**不是重复**：那是一张**豁免表**（文件 → 为什么豁免），
    // 而册子是**命令名 → 脚本名**——**两张不同的清单恰好提到同一个文件名**。
    //
    // > **判据要锚在「这张清单独有的东西」上，不是「它提到的东西」上。**
    // > 后者匹配的是**引用**，而引用可以是**完全不同的另一张表**。
    // > 这与 `check:field-coverage` 那次「字面匹配三次自己失败」同族。
    literal: "'verify vs check 的前缀差'",
    where: 'scripts/lib/command-scripts.mjs',
    what: '命令名与脚本名对不上的那张册子',
    why: '两份拷贝时 check-command-scripts 的「登记是否与 package.json 一致」'
      + '会拿旧册子去比，**而它报出来的差异全是假的**（因为有一份是真的）',
  },
];

console.log('同一份清单不许写两遍');
console.log('─'.repeat(64));

// 扫全部源码
const files = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) {
      if (!['node_modules', '.git', 'dist', '.astro', '.verify', 'public'].includes(e.name)) walk(p);
    } else if (/\.(ts|mjs|astro)$/.test(e.name)) {
      files.push(p);
    }
  }
};
for (const d of ['src', 'scripts']) walk(join(ROOT, d));

if (files.length === 0) {
  console.error('一个源码文件都没扫到——这个检查什么都没量。');
  process.exit(1);
}
console.log(`  扫了 ${files.length} 个文件\n`);

/*
 * ⚠️ **必须排除本文件。**
 *
 * `SHARED_LITERALS` 里就写着那个字面量（那是**登记处**），
 * 而本文件自己也是被扫的 `.mjs`——于是它把自己判成「第二处」。
 *
 * 第一次跑就是这样红的。**判据自己红了，而被测对象是对的。**
 *
 * 排除的办法是**按文件名**（与 `check-portability` 排除自己的做法一致），
 * 不是靠「字符串等于自己」这种自指判断。
 */
/*
 * ⚠️ **必须排除「故意弄坏」的那些。**
 *
 * ① 本文件自己——`SHARED_LITERALS` 里就写着那个字面量（那是**登记处**），
 *    而本文件自己也是被扫的 `.mjs`——于是它把自己判成「第二处」。
 * ② `*.mutations.mjs`——**那些脚本的职责就是把某个写法复制一份**，
 *    所以它们必然含被登记的字面量。**它们不是真值，是测试夹具。**
 *
 * ⚠️ ① 第一次跑就抓到了（2026-09-28）；
 * ② 是写完 `new-gates.mutations.mjs` 之后立刻撞上的——
 * **新增一个变异脚本就会触发**，而那正是这个门禁该报的「第二处」，
 * 只是那处**不是漂开，是夹具**。
 *
 * 排除的办法是**按文件名模式**，不是自指判断。
 */
const SELF = 'check-single-literal.mjs';
const scanned = files.filter((f) => !f.endsWith(SELF) && !f.endsWith('.mutations.mjs'));
if (scanned.length === 0) {
  console.error('排除自己之后一个文件都不剩——这个检查什么都没量。');
  process.exit(1);
}


/*
 * ── 第一步：把每条登记的**结论**算出来，一个分支都不依赖 ──────────────
 *
 * ⚠️ **2026-09-28 修了四轮才看明白：前三轮都在防「控制流」，而这里的问题不是控制流。**
 *
 * ① `if (!item.where) continue;` —— **完全静默**
 * ② 加守卫（没 `skip` 就报错）—— 守卫与 `else` 是**两个出口**，
 *    拆掉守卫 → `{ what: 'x' }` 被打印成 `ℹ 刻意不校验：x——undefined` 并放行
 * ③ 合成一个 `if/else` —— 拆掉 `if` → 后面两行**无条件执行**
 * ④ 「失败条件与控制流解耦」 —— **也错了**：
 *    `problems.push` **就在那个 `if` 的 body 里**，
 *    拆掉 `if` 等于**拆掉记账本身**，而 `else` 照样打印 `ℹ`。
 *
 * > **四次都栽在同一句话上：「结构上只有一个出口，所以拆不掉」。**
 * > 而**能拆掉它的不是结构，是「结论由分支是否执行决定」这件事**——
 * > 只要 `problems.push` 在某个 `if` 里面，
 * > **把那个 `if` 改成 `if (false)` 就等于删掉这条判据**，而变异脚本干的正是这个。
 *
 * 所以：**先无条件算出每条登记的状态，再按状态打印。**
 * 状态是一个**数据**（`bad` / `dup` / `missing` / `ok` / `skipped`），
 * 而 `problems` 的填充**不依赖任何 `if` 是否被拆**——
 * 「有没有问题」由**数据的取值**决定，不由**分支跑没跑**决定。
 *
 * ⚠️ 这**不防**「把 `analyze` 整个删掉」那种变异——那任何门禁都防不住。
 * 它防的是**「逐条判据被单独摘掉」**，而那正是今天这四轮的实际形态。
 */

/** @type {{what: string, why: string}[]} */
const checked = [];
/** 无 `where` 且没写 `skip` 理由的登记——**它们的失败不依赖任何分支**。 */
const unexplained = [];
/** 刻意不校验且写了理由的登记。 */
const deliberatelySkipped = [];

for (const item of SHARED_LITERALS) {
  if (!item.where) {
    // ⚠️ 记账在 `if` **之外**：`unexplained` 记录「该报」这件事，
    // 打印在后面单独做。拆掉任何分支都不影响 `problems` 会不会非空。
    if (typeof item.skip !== 'string' || item.skip.trim() === '') {
      unexplained.push(item.what ?? '(未命名)');
    } else {
      deliberatelySkipped.push({ what: item.what, reason: item.skip.trim() });
    }
    continue;
  }

  /*
   * 两种匹配：**字面量**（`literal`）与**实现标志**（`implOf`）。
   * 后者用于「那段解析没有单一字面量，但它的写法可以认」的情况——
   * 2026-09-28 已修的第一处（frontmatter 块解析）就是这种。
   */
  const matches = (text) => (item.literal ? text.includes(item.literal) : item.implOf(text));
  const hits = scanned
    .filter((f) => matches(readFileSync(f, 'utf8')))
    .map((f) => relative(ROOT, f).split(sep).join('/'));

  if (hits.length === 0) {
    checked.push({
      what: item.what,
      why: item.why,
      bad: `登记的清单「${item.what}」在 \`${item.where}\` 里找不到了——\n`
        + '    要么它被改名 / 挪走（那要更新这条登记），要么它**真的没了**'
        + '（那两道门禁正扫不到东西，而它们会绿）。',
      short: '登记处已经找不到了',
    });
  } else if (hits.length > 1) {
    checked.push({
      what: item.what,
      why: item.why,
      bad: `「${item.what}」出现在 ${hits.length} 处：${hits.join('、')}\n`
        + `    登记处是 \`${item.where}\`。\n`
        + `    **漂开的后果**：${item.why}\n`
        + '    把多余的改成 import 登记处；若那处确实该有一份自己的，'
        + '**先答「漂开的后果是什么」再改这条登记**。',
      short: `${hits.length} 处（${hits.join('、')}）`,
    });
  } else {
    checked.push({ what: item.what, why: item.why, ok: hits[0] });
  }
}

// ── 第二步：按上面算出的结论打印与记账 ─────────────────────────────────
//
// 这一段**只读数据、不做判定**——所以变异改不了「结论是什么」，
// 最多改「怎么显示」。

for (const w of unexplained) {
  problems.push(
    `\`${w}\` 没有 \`where\`——**它不会被校验**，`
    + '而没写 `skip: 理由` 时这一条在输出上完全看不出来。\n'
    + '    → 「刻意不校验」必须**显式且可见**，否则它与「忘了填」无法区分。',
  );
  console.log(`  ✗ ${w}：没有 where，也没有写明为什么不校验`);
}
for (const s of deliberatelySkipped) {
  skipped.push(`${s.what}（${s.reason}）`);
  console.log(`  ℹ 刻意不校验：${s.what}——${s.reason}`);
}
for (const c of checked) {
  if (c.bad) {
    problems.push(c.bad);
    console.log(`  ✗ ${c.what}：${c.short}`);
  } else {
    console.log(`  ✓ ${c.what}：只在 ${c.ok}`);
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log(`\n${SHARED_LITERALS.filter((i) => i.where).length} 份登记的清单都只有一处。\n`);
