#!/usr/bin/env node
/**
 * **2026-09-28 新增的十二道门禁的负向验证。**
 *
 * ── 为什么单独一个文件 ──────────────────────────────────────────────
 *
 * 那十道是 `check:two-paths` / `check:field-coverage` / `check:single-literal` /
 * `check:adapter-size` / `check:not-a-demo` / `check:no-duplicate-lists` /
 * `check:onboarding-doc` / `check:command-scripts` / `check:gate-list` / `check:single-source`。
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
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const problems = [];

console.log('2026-09-28 新增门禁的负向验证');
console.log('─'.repeat(64));

/*
 * ⚠️ **2026-09-28 第二次：「单跑这条门禁」不等于「门禁在编排里跑」。**
 *
 * `verify` 走 `bundle-and-verify.mjs`：esbuild 把脚本打成
 * `node_modules/.cache/letterpress/verify.mjs` 再执行。
 * 我给 `verify-negotiation.mjs` 里的新判据用了 `import.meta.url` 定位 docs，
 * **单跑是绿的、打包后 ENOENT**——而 `verify:all` 跑的正是打包那条路。
 *
 * > **手敲的命令不是 CI 里的那条**（[[local_simulation_missing_semantics]]）。
 * > 而这类缺陷**只会在编排里发作**，所以
 * > **变异脚本必须按编排的方式跑被测门禁**，不能一律 `node scripts/x.mjs`。
 *
 * 所以 `red()` 对这几个命令改用 `npm run <name>`，与编排同一条路。
 * 目前只有 `verify` 需要这样跑——它是唯一走打包的。
 *
 * ⚠️ **这个 `Set` 必须定义在 `red()` 之前**：`const` 有暂时性死区，
 * 反过来写会 ReferenceError——而**那正是「注释里写了、代码没实现」的形状**。
 */
// ⚠️ **Windows 上是 npm.cmd，不是 npm**——而加 shell:true 会引入 DEP0190 警告，
// 那正是 docs/cli.md 里记着要消除的一条。**别为了跑通一个门禁引入新警告。**
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const BUNDLED = new Set(['verify']);

/**
 * 有些门禁打在**构建产物**上，而 `dist` 的状态**由前面跑过什么决定**：
 * `verify:base` 会清空它、`verify:formats` 会往里塞探针文章。
 *
 * ⚠️ **2026-09-28 实测踩到第三种。** 变异脚本跑 `verify-negotiation.mjs` 时
 * 它报「`markdown-for-agents.md` 存在于产物中」——而那个文件**当下并不存在**
 * （`ls` 得到的是「不存在」）。也就是说：**上一次门禁留下的 `dist` 与这一次不同**，
 * 而我起初猜的是「`dist` 被清空」。**三种可能，输出上分不开。**
 *
 * 所以：**跑依赖产物的门禁之前，先确保 `dist` 存在。**
 * ⚠️ 判据是 `content-manifest.json` 在不在，**不是目录在不在**——
 * 空目录同样「存在」，而那正是 `check:manifest-schema` 当初栽的地方。
 */
const NEEDS_DIST = new Set(['verify-negotiation.mjs']);

/**
 * ⚠️ **判据不能只是「`dist` 在不在」。**（2026-09-28 第二次栽在这里）
 *
 * 第一版只查 `content-manifest.json` 存在与否——那挡住了「没有产物」，
 * **挡不住「产物在、但是上一次门禁留下的旧的那份」**。
 * 于是 `verify-negotiation` 报「`markdown-for-agents.md` 存在于产物中」，
 * 而那个文件当下并不存在——**它在 `dist` 里，却不在清单里**。
 *
 * > **「产物在」与「产物对得上现在的源码」是两件事**，
 * > 而第一版把前者当成了后者的充分条件。
 *
 * 所以：**产物在，但它与 `content-manifest.json` 对不上时也要重建。**
 * 判据是「清单里点名的每个 `.md` 是否真的在 `dist` 里」——
 * 那正是 `check:base` 里那句「产物里每个站内链接都要指向存在的文件」的弱化版，
 * **够便宜，且能抓住「旧产物」**。
 */
function distLooksConsistent() {
  const manifest = join(ROOT, 'dist', 'content-manifest.json');
  if (!existsSync(manifest)) return false;
  try {
    const m = JSON.parse(readFileSync(manifest, 'utf8'));
    for (const d of m.documents ?? []) {
      const url = d.urls?.markdown;
      if (!url) continue;
      const rel = url.replace(/^https?:\/\/[^/]+\/[^/]+\//, '');
      if (!existsSync(join(ROOT, 'dist', rel))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function ensureDist() {
  if (distLooksConsistent()) return;
  const r = spawnSync(NPM, ['run', 'build'], {
    cwd: ROOT, encoding: 'utf8', timeout: 600_000,
  });
  if (r.status !== 0) {
    console.log('  ⚠ build 失败，下面依赖产物的门禁结果不可信（那不是变异造成的）');
  }
}

/**
 * 跑一个门禁，返回它红没红。
 *
 * ⚠️ **`verify` 必须按编排的方式跑**（`npm run verify` → esbuild 打包 → 执行），
 * 单跑 `node scripts/bundle-and-verify.mjs` 走的是另一条路——
 * 2026-09-28 实测：一条新判据单跑绿、打包后 ENOENT。
 * 而 `verify:all` 里的第 4 步跑的是打包那条。
 */
const red = (script) => {
  if (NEEDS_DIST.has(script)) ensureDist();
  if (BUNDLED.has(script.replace(/\.mjs$/, ''))) {
    const r = spawnSync(NPM, ['run', 'verify'], {
      cwd: ROOT, encoding: 'utf8', timeout: 600_000,
    });
    return { red: r.status !== 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  }
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
function mutate({ file, find, replace, alsoEdit, target, why }) {
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
  /*
   * ⚠️ **有些缺陷需要两处同时改才会发作**（2026-09-28）。
   *
   * 例：「有一条无理由的刻意不校验登记」+「守卫被拆掉」——
   * 只做前者报红是**守卫正常工作**，只做后者门禁走不到那条分支。
   * 两件一起做才是那个失效状态。
   *
   * 所以 `alsoEdit` 是**一等公民**，而不是「顺手再改一处」——
   * 因为「顺手的第二处」忘了做，那条变异就悄悄验的是别的东西。
   */
  let injected = original.replace(find, replace);
  if (alsoEdit) {
    const ah = injected.split(alsoEdit.find).length - 1;
    if (ah !== 1) {
      problems.push(
        `变异「${why}」的第二处锚点出现 ${ah} 次（期望 1 次）——**注入不完整**。\n`
        + '    这种情形下「门禁没红」是**变异无效**，不是「判据没盲区」。',
      );
      console.log(`  ✗ ${why}：第二处锚点出现 ${ah} 次，变异未生效`);
      return false;
    }
    injected = injected.replace(alsoEdit.find, alsoEdit.replace);
  }
  writeFileSync(path, injected, 'utf8');
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
    /*
     * ⚠️ **2026-09-28：这里原来只打一行「仍然绿」。**
     *
     * 而「仍然绿」是一个**现象**，不是一个**诊断**。
     * 那天我因为不看输出，**连着三次改错地方**：以为是 `else` 分支、
     * 以为是控制流有两个出口、以为是分支解耦不够——三次都错。
     * 第一次真正去看输出时，门禁明明白白印着
     * `i 刻意不校验：…——undefined`——**答案就印在脸上**。
     *
     * > **现象级信息（它打印了什么）与结论级信息（哪一行错了）之间，
     * > 隔着一个「去看输出」的动作。** 跳过它就只能推演。
     * > 而推演错的概率不低——**同一天连错三次就是证据**。
     *
     * 所以：报「仍绿」时**必须**把被测门禁的输出尾部打出来。
     * 「它没报什么」和「它报了什么」必须能在同一屏上看见——
     * 因为**空输出与无关输出长得一样**，而那正是我判断错的入口。
     */
    const tail = before.out
      .split('\n')
      .filter((l) => l.trim() !== '')
      .slice(-6)
      .map((l) => `      ${l}`)
      .join('\n');
    problems.push(
      `${target} 在注入「${why}」之后**仍然绿**——这道门禁对该缺陷没有覆盖。\n`
      + '    → 它要么不该声称覆盖，要么判据比它说的窄。\n'
      + '    ⚠️ **先读它下面这几行再改代码**：「仍然绿」是现象，不是诊断；\n'
      + '    2026-09-28 我因为不看输出连改三次，三次都改错了地方。\n'
      + (tail ? `    它实际打印的（末尾）：\n${tail}\n` : '    它实际打印的（末尾）：**（空）**——查不动与「什么都没说」要分开。\n'),
    );
    console.log(`  ✗ ${why}：${target} 仍绿`);
    if (tail) console.log(tail);
    else console.log('      （输出为空——「空输出」与「无关输出」长得一样，要分开看）');
    return false;
  }
  if (after.red) {
    /*
     * ⚠️ **「恢复后仍红」有两种可能，输出上分不开。**（2026-09-28 实测）
     *
     * ① 文件没还原干净（真的还原失败）
     * ② **文件还原了，但环境被别的步骤改了**——那次就是
     *    `verify:base` 跑完清空了 `dist`（`docs/cli.md` 里写明它会），
     *    于是后面任何依赖产物的门禁在 `after` 那次必然红，
     *    **而与本次变异毫无关系**。
     *
     * > 「它仍然红」不等于「是我的错」——**先确认环境，再下结论**。
     * > 判据：把 `after` 的输出里**第一条错误**打出来，
     * > 让「ENOENT dist」与「某条断言不符」能被分开看。
     */
    const firstErr = (after.out.split('\n').find((l) => /Error|✗|失败/.test(l)) ?? '').trim();
    problems.push(
      `恢复之后 ${target} **仍然是红的**。\n`
      + `    它报的第一条：${firstErr || '(没抓到)'}\n`
      + '    **「仍然红」有三种可能，输出上分不开**——\n'
      + '      ① 文件没还原干净；\n'
      + '      ② **环境被前面的步骤改了**（`verify:base` 会清空 `dist`，'
      + '`verify:formats` 会往里塞探针文章）；\n'
      + '      ③ **上一次跑留下的产物与这一次不一致**——'
      + '**2026-09-28 实测到的就是这一种**，而我起初猜的是 ②。\n'
      + '    → **先看它报的第一条**，再决定是重跑 `npm run build`、'
      + '还是 `git status` 查还原。**别默认是自己弄脏的。**',
    );
    console.log(`  ✗ ${why}：恢复后仍红（先分清是环境还是还原——它报的第一条：${firstErr.slice(0, 90)}）`);
    return false;
  }
  console.log(`  ✓ ${why} → ${target} 变红，恢复后回绿`);
  return true;
}


const GATES = [
  'check-two-paths.mjs', 'check-field-coverage.mjs', 'check-single-literal.mjs',
  'check-adapter-size.mjs', 'check-not-a-demo.mjs', 'check-no-duplicate-lists.mjs',
  'check-onboarding-doc.mjs', 'check-command-scripts.mjs', 'check-gate-list.mjs',
  'check-single-source.mjs', 'check-agents-doc.mjs', 'check-rule-levels.mjs',
];

const CASES = [
  {
    // ⚠️ 守着 2026-09-28 新增的第五类判据：AGENTS.md 那张规则表的**级别**列。
    // 而「`broken-wikilink` 是 error（会让构建失败）」正是 agent 最会照着用的
    // 那一列——AGENTS.md 开头就写着「那是给 agent 读的约定」。
    // 级别只能**真跑**出来：静态分析（往上找 N 行找 `level:`）只捞到 1/11 条。
    why: 'check:rule-levels — 文档把 error 写成 warn（agent 会照着它判断什么会让构建失败）',
    file: 'AGENTS.md',
    find: '| 错误 | `broken-wikilink` | 引用了不存在的页面。**会让构建失败** |',
    replace: '| 警告 | `broken-wikilink` | 引用了不存在的页面。**会让构建失败** |',
    target: 'check-rule-levels.mjs',
  },
  {
    // ⚠️ 守着「语料没触发到的规则必须报」那条。删掉「断链」那篇之后，
    // `related: [断链]` 跟着失效 → `redundant-relation` 不再触发，
    // **而它的级别此刻没被核**。「没触发」与「都对」在结果上无法区分。
    why: 'check:rule-levels — 语料缺一段，某个级别根本没被核对（没触发 ≠ 都对）',
    file: 'scripts/check-rule-levels.mjs',
    find: "  writeFileSync(join(dir, '断链.md'), page('断链', '断链', '', '见 [[根本不存在的目标]]。'), 'utf8');",
    replace: '',
    target: 'check-rule-levels.mjs',
  },
  {
    // ⚠️ 这两条守着 2026-09-28 补的判据：AGENTS.md 那张「分三级」的规则表
    // 必须与 lint.ts 的规则集**完全相同**。
    // 此前那三类判据全是「**文档里这一句**还成立吗」，于是**没有一条问
    // 「文档该说的都说了吗」**——而**缺的项永远不会触发「这一句还对吗」**。
    // 实测的缺口：ambiguous-wikilink（**error** 级）与 ambiguous-title
    // 不在任何面向人的文档里，而 agent 正是照这张表判断什么会让构建失败。
    why: 'check:agents-doc — 规则表里漏掉一条（代码里有、表里没有）',
    file: 'AGENTS.md',
    find: '| 错误 | `ambiguous-wikilink` | 引用了一个**有歧义的标题**（两篇同名），无法确定指哪一篇 |\n',
    replace: '',
    target: 'check-agents-doc.mjs',
  },
  {
    why: 'check:agents-doc — 规则表里多一条不存在的（表里有、代码里没有）',
    file: 'AGENTS.md',
    find: '| 提示 | `summary-too-long` |',
    replace: '| 错误 | `nonexistent-rule` | 表里写了但代码里没有 |\n| 提示 | `summary-too-long` |',
    target: 'check-agents-doc.mjs',
  },
  {
    // ⚠️ 守着 2026-09-28 补的那条判据：`docs/content-negotiation.md` 的 MD 列
    // 与实测一致。原先 `verify-negotiation.mjs` 的注释写着
    // 「真实词表那组由 docs 里的表负责」——**而 docs 那侧零门禁**：
    // 注释说「X 负责」而 X 那边没有检查，等于没有人负责。
    why: 'verify:negotiation — docs 表格的 MD token 列被改',
    file: 'docs/content-negotiation.md',
    find: '2,852 / 2,965（−3.8%）',
    replace: '2,999 / 2,965（−3.8%）',
    target: 'verify-negotiation.mjs',
  },
  {
    // ⚠️ 「取不到」与「都对」在结果上无法区分——删掉一行必须报，
    // 而**不能**默认通过（形态四）。
    why: 'verify:negotiation — docs 表格里删掉一行（取不到 ≠ 都对）',
    file: 'docs/content-negotiation.md',
    find: '> | /cjk-web-typography/ | 8,732 / 10,095（−13.5%） | 3,919 / 4,246（−7.7%） | 55.1% / **57.9%** |',
    replace: '',
    target: 'verify-negotiation.mjs',
  },
  {
    // ⚠️ 这两条就是 2026-09-24 那个**真 bug** 的两半：
    // 提交把生产端升到 v2，同步器与测试固件都停在 1，
    // 于是同步器对着本站自己的清单必然报错，而 453 条测试全绿
    // ——因为固件也写着 1，它测的是一个已不存在的格式。
    why: 'check:single-source — 同步器把版本号写死（真故障的前一半）',
    file: 'scripts/lib/content-sync.mjs',
    find: 'const MANIFEST_VERSION = readManifestVersion()',
    replace: 'const MANIFEST_VERSION = 1',
    target: 'check-single-source.mjs',
  },
  {
    why: 'check:single-source — 测试固件把 manifest 的 version 写死（真故障的后一半，测试全绿却功能是坏的）',
    file: 'scripts/lib/content-sync.test.mjs',
    find: '    version: MANIFEST_VERSION,',
    replace: '    version: 1,',
    target: 'check-single-source.mjs',
  },
  {
    // ⚠️ 文档判据原来**空转了整整一年**：六份文档里一处「版本为 N」都没有，
    // 而它每天在 CI 里跑、每天打印一行诚实的提示，没人行动。
    // 2026-09-28 把「扫到 0 处」升级为红，并在文档里补上那句本来就该有的声明。
    why: 'check:single-source — 文档里的版本声明被改（2 → 1）',
    file: 'docs/content-manifest.md',
    find: '**当前版本为 2**',
    replace: '**当前版本为 1**',
    target: 'check-single-source.mjs',
  },
  {
    why: 'check:single-source — 清单里的文档不存在（静默跳过 = 核不到，形状同「按文件豁免通病」）',
    file: 'scripts/check-single-source.mjs',
    find: "  'docs/content-export.md',",
    replace: "  'docs/content-export-renamed.md',",
    target: 'check-single-source.mjs',
  },
  {
    // ⚠️ 这一条守着 2026-09-28 修的那处盲区：「第 999 步」格式合法、
    // 指向一个不存在的步骤，而旧判据只认格式、不核数字。
    // 讽刺的是它就出在 `verify:only` 那条豁免当初真的翻车的地方。
    why: 'check:gate-list — 豁免理由里塞一个「第 999 步」（格式合法、指向不存在）',
    file: 'scripts/check-gate-list.mjs',
    find: "['wiki:ask', '交互式问答：输入是自然语言问题，没有固定输入就没法当门禁。'",
    replace: "['wiki:ask', '交互式问答：输入是自然语言问题，没有固定输入就没法当门禁，见 verify:all 的第 999 步。'",
    target: 'check-gate-list.mjs',
  },
  {
    why: 'check:gate-list — 豁免理由引用的文件不存在（理由本身是空的）',
    file: 'scripts/check-gate-list.mjs',
    find: 'scripts/bundle-and-verify.mjs',
    replace: 'scripts/does-not-exist.mjs',
    target: 'check-gate-list.mjs',
  },
  {
    why: 'check:gate-list — 豁免理由变成散文（没有可验证的引用）',
    file: 'scripts/check-gate-list.mjs',
    find: "['measure', '量产物给**人**看（`scripts/measure.mjs`），判定由 `npm run verify:formats` 里对应的门禁做'],",
    replace: "['measure', '量产物给人看，判定在别处。'],",
    target: 'check-gate-list.mjs',
  },
  {
    // ⚠️ 主判据：分叉没登记。
    // 少了这一条，「加一个命令名与脚本名不同的脚本」什么都不会报——
    // 而那张册子的全部价值就是「照着它一定找得到脚本」。
    why: 'check:command-scripts — 加一个未登记的分叉命令',
    file: 'package.json',
    find: '"check:staged": "node scripts/check-staged.mjs",',
    replace: '"check:staged": "node scripts/check-staged.mjs",\n    "check:brand-new-thing": "node scripts/some-other-name.mjs",',
    target: 'check-command-scripts.mjs',
  },
  {
    why: 'check:command-scripts — 册子登记的脚本被改名（两份事实分叉）',
    file: 'package.json',
    find: 'node scripts/check-gate-list.mjs',
    replace: 'node scripts/renamed-gate-check.mjs',
    target: 'check-command-scripts.mjs',
  },
  {
    // ⚠️ 这条断言有**两层守卫**：「逐字一致」会先挡住「脚本被改名」，
    // 所以要单独触发它，必须登记一条**本不该登记的**（对得上的名字）。
    // 我一度以为它是死代码——推演之后发现可达，实测确实红了。
    why: 'check:command-scripts — 册子里有一条「本不该登记的」（已不再分叉）',
    file: 'scripts/lib/command-scripts.mjs',
    find: "  ['verify:only', 'scripts/bundle-and-verify.mjs',",
    replace: "  ['check:staged', 'scripts/check-staged.mjs', '误登记：这条其实对得上'],\n  ['verify:only', 'scripts/bundle-and-verify.mjs',",
    target: 'check-command-scripts.mjs',
  },
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
    // ⚠️ 这一条守着「文件清单从手写改成从文件系统推导」那个改动。
    // 原来是手写三份，而 docs/ 下有 8 份——实测那 4 份漏掉的文档里
    // 13 处 `npm run` 当时全是对的，所以**漏了也不会立刻暴露**：
    // 幽灵命令要等到有人照着敲才现形，那可能是几个月后。
    why: 'check:onboarding-doc — 从文件系统推导后才纳入的 docs/deploy.md 里出现幽灵命令',
    file: 'docs/deploy.md',
    find: '| **GitHub Pages（项目站）** | `SITE_BASE=/仓库名 npm run build` |',
    replace: '| **GitHub Pages（项目站）** | `SITE_BASE=/仓库名 npm run buildx` |',
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
    // ⚠️ 守着「静默跳过 → 必须显式写明理由」那个改动。
    // 原来 `if (!item.where) continue;`——加一条**故意不校验**的登记
    // 在输出上完全看不出来，而那正是「按文件豁免通病」的形状：
    // **豁免的正是检查本身**。今天第三次撞上同一个病。
    //
    // ⚠️ **2026-09-28 修了四轮才防住，而四轮都栽在同一句话上：
    // 「结构上只有一个出口，所以拆不掉」。**
    //
    // ① `if (!item.where) continue;` 完全静默
    // ② 加守卫 → 守卫与 else 是两个出口，拆守卫 → `skip: undefined` 被放行
    // ③ 合成 if/else → 拆 if → 后面两行无条件执行
    // ④ 「失败条件与控制流解耦」→ **也错了**：`problems.push` 就在那个 if 的
    //    **body 里**，拆掉 if 等于**拆掉记账本身**。
    //
    // 现在的结构是**先算结论、再按结论打印**：`unexplained` 这个**数据**
    // 在分支里被填充，而 `problems` 的填充只看这个数据。
    // 于是拆掉那个 if 也只是让「该报」落进 `deliberatelySkipped`——
    // **而 problems 仍非空** → 仍红。
    //
    // 这条变异拆的就是那个记账分支：**它必须仍然红**。
    why: 'check:single-literal — 有一条无理由的「刻意不校验」登记，且记账分支被拆掉',
    file: 'scripts/check-single-literal.mjs',
    find: "    if (typeof item.skip !== 'string' || item.skip.trim() === '') {",
    replace: "    if (false) { // MUTATION：记账分支被拆掉",
    target: 'check-single-literal.mjs',
    // 额外注入：加一条无理由的登记
    alsoEdit: {
      find: 'const SHARED_LITERALS = [',
      replace: "const SHARED_LITERALS = [\n  { what: '无理由的刻意不校验' },",
    },
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
