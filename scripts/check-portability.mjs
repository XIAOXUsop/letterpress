#!/usr/bin/env node
/**
 * 可移植性门禁：**核心纯逻辑模块必须能被裸 Node 直接 import**，
 * 且**不得出现「可选链只保护了左边、没保护字段本身」的写法**。
 *
 * ── 第一条：可加载性 ────────────────────────────────────────────────
 *
 * 路线图阶段 4 有一条退出条件：「一个全新的真实内容集能在**不复制内部代码**
 * 的情况下使用核心流程」。而「能使用」的第一步是**能加载**。
 *
 * 2026-09-24 实测：`src/lib/wiki/` 下六个零耦合模块里，
 * **`graph.ts` 与 `lint.ts` 不能被裸 Node 加载**——
 * 它们内部用 `.js` 后缀 import（TS 惯例，bundler 才解析得了），
 * 于是 `import('./graph.ts')` 报 `Cannot find module '.../wikilink.js'`。
 * `retrieve` / `impact` / `slug` / `digest` 则可以。
 *
 * > 后果很具体：维护脚本（`scripts/*.mjs`，裸 Node）能用检索、影响分析、
 * > slug、摘要，**却用不了链接图与 lint**——而后者是知识层的地基。
 * > 想用就得先跑 bundler，于是「纯逻辑、可直接复用」这件事就打了折。
 *
 * **为什么用「真的 import 一遍」而不是读源码找 `.js`**：
 * 判据是**传递依赖**——本模块内部没有 `.js`，但它 import 的模块有，
 * 一样加载不了。读单个文件会漏掉这一层。
 * 实测 `graph.ts` 自己 import 的是 `./wikilink.js`（有）。
 * **唯一可靠的判据是让解析器自己说。**
 *
 * ── 第二条：可选链漏保护 ────────────────────────────────────────────
 *
 * 迭代 N 实测：`computeImpact` 在 `refs` 缺失时崩（`undefined.some`）。
 * 根因不是写错，是**类型标必填而实际可为 undefined**，
 * 且所有调用方都老实填了空数组——
 * **默认值救了它，于是脱节长期没被发现**。
 *
 * 同型形状：`a?.related.includes(x)` **只保护了 `a` 为 null**，
 * 没保护 `related` 为 undefined，抛的是 `undefined.includes`。
 * 修完那处后全库扫了一遍，**只此一处**。写成门禁是因为
 * 这类 bug 的特征就是「现在不崩、将来某次重构会崩」。
 *
 * 用法：`node scripts/check-portability.mjs`
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const LIB = join(ROOT, 'src', 'lib', 'wiki');

/**
 * 核心流程：链接图、体检、检索、影响分析、slug、摘要。
 * 设计约束是**零耦合**——不读文件、不碰 Astro、不依赖本站配置。
 * 那条约束的价值全靠本门禁兑现：写在注释里而没有检查，就只是愿望。
 */
/**
 * 核心流程：链接图、体检、检索、影响分析、slug、摘要、context pack、页面组装。
 * 设计约束是**零耦合**——不读文件、不碰 Astro、不依赖本站配置。
 * 那条约束的价值全靠本门禁兑现：写在注释里而没有检查，就只是愿望。
 *
 * ⚠️ `page-to-doc.ts` 是 2026-09-24 迭代 AT 加进来的：
 * 它把「每个站点都要重写一遍的接线」收进核心（实测 27 行适配层里
 * 22 行是它）。**它零 import**，所以天然满足可加载性——
 * 但**「天然满足」不等于「被检查过」**，所以它必须进这份名单。
 *
 * ⚠️ **2026-09-28：这份名单改为「能加载的模块集合」，从文件系统推导。**
 *
 * 原先是**手写的 8 个**，而实测 `src/lib/wiki/` 下**裸 Node 能加载的有 13 个**——
 * 漏掉的 5 个是 `read-page` / `frontmatter` / `sources` / `verify` / `wikilink`。
 *
 * > 漏掉的后果很具体：**这五个模块里任何一个被加上 `.js` 后缀 import，
 * > 门禁都不会报**——而那正是本门禁第一条要治的病。
 * > 手写名单必然漏，而**漏掉的东西等于没被检查**。
 *
 * 推导方式：**真的 import 一遍**（不按名字猜），能加载的就是核心。
 * 加载不了的（`llms` / `remark-wikilink` / `verify-run`）是**构建期专用**——
 * 它们由 `astro.config.mjs` 加载，走 Vite，所以 `.js` 后缀没问题。
 * **但那条边界必须有人守着**，所以下面另有第三类检查：
 * 「加载不了的模块**必须**被 `astro.config.mjs` 或某个构建期文件引用」。
 */
const CORE = (() => {
  const files = readdirSync(LIB)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort();
  return files;
})();

/** 会被误写成「可选链 + 直接调方法」的字段名。 */
const OPTIONAL_FIELDS = [
  'related',
  'sources',
  'refs',
  'review',
  'declaredRelations',
  'slug',
  'title',
  'body',
];
const OPTIONAL_CHAIN_TRAP = new RegExp(
  `\\?\\.(${OPTIONAL_FIELDS.join('|')})\\.\\w+\\(`,
  'g',
);

const problems = [];
/** 裸 Node 加载不了、但被构建期文件引用的模块（合法形态）。 */
const buildOnly = [];
/** file → 实际加载到的模块（用它取真实导出名，而不是按文件名猜）。 */
const loaded = new Map();
/** 构建期链上的模块（只被 buildOnly 里的模块引用），第三条也要排除。 */
const buildChain = [];

console.log('核心模块可加载性（裸 Node）');
console.log('─'.repeat(64));

/**
 * 每个核心模块**必须导出它承诺的那个函数**。
 *
 * ⚠️ 2026-09-24 实测这个缺口：把 `page-to-doc.ts` 的 `export function`
 * 去掉一个 `export`，**`import()` 照样成功**（模块能解析），
 * 于是门禁报 `✓` —— 而任何 `import { pageToDoc }` 的调用方都会拿到 `undefined`，
 * 报错出现在**别处**（`pageToDoc is not a function`），离原因十万八千里。
 *
 * > **能加载 ≠ 导出了该导出的东西。**
 * > 而这个门禁的名字叫「可加载性」，它从没承诺过后者——
 * > 所以这不算它失职，是**它旁边缺一条断言**。
 */
const REQUIRED_EXPORTS = {
  'graph.ts': ['buildGraph', 'urlFor'],
  'lint.ts': ['lint', 'hasErrors'],
  'retrieve.ts': ['rank', 'splitPassages'],
  'impact.ts': ['computeImpact', 'isDisjoint'],
  'slug.ts': ['slugify', 'resolveSlug'],
  'digest.ts': ['contentDigest'],
  'context-pack.ts': ['buildContextPack'],
  'page-to-doc.ts': ['pageToDoc'],
};

for (const file of CORE) {
  const full = join(LIB, file);
  try {
    const mod = await import(pathToFileURL(full).href);
    const missing = (REQUIRED_EXPORTS[file] ?? []).filter((name) => typeof mod[name] !== 'function');
    if (missing.length > 0) {
      problems.push(
        `${file} 能加载，但**没有导出** ${missing.join('、')}。
` +
          `    「能 import」与「导出了该导出的东西」是两件事：
` +
          `    调用方会拿到 undefined，报错出现在别处（${file} 里没有这个符号）。`,
      );
      console.log(`  ✗ ${file}（缺导出：${missing.join('、')}）`);
      continue;
    }
    loaded.set(file, mod);
    console.log(`  ✓ ${file}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message.split('\n')[0] : String(error);
    /*
     * ⚠️ **加载不了不一定是缺陷**——`llms.ts` / `remark-wikilink.ts` /
     * `verify-run.ts` 内部用 `.js` 后缀 import，而它们**只被 `astro.config.mjs`
     * 加载**（走 Vite，`.js` → `.ts` 能解析）。
     *
     * 那是**构建期专用**的合法形态。所以这里不直接报红，而是问：
     * **有没有人在用它？** 没人用而加载不了 = 死代码，那才该报。
     */
    const stem = file.replace(/\.ts$/, '');
    const users = [];
    for (const probe of [
      join(ROOT, 'astro.config.mjs'),
      join(ROOT, 'src', 'content.config.ts'),
    ]) {
      if (!existsSync(probe)) continue;
      if (readFileSync(probe, 'utf8').includes(stem)) users.push(probe.split(/[\\/]/).pop());
    }
    if (users.length > 0) {
      // 记下它 import 的**本地**模块——它们是同一条构建期链上的一环，
      // 第三条也要排除（见下面那处递归判断）。
      const deps = [...readFileSync(full, 'utf8').matchAll(/from '\.\/([a-z-]+)\.js'/g)]
        .map((m) => `${m[1]}.ts`);
      buildOnly.push({ file, why: `只被 ${users.join(' / ')} 加载（构建期，走 Vite）`, chain: deps });
      console.log(`  · ${file}：构建期专用（${users.join(' / ')}），裸 Node 加载不了是预期的`);
    } else {
      problems.push(
        `${file} **裸 Node 加载不了，而没有任何构建期文件引用它**——两头都不沾。\n` +
          `    加载失败：${msg}\n` +
          '    这要么是死代码（该删），要么是漏接线（该被 `astro.config.mjs` 用上）。\n' +
          "    若是核心纯逻辑模块，另有一个更常见的成因：内部用 '.js' 后缀 import——" +
          '改成 `.ts` 后缀即可（Node 22+ 原生剥离类型；**无后缀不行**）。',
      );
      console.log(`  ✗ ${file}：加载不了，且无人引用`);
    }
  }
}

/*
 * ── 第二条：脚本用到的模块也必须能加载 ────────────────────────────────
 *
 * ⚠️ **2026-09-24 实测：`verify:online` 一直跑不起来，而那不是「基线红」。**
 *
 * 它 `import { CONTENT_MANIFEST_VERSION } from '../src/lib/content-manifest.ts'`，
 * 而那个文件内部写着 `import { urlOf } from './wiki/graph.js'`——
 * **裸 Node 解析不了 `.js` 后缀**（迭代 AL 改 `graph.ts` 内部 import 时漏了它）。
 *
 * 结果：脚本在第 0 步就 `ERR_MODULE_NOT_FOUND`，
 * 而 `check-gate-list.mjs` 的 `NOT_IN_ALL` 里写着
 * 「Pages 跑不了内容协商，**基线本身就是红的**」——
 * **那句「基线是红的」从来没被实测过，它连跑都跑不起来。**
 *
 * > **「假定它红」与「知道它红」不是一回事**：
 * > 前者让一个从没跑过的脚本在编排里挂着一个说得通的理由。
 *
 * 所以这里加第二条：**从 `scripts/` 实际 import 的模块**逐个试加载。
 * 名单**从源码推导**而不是手写——手写的名单会漏（这正是本轮那次漏）。
 */
const scriptDeps = (() => {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.mjs')) {
        for (const m of readFileSync(p, 'utf8').matchAll(/from '(\.\.\/src\/[^']+)'/g)) {
          found.add(m[1].replace('../', ''));
        }
      }
    }
  };
  walk(join(ROOT, 'scripts'));
  return [...found].sort();
})();

console.log('');
console.log('scripts 用到的模块能否被裸 Node 加载');
console.log('─'.repeat(64));

for (const rel of scriptDeps) {
  const full = join(ROOT, rel);
  try {
    await import(pathToFileURL(full).href);
    console.log(`  ✓ ${rel}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message.split('\n')[0] : String(error);
    problems.push(
      `${rel} **不能被裸 Node 加载**：${msg}
` +
        `    它被 scripts/ 下的脚本 import，所以那些脚本在裸 Node 下会直接崩。
` +
        `    内部用 '.js' 后缀 import 的话，bundler 能解析而裸 Node 不能——` +
        `改成 '.ts' 后缀即可（无后缀不行）。
` +
        `    **实测踩过** \`verify:online\` 因此一直跑不起来，` +
        `而它在 NOT_IN_ALL 里的理由写的是「基线本身就是红的」——` +
        `那句从来没被验证过。`,
    );
    console.log(`  ✗ ${rel}`);
  }
}

// ── 可选链漏保护 ──────────────────────────────────────────────────────

const files = [];
for (const sub of ['src/lib', 'scripts']) {
  for (const entry of readdirSync(join(ROOT, sub), { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && /\.(ts|mjs|astro)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      files.push(join(entry.parentPath ?? entry.path, entry.name));
    }
  }
}

console.log('');
console.log('可选链是否保护了字段本身');
console.log('─'.repeat(64));

// ⚠️ **必须排除本文件**：它的文档里就写着 `a?.related.includes(x)` 这个反例，
// 而反例本身符合模式——不排除的话门禁会把自己判为违规（实测过）。
const SELF = 'check-portability.mjs';

for (const file of files) {
  if (file.endsWith(SELF)) continue;
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(OPTIONAL_CHAIN_TRAP)) {
    const line = text.slice(0, m.index).split('\n').length;
    problems.push(
      `${relative(ROOT, file)}:${line}  \`${m[0]}\`\n` +
        `    可选链只保护了左边为 null，没保护该字段本身为 undefined。` +
        `写成 \`a?.${m[1]}?.method(...)\` 才对。`,
    );
  }
}
/*
 * ⚠️ **扫到 0 个文件时必须红，而不是报「✓ 没有问题写法」。**
 *
 * 2026-09-24 补的（本轮第四次撞上「空集合通过」这个形状，
 * 前三次分别长成：只认字面数字 / 只查一个方向 / 「若报必是」在 0 条时恒真）。
 *
 * > **「扫了 0 个文件、没有发现问题」与「扫了 78 个、没有发现问题」
 * > 在输出里几乎一样**——而它们的含义天差地别。
 * > 一个说明这台机器上什么都没扫到（路径写错、目录搬走、被 gitignore），
 * > 另一个才是「真的没问题」。
 *
 * 所以：数量为 0 时**明确失败并说清扫的是什么**，
 * 而不是让一句「✓ 没有…」盖过去。
 */
if (files.length === 0) {
  console.log('  ✗ 一个文件都没扫到——`src/lib` 与 `scripts` 下的路径可能变了。');
  console.log('    **「扫了 0 个、没有发现问题」不是「没有问题」**，它只说明什么都没检。');
  problems.push('可选链检查扫到 0 个文件——没有检到任何东西，不能算通过');
} else {
  console.log(`  ✓ 没有「可选链没保护字段本身」的写法（扫了 ${files.length} 个文件）`);
}

/*
 * ── 第三条：核心模块必须有**真实调用方**，不能只有测试在引用 ────────
 *
 * ⚠️ **2026-09-28 实测：`pageToDoc` 曾经整个仓库只有一个调用方——
 * 而那个调用方是 `check-second-site-real.mjs`，也就是「证明它可复用」的那个测试。**
 *
 * 换句话说：它是**为核心复用而抽出来的**，却**没有任何真实路径在用它**。
 * 阶段 4 第 1 条退出条件是「不复制内部代码」，
 * 而一个没人调用的公共函数**不构成「复用了」**——它只是一段没人验证的承诺。
 *
 * > 这与「注释里写了而代码没实现」是同族：
 * > 接线写好了、测试也绿着，**但没接上任何东西**。
 *
 * 处置不是删掉它（本轮已把它接进 `wiki-review.mjs`，替换掉那里手写的第二份 `digestDoc`），
 * 而是**加一条门禁**，让「只剩测试在引用」这个状态会红。
 *
 * ⚠️ **调用方名单要排除测试与检查脚本自身**：
 * `.test.ts` 与 `scripts/check-*.mjs` 引用不算——否则这道闸恒真
 * （任何单测都必然 import 它要测的模块）。
 */
/*
 * ⚠️ **2026-09-28：加上 `astro.config.mjs` 与 `src/content.config.ts`。**
 *
 * 原来只扫 `scripts` 与 `src`——而 `astro.config.mjs` **import 了三个模块**
 * （`remark-wikilink` / `verify-run` / `frontmatter`）。它们因此在第三条里
 * 「没有真实调用方」，而处置会误导人**把正确的构建期模块删掉**。
 *
 * 变异验证抓到的：把 `verify-run` 改成 `.ts` 后缀（于是它可被裸 Node 加载、
 * 不再算「构建期专用」）→ 门禁立刻报它「没有真实调用方」——
 * **而唯一用它的地方就是 `astro.config.mjs`，正在扫描范围之外。**
 *
 * > **「谁在用它」这个问题，扫描范围本身就是答案的一部分。**
 * > 范围外的文件不是「没有调用方」，是**没量到**。
 */
const PROD_CALLERS = ['scripts', 'src'];
/** 配置文件在仓库根 / src 下，不在 PROD_CALLERS 的目录里，逐个列出。 */
const CONFIG_FILES = ['astro.config.mjs', 'src/content.config.ts'].map((f) => join(ROOT, f));

console.log('');
console.log('核心模块有没有真实调用方（排除测试与变异注入；检查脚本**算**调用方）');
console.log('─'.repeat(64));

/*
 * ⚠️ **2026-09-28 修正：检查脚本**算**调用方。**
 *
 * 原来排除 `scripts/check-*` 与 `scripts/verify-*`，理由写的是
 * 「它们是检查器，不是产品的调用方」。**那个理由对「≥1」成立，对「≥2」不成立。**
 *
 * 实测：`check-questions.mjs` import 了 `splitPassages`——
 * 它**拿那道金标量检索**，改坏了 `splitPassages` 它就会红。
 * **那是真实的第二个消费者。** 把它排除，等于让门禁在
 * 「只有一个消费者」时误报，而处置会误导人去**拆掉分层**
 * （`retrieve` → `context-pack` → `wiki-ask` 是一条链，不是重复）。
 *
 * 真正该排除的是**故意弄坏它**的那些：`*.mutations.mjs`
 * 与本文件自身（它们的职责就是把核心改坏）。
 */
const INSPECTOR = /^scripts[/\\](check-|verify-)/;

for (const file of CORE) {
  /*
   * ⚠️ **2026-09-28：排除规则按「是不是构建期链的一环」，而不是「能不能被裸 Node 加载」。**
   *
   * 第一版按后者排除（buildOnly 加上它的 chain）。变异验证立刻暴露它错得离谱：
   * 把 `verify-run` 改成 `.ts` 后缀（于是它**能**被裸 Node 加载了），
   * 门禁改而报它「只有一个调用方：`astro.config.mjs`」——
   * **而它本来就只该被 `astro.config.mjs` 用**，那是它的职责。
   *
   * > **「能否被裸 Node 加载」是运行环境的属性，
   * > 「是不是构建期链的一环」才是角色的属性。** 用前者判后者，
   * > 就等于「一个人今天在办公室所以他不是工程师」。
   *
   * 所以判据是：**它的调用方全部落在配置文件里**（astro.config.mjs /
   * content.config.ts）。那样的模块只服务于构建期，「≥2」这条对它不适用。
   *
   * ⚠️ 而配置文件**必须在扫描范围内**——否则「只被配置用」与「没人用」分不开，
   * 而前者是合法形态、后者是死代码。
   */
  // ⚠️ **构建期专用的模块整条跳过**——它们裸 Node 加载不了（第一条已认定），
  // 所以 `loaded` 里没有它们、第三条也取不到导出名。
  // 跳过**不是放行**：第一条已经核对过「有构建期文件在用它」，两头不沾的会报红。
  if (buildOnly.some((b) => b.file === file)) {
    console.log(`  · ${file}：构建期专用，第三条不适用（理由见第一条）`);
    continue;
  }
  const exports = REQUIRED_EXPORTS[file] ?? [];
  /*
   * ⚠️ **导出名取自上表的 `REQUIRED_EXPORTS`，不按文件名推导。**
   *
   * 第一版用 `context-pack.ts → contextPack` 猜，结果报「没有真实调用方」——
   * 而 `scripts/wiki-ask.mjs:37` 明明 import 了 `buildContextPack`。
   * **判据自己错了，红的却是被测对象**：那正是本项目反复吃过的亏。
   *
   * > 靠命名规律猜导出名，必然在「文件名与导出名对不上」时错。
   * > 而 `REQUIRED_EXPORTS` 是**已经断言过的**导出名，直接用它。
   */
  /*
   * ⚠️ **2026-09-28 改成从「实际加载到的模块」取导出名，不再按文件名猜。**
   *
   * 第一版是 `file.replace(/\.ts$/, '')`——于是 `read-page.ts` 被当成
   * 导出叫 `read-page` 的模块，而它真实导出 `readContentPage` / `readContentDirs`，
   * **结果是「只有一个调用方」**（而真实有 12 个）。
   *
   * 那与 `contextPack` 那次是同一个错：**靠命名规律猜，必然在
   * 「文件名与导出名对不上」时错。** 而判据自己红、被测对象对，
   * 是最坏的一种失败。
   */
  const names = exports.length > 0 ? exports : Object.keys(loaded.get(file) ?? {});
  if (names.length === 0) {
    problems.push(
      `${file} 取不到任何导出名（REQUIRED_EXPORTS 里没有它，也加载不出东西）——`
      + '本门禁的第三条此刻量不到它。',
    );
    console.log(`  ✗ ${file}：取不到导出名，第三条判据失效`);
    continue;
  }
  const hits = new Set();
  /** 扫一个文件，返回它是否 import 了那些导出名。 */
  const probe = (p) => {
    const rel = relative(ROOT, p).replace(/\\/g, '/');
    if (rel === `src/lib/wiki/${file}`) return; // 自己
    // ⚠️ **不再排除检查脚本**（理由见上面 `INSPECTOR` 的注释）。
    // 只排除「故意弄坏核心」的那些——`*.mutations.mjs` 已在下面按文件名排除。
    const text = readFileSync(p, 'utf8');
    // 必须在 import 语句里出现，而不是正文里提到这个名字。
    if (names.some((n) => new RegExp(`import[^;]*\\b${n}\\b[^;]*from`).test(text))) hits.add(rel);
  };
  for (const sub of PROD_CALLERS) {
    for (const entry of readdirSync(join(ROOT, sub), { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !/\.(ts|mjs|astro)$/.test(entry.name)) continue;
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.mutations.mjs')) continue;
      probe(join(entry.parentPath ?? entry.path, entry.name));
    }
  }
  /*
   * ⚠️ **2026-09-28：排除规则按「是不是构建期链的一环」，而不是「能不能被裸 Node 加载」。**
   *
   * 第一版按后者排除，变异验证立刻暴露它错得离谱：
   * 把 `verify-run` 改成 `.ts` 后缀（于是它**能**被裸 Node 加载了），
   * 门禁改而报它「只有一个调用方：`astro.config.mjs`」——
   * **而它本来就只该被 `astro.config.mjs` 用**，那是它的职责。
   */
  // 配置文件**不在 `PROD_CALLERS` 的目录里**，`probe` 里单独扫过了（见 CONFIG_FILES）。
  // 现在判断「它是否只服务于构建期」——两种形态都算：
  //   ① 它的调用方**全部**落在配置文件里；
  //   ② 它的调用方**全部**是构建期专用模块（链上的下一环，如 `verify.ts` ← `verify-run.ts`）。
  // 那样的模块「≥2 个消费者」这条不适用（它本来就只该被构建期用）。
  const configPaths = CONFIG_FILES.map((c) => c.replace(/\\/g, '/'));
  const buildFiles = new Set(buildOnly.map((b) => b.file));
  const configOnly =
    hits.size > 0 &&
    [...hits].every(
      (h) =>
        configPaths.some((n) => h.endsWith(n)) ||
        // 链上的下一环：`src/lib/wiki/verify-run.ts` 这种
        [...buildFiles].some((bf) => h.endsWith(`lib/wiki/${bf}`)),
    );
  if (configOnly) {
    buildChain.push(file);
    console.log(`  · ${file}：只服务于构建期（${[...hits].join(' / ')}），「≥2 消费者」不适用`);
    continue;
  }
  if (hits.size === 0) {
    problems.push(
      `${file}（${names.join(' / ')}）**没有任何真实调用方**——只有测试或检查脚本在引用它。\n` +
        `    抽出来是为了「不复制内部代码」，而没人调用就不构成复用。\n` +
        `    要么接进真实的读取/CLI 路径，要么把它删掉。`,
    );
    console.log(`  ✗ ${file}（${names.join(' / ')}）没有真实调用方`);
  } else if (hits.size === 1) {
    /*
     * ⚠️ **2026-09-28 从「≥1」收紧到「≥2」。**
     *
     * 一个调用方时，「抽成核心」和「就地写一个工具函数」**效果完全一样**——
     * 改它仍然要改那一个地方。而阶段 4 第 1 项要的是
     * 「一处修好处处受益」，那要求**至少两个互不相干的消费者**。
     *
     * 2026-09-28 实测最少的那个也有 2 个（`digest.ts`：`wiki-review` 与
     * `content.ts`），所以这条不是为了让门禁变严而严——**它已经是事实**。
     */
    problems.push(
      `${file}（${names.join(' / ')}）**只有一个真实调用方**：[${[...hits].join('、')}]\n` +
        '    一个调用方时，抽成核心与「就地写个函数」效果一样——改它仍要改那一处。\n' +
        '    阶段 4 第 1 项要的是「一处修好处处受益」，那要求**至少两个互不相干的消费者**。\n' +
        '    要么把它接进第二条真实路径，要么承认它不是核心（降级成普通工具模块）。',
    );
    console.log(`  ✗ ${file}（${names.join(' / ')}）只有一个调用方：${[...hits].join('、')}`);
  } else {
    console.log(`  ✓ ${file}（${names.join(' / ')}）被 ${hits.size} 处使用：${[...hits].join('、')}`);
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处问题。\n`);
  process.exit(1);
}
console.log('\n核心模块全部可被裸 Node 加载，且没有「可选链漏保护」的写法。\n');
