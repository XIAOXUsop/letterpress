#!/usr/bin/env node
/**
 * **2026-09-28 新增的七道门禁的负向验证。**
 *
 * ── 为什么单独一个文件 ──────────────────────────────────────────────
 *
 * 那七道是 `check:two-paths` / `check:field-coverage` / `check:single-literal` /
 * `check:adapter-size` / `check:not-a-demo` / `check:no-duplicate-lists` / `check:onboarding-doc`。
 * 加上它们时我**手工**验过每一条会红——但**手工验过一次不等于一直成立**：
 * 语料一扩、判据一改，遮住关系就变了。
 *
 * > 这个仓库已经吃过好几次同族亏：五道检索闸「每道有专属用例」这句话
 * > 曾经是假的（`verify:retrieval-gates` 揭穿了它）。
 *
 * 所以把当天的手工验证固化成脚本，**它每次 CI 都跑**。
 *
 * ── 判据 ────────────────────────────────────────────────────────────
 *
 * 每条变异都必须让**被测的那一道**红（不是别的），然后恢复。
 * ⚠️ **红在别的检查上不算数**——那是形态七（「有人替我把关，
 * 只是不在我盯着的那条断言里」）。
 *
 * 用法：`npm run verify:new-gates-mutations`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const problems = [];

console.log('2026-09-28 新增门禁的负向验证');
console.log('─'.repeat(64));

/** 跑一个门禁，返回它红没红。 */
const red = (script) => {
  const r = spawnSync('node', [join('scripts', script)], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { red: r.status !== 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

/**
 * 一次变异：`{ file, find, replace, target, why }`
 *
 * ⚠️ `find` 必须在文件里**唯一存在**，否则替换可能命中别处而门禁不红——
 * 那会让我以为「变异没生效」而实际是打错了位置。所以先断言唯一。
 */
function mutate({ file, find, replace, target, why }) {
  const path = join(ROOT, file);
  const original = readFileSync(path, 'utf8');
  const hits = original.split(find).length - 1;
  if (hits !== 1) {
    problems.push(
      `变异「${why}」的锚点在 ${file} 里出现 ${hits} 次（期望恰好 1 次）——\n`
      + '    **锚点不对就没注入成功**，而「门禁没红」会被我读成「它没有盲区」。\n'
      + '    改锚点，或用文件与行号定位。',
    );
    console.log(`  ✗ ${why}：锚点出现 ${hits} 次，变异未生效`);
    return false;
  }
  writeFileSync(path, original.replace(find, replace), 'utf8');
  /*
   * ⚠️ **替换可能静默不发生。**
   *
   * 2026-09-28 一次：锚点写在一个**不存在**的 `export interface ReadPage` 上，
   * 而 `String.replace` 找不到就原样返回——文件**根本没变**，
   * 于是 `before.red` 是 false，本该被读成「门禁有盲区」。
   * 真相是「变异压根没注入」。
   *
   * > **「绿」既可能是「它没看见」，也可能是「压根没被喂进去」——
   * > 而这两种的输出完全一样。** 所以每次注入都必须先自证注入成功。
   */
  if (readFileSync(path, 'utf8') === original) {
    problems.push(
      `变异「${why}」的替换**没有生效**——写回去的内容与原文逐字相同。\n`
      + '    → 「门禁仍然绿」在这种情形下**不能读成「它有盲区」**，它只是压根没被注入。',
    );
    console.log(`  ✗ ${why}：替换没生效，注入无效（结论不可用）`);
    return false;
  }
  const before = red(target);
  writeFileSync(path, original, 'utf8');
  const after = red(target);

  if (!before.red) {
    problems.push(
      `${target} 在注入「${why}」之后**仍然绿**——这道门禁对该缺陷没有覆盖。\n`
      + '    → 它要么不该声称覆盖，要么判据比它说的窄。',
    );
    console.log(`  ✗ ${why}：${target} 仍绿`);
    return false;
  }
  if (after.red) {
    problems.push(
      `恢复之后 ${target} **仍然是红的**——文件没还原干净。\n`
      + '    **「本轮结论不作数」**：后面每一条的结果都建立在被污染的源码上。',
    );
    console.log(`  ✗ ${why}：恢复后仍红（文件没还原干净）`);
    return false;
  }
  console.log(`  ✓ ${why} → ${target} 变红，恢复后回绿`);
  return true;
}

// ── 每条变异必须是「真的分叉」，不是「值相同」 ───────────────────────
//
// 2026-09-28 实测过一次教训：变异写成 `page.summary + ""` ——
// JSON.stringify 之后两边一样，门禁照样绿，**而我差点读成「判据没盲区」**。
// 那是形态「变异本身无效」。

const GATES = [
  'check-two-paths.mjs', 'check-field-coverage.mjs', 'check-single-literal.mjs',
  'check-adapter-size.mjs', 'check-not-a-demo.mjs', 'check-no-duplicate-lists.mjs',
  'check-onboarding-doc.mjs',
];

const CASES = [
  {
    // ⚠️ **变异的是文档，不是源码。**
    // `check:onboarding-doc` 声称核的是「文档里的实测数字与现在跑出来的一致」，
    // 而它**没被任何东西证明过会红**——2026-09-28 实测之前它守得住，
    // 但「这一次守住了」不等于「它一直在守」。
    why: 'check:onboarding-doc — 文档表里的断链数被改（3 → 7）',
    file: 'docs/onboarding-a-new-site.md',
    find: '| **只读 `wiki`** | 6 | **3** | 4 条 | **`true`** |',
    replace: '| **只读 `wiki`** | 6 | **7** | 4 条 | **`true`** |',
    target: 'check-onboarding-doc.mjs',
  },
  {
    why: 'check:onboarding-doc — 文档表里的 lint 条数被改（10 → 13）',
    file: 'docs/onboarding-a-new-site.md',
    find: "| `''`（不传） | **10** |",
    replace: "| `''`（不传） | **13** |",
    target: 'check-onboarding-doc.mjs',
  },
  {
    // ⚠️ 这一条守着「白名单改成按位置排除」那个改动本身。
    // 原来只核 `docs/cli.md` 与 `README.md`，于是这份文档里的两处幽灵命令
    // （真名是 `verify:portability`，写的是 `check:portability`）躲过了检查。
    why: 'check:onboarding-doc — 正文里出现一个不存在的命令（不只核那两份文档）',
    file: 'docs/onboarding-a-new-site.md',
    find: 'npm run verify:portability',
    replace: 'npm run verify:portability-typo',
    target: 'check-onboarding-doc.mjs',
  },
  {
    why: 'check:two-paths — post 侧不再丢 declaredRelations',
    file: 'src/lib/wiki/page-to-doc.ts',
    find: "declaredRelations: isWiki ? options.relations ?? page.related : [],",
    replace: 'declaredRelations: options.relations ?? page.related,',
    target: 'check-two-paths.mjs',
  },
  {
    why: 'check:two-paths — post 侧不再丢 wikiKind',
    file: 'src/lib/wiki/page-to-doc.ts',
    find: "...(isWiki ? { wikiKind: page.kind } : {}),",
    replace: '...({ wikiKind: page.kind }),',
    target: 'check-two-paths.mjs',
  },
  {
    why: 'check:two-paths — 读路径不再读 draft（草稿会进图）',
    file: 'src/lib/wiki/read-page.ts',
    // 用正则：那一行含 `$` 与 `|`，用字符串 find 会与「锚点唯一」判定打架
    find: 'draft: /^(true|yes|on)$/i.test',
    replace: 'draft: false, _mut_(',
    target: 'check-two-paths.mjs',
  },
  {
    why: 'check:field-coverage — sources 块解析失效',
    file: 'src/lib/wiki/read-page.ts',
    find: 'sources: refs,',
    replace: 'sources: [],',
    target: 'check-field-coverage.mjs',
  },
  {
    why: 'check:field-coverage — tags 不再剥方括号',
    file: 'src/lib/wiki/read-page.ts',
    find: "    tags: relationList(source, 'tags'),",
    replace: "    tags: (frontmatterField(source, 'tags') ?? '').split(',').map((x) => x.trim()).filter(Boolean),",
    target: 'check-field-coverage.mjs',
  },
  {
    why: 'check:single-literal — 文档根清单在别处又写一份',
    file: 'scripts/check-adapter-size.mjs',
    find: "const ROOT = process.cwd();",
    replace: "const ROOT = process.cwd();\nconst DOC_ROOTS_COPY = ['README.md', 'AGENTS.md', 'docs', 'src/content'];",
    target: 'check-single-literal.mjs',
  },
  {
    why: 'check:not-a-demo — relationField 失效（适配层没起作用，两边就不分叉）',
    file: 'src/lib/wiki/read-page.ts',
    find: '        ...(relationField ? { related: relationList(source!, relationField) } : {}),',
    replace: '        // MUTATION：relationField 不生效',
    target: 'check-not-a-demo.mjs',
  },
  {
    why: 'check:not-a-demo — 语料让两边都从正文拿关系（异构点被正文遮住）',
    file: 'scripts/check-not-a-demo.mjs',
    find: "    '正文提到关系，但**不写** `[[乙]]`——那正是 frontmatter 声明的用处。',",
    replace: "    '见 [[乙]]。',",
    target: 'check-not-a-demo.mjs',
  },
  {
    why: 'check:no-duplicate-lists — 同一个文件里把清单抄了第二份',
    file: 'scripts/check-not-a-demo.mjs',
    find: "const MUST_MATCH = ['slugs', 'broken', 'hasErrors', 'topHit']",
    replace: "const MUST_MATCH = ['slugs', 'broken', 'hasErrors', 'topHit'];\nconst MUST_MATCH_COPY = ['slugs', 'broken', 'hasErrors', 'topHit'];",
    target: 'check-no-duplicate-lists.mjs',
  },
  {
    // ⚠️ 锚点是 `const ROOT_DIRS = SOURCE_DIRS;` 而不是字面量——
    // 收敛掉跨文件重复之后它就变了，而**锚点失效会被「锚点出现 0 次」当场抓住**
    // （那正是 2026-09-28 刚加的那道自检救下来的：不是「门禁有盲区」，
    // 是「变异压根没注入」）。
    why: 'check:no-duplicate-lists — 把扫描根收窄（覆盖面变小却照样绿）',
    file: 'scripts/check-no-duplicate-lists.mjs',
    find: 'const ROOT_DIRS = SOURCE_DIRS;',
    replace: "const ROOT_DIRS = ['src'];",
    target: 'check-no-duplicate-lists.mjs',
  },
  {
    why: 'check:adapter-size — 一行手工 Doc（行数不变，但是核心的完整复制）',
    file: 'scripts/check-second-site-real.mjs',
    find: 'const docs = pages.map((page) => pageToDoc(page));',
    replace: 'const docs = pages.map((page) => ({ kind: "wiki", slug: page.slug, title: page.title, summary: page.summary ?? "", body: page.body, sources: page.sources, declaredRelations: page.related, explicitSlug: page.explicitSlug, draft: page.draft, wikiKind: page.kind }));',
    target: 'check-adapter-size.mjs',
  },
  {
    why: 'check:adapter-size — 映射层多写一行手写接线',
    file: 'scripts/check-second-site-real.mjs',
    find: 'const docs = pages.map((page) => pageToDoc(page));',
    replace: 'const docs = pages.map((page) => pageToDoc(page));\nconst extra = pages.filter((p) => p.title.length > 0);',
    target: 'check-adapter-size.mjs',
  },
  {
    why: 'check:adapter-size — 映射层不再调用核心',
    file: 'scripts/check-second-site-real.mjs',
    find: "const { pages } = readContentDirs([DIR], { relationField: 'audience' });",
    replace: 'const pages = [];',
    target: 'check-adapter-size.mjs',
  },
];

// 先确认全部干净（干净状态下不该有任何一条红）
//
// ⚠️ **用 `GATES` 遍历，不要再写一份字面量**——2026-09-28 加第 5 道门禁时
// 忘了同步这里，于是「干净态检查」漏掉一道（而它仍是绿的，看起来没事）。
// **清单写两遍 = 迟早漏一处**，同形态今天已犯四次。
for (const t of GATES) {
  const r = red(t);
  if (r.red) {
    problems.push(`干净状态下 ${t} 就是红的——先修那个，本轮验证没有意义`);
    console.log(`  ✗ 干净状态下 ${t} 已红`);
  }
}
if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`  ✓ 干净状态下 ${GATES.length} 道门禁全绿\n`);

let ok = 0;
for (const c of CASES) if (mutate(c)) ok++;
console.log(`\n${ok}/${CASES.length} 条变异都被抓住。`);

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log(`${GATES.length} 道新门禁的负向验证全部成立。\n`);
