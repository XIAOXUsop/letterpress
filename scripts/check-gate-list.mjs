#!/usr/bin/env node
/**
 * 编排门禁：`verify:all` 里声明的每一步，都必须真实存在且可执行。
 *
 * ── 它要解决什么 ────────────────────────────────────────────────────
 *
 * 2026-09-24 实测的缺口：**没有任何东西检查「`verify:all` 的 13 步都跑了」**。
 * 删掉一步，它照样绿——而那一步可能是 `verify:questions` 或
 * `verify:formats` 这种**唯一**在守某类缺陷的门禁。
 *
 * > **编排是最容易出事的地方**：13 个 `&&` 串起来，
 * > 少一个不会有任何报错——`npm run` 只看最后一个的退出码。
 *
 * 这条检查量的事比三件多（4a 到 4g 各是一条）：步骤数量与顺序、
 * 每一步的脚本存在、每条豁免的理由是否还成立、门禁的负向验证覆盖、
 * 台账的可复现性与其中会漂的数字、扫源码的门禁有没有排除变异脚本。
 *
 * ⚠️ **它量的是「声明的完整性」，不是「有效性」**——
 * 一门禁存在且被编排，**不代表它有效**。那件事记在
 * `knowledge/gate-negatives.md`（负向验证记录）里，两者缺一不可。
 *
 * 用法：`node scripts/check-gate-list.mjs`
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkCiWiring } from './ci-wiring.mjs';

const ROOT = process.cwd();
const problems = [];

/*
 * 台账全文——**4d / 4e / 4g 三处都要读**，所以定义在**文件级**。
 *
 * ⚠️ **第一版把它定义在 4e 那个 `{ }` 块里**，而 4g 在另一个块里
 * 引用不到 → `ReferenceError: ledgerText is not defined`。
 * **症状是崩，不是假绿**（`const` 不会「取到旧值」，只会抛）——
 * 同一个坑 2026-09-28 在 `check-rule-levels` 的自测里踩过一次。
 */
const ledgerText = readFileSync(join(ROOT, 'knowledge', 'gate-negatives.md'), 'utf8');

/** 跑一个脚本，返回它的输出（4g 重算实测值时用）。 */
const run = (script) => execFileSync('node', [join(ROOT, 'scripts', script)], {
  encoding: 'utf8',
});
/** 命令名 → 它指向的脚本文件名（去 `scripts/` 前缀）。查不到返回 `undefined`。 */
const scriptOf = (cmd) => {
  const m = /node (scripts\/[\w.-]+\.mjs)/.exec(scripts[cmd] ?? '');
  return m ? m[1].replace(/^scripts\//, '') : undefined;
};

/**
 * `check-command-scripts` 输出里「N 个命令，N 个与脚本名对不上」那一段。
 *
 * ⚠️ **取不到就返回 `null` 而不是猜**——而 4g 对 `null` 的处置是
 * **报「此刻核不到任何东西」**，不是默默放过。
 * **「查不动 ≠ 通过」**：形态四的变体。
 */
const CMD_SCRIPTS_OUT = () =>
  /(\d+)\s*个命令，(\d+)\s*个与脚本名对不上/.exec(run(scriptOf('check:command-scripts')));

// ── 期望的步骤清单 ────────────────────────────────────────────────────
//
// **这份清单是本检查的核心价值**：它让「少了一步」变成一件可检测的事。
// 增删步骤时**必须同步改这里**，否则门禁会红——那正是它该做的。
const EXPECTED = [
  ['npm run check', '类型与内容检查'],
  ['npm run verify:gates', '**编排自身**（本检查）——它必须排在最前面'],
  ['npm test', '单元测试'],
  ['npm run verify', '端到端契约（打在真实产物上）'],
  ['npm run verify:testcount', '测试条数对账'],
  ['npm run verify:search', '搜索可用性前提'],
  ['npm run verify:questions', '检索金标（23 条，其中 3 条登记为已知局限）'],
  ['npm run verify:retrieval-gates', '**五道检索闸逐一失效，每次金标都变红**（它们曾经被「这道闸有人在量」想当然）'],
  ['npm run verify:impact', '影响分析金标（9 条）'],
  ['npm run verify:answers', '**答案能定位到证据**（阶段 3 退出条件 ③）'],
  ['npm run verify:review', '**wiki:review 说的复核状态与 frontmatter 一致**（它原先全报「未复核」）'],
  ['npm run verify:portability', '核心模块可加载性 + 可选链形状'],
  ['npm run check:site-agnostic', '**站点事实可由调用方覆盖**（阶段 4 第 6 项）'],
  ['npm run verify:site-mutations', '上一道门禁的负向验证（把它依次弄坏四次，每次都必须真红）'],
  ['npm run check:exit-codes', '**CLI 错误码都已归类**（阶段 4 第 3 项）'],
  ['npm run verify:exit-codes', '上一道门禁的负向验证（三种漏法：字面 1、拼错常量名、未登记的数字）'],
  ['npm run verify:json-output', '**`--json` 模式下失败也有结构化输出**（阶段 4 第 3 项剩的一半）'],
  ['npm run verify:json-mutations', '上一道的负向验证（三类违约：stdout 空 / ok 不是 false / code 与退出码打架）'],
  ['npm run verify:migrate', '**v1 → v2 迁移的诊断够不够精确**（5 种坏法，阶段 4 退出条件第二半）'],
  ['npm run verify:new-gates-mutations', '**2026-09-28 新增的那些门禁的负向验证**（56 条变异：每条必须让被测的那道红，恢复后回绿）'],
  ['npm run check:single-source', '**版本号只有一处真值**（同一事实写两遍已经造成过一次真故障）'],
  ['npm run verify:second-site', '第二份异构内容集（合成 docs 数组）'],
  ['npm run verify:second-site-real', '**读自文件的**异构内容集（阶段 4 第 5 项）'],
  ['npm run verify:second-site-real-mutations', '上一道的负向验证（7 种破坏，验「断言测的是契约还是巧合」）'],
  ['npm run verify:anchors', '锚点契约'],
  ['npm run verify:reproducible', '跨时区可复现构建'],
  ['npm run verify:base', '子路径部署'],
  ['npm run check:manifest-schema', '**产物符合 JSON Schema，且三处 version 一致**（自己先 build：不依赖前面步骤的副作用）'],
  ['npm run verify:formats', '内容发布探针 + 产物级断言'],
  ['npm run check:anchors', '**文档里的锚点链接点得到**（slug 规则与 GitHub 一致）'],
  ['npm run check:refs', '**文档里提到的路径都存在**（放最后：verify:formats 会清 dist，本检查要 dist 才判产物）'],
  ['npm run check:agents-doc', '**AGENTS.md 的可证伪声明还成立**（规则名 / 例子 slug / 行为声明）'],
  ['npm run check:onboarding-doc', '**接线文档里的实测数字与现在跑出来的一致**（判据从文档表格里解析数字，不核脚本里的常量）'],
  ['npm run check:two-paths', '**读路径与构建路径对「post 拿不到什么」同一口径**（`related` / `review` / `original` / `wikiKind`）——本站 posts 里 0 篇写这些字段，所以那处分歧从未发作过'],
  ['npm run check:field-coverage', '**读路径读得到构建侧读的那些 frontmatter 字段**——用行为测（造一份写满字段的 frontmatter 读回来），不靠 grep 源码'],
  ['npm run check:single-literal', '**同一份清单不许写两遍**（2026-09-28 一天内找到四处「同一件事两处实现」）'],
  ['npm run check:adapter-size', '**站点专属接线只剩「站点事实」**（阶段 4 第 4 条的代理指标）——行数只能降不能升，且不能靠「不接核心」变小'],
  ['npm run check:not-a-demo', '**「接入」而不是「演示」**：核心的算法行为在两个消费者上逐字相同，而异构点那一项**必须**分叉——两边都空正是演示的典型形态'],
  ['npm run check:no-duplicate-lists', '**同一份清单不许写两遍**（同族第四道：前两次是「同一逻辑两处实现」，这次是「同一字面量两处拷贝」）'],
  ['npm run check:command-scripts', '**命令名与脚本名对不上时必须登记在册**（实测 62 个里 9 个分叉）——照着命令名 grep 脚本会落空'],
  ['npm run check:rule-levels', '**AGENTS.md 那张规则表的第二、三列与实测一致**——级别逐条真跑（静态分析只捞到 1/11 条）；含义列里**能机械核的 5 条**逐条跑，而**核不了的 5 条显式列出**（不写成「11 条都核了」）'],
  ['npm run check:agents-coverage', '**`AGENTS.md` 里每个含可证伪声明的小节都有门禁在核**（13 个小节、7 个含声明、3 个是散文不算缺口）——「匹配到标记却无门禁认领」也红，那是空白归属'],
  ['npm run check:package-files', '**从 tarball 装上后还能构建**（`files` 白名单排掉了必要文件时，构建直接失败——而 `npm pack` 只认 `files` 与 `.npmignore`，不看 `.gitignore`）'],
  ['npm run check:release', '**版本号、git tag、`CHANGELOG` 三者对得上**（发布前那步不能靠记性）——而「HEAD 比 tag 新」只**报事实不报缺陷**，那是发过之后又改了的正常状态'],
  ['npm run check:staged', '**暂存区与工作区一致**（提交前自检：add 过之后又改过的东西不会被提交）'],
];

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const scripts = pkg.scripts ?? {};
const all = scripts['verify:all'] ?? '';
const ciWorkflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');

problems.push(...checkCiWiring(ciWorkflow));
for (const [name, changed] of [
  ['移除 test 分支', ciWorkflow.replace('branches: [main, master, test]', 'branches: [main, master]')],
  ['移除完整门禁 job', ciWorkflow.replace('  full-gates:', '  full-gates-disabled:')],
  ['移除完整门禁命令', ciWorkflow.replace('run: npm run verify:all', 'run: npm run check')],
  // ⚠️ **下面**不要**为「full-gates 需要先 build」加自测**——
  // 那条判据的依据是错的（`verify` 自己会 `clean && build`），
  // 2026-09-28 加过又撤掉了。见 scripts/ci-wiring.mjs 里的记述。
]) {
  if (changed === ciWorkflow || checkCiWiring(changed).length === 0) {
    problems.push(`CI 接线自测失效：${name} 后没有报错`);
  }
}

// ── 1. 步骤数量 ─────────────────────────────────────────────────────
const steps = all
  .split('&&')
  .map((s) => s.trim())
  .filter(Boolean);

console.log('门禁编排检查');
console.log('─'.repeat(64));
console.log(`  verify:all 声明了 ${steps.length} 步，期望 ${EXPECTED.length} 步`);

if (steps.length !== EXPECTED.length) {
  problems.push(
    `verify:all 有 ${steps.length} 步，而期望 ${EXPECTED.length} 步。` +
      `**少一步不会有任何报错**——npm 只看最后一个的退出码。` +
      `多出来的：${steps.filter((s) => !EXPECTED.some(([e]) => e === s)).join('、') || '（无）'}`,
  );
}

// ── 2. 每一步顺序与内容 ─────────────────────────────────────────────
for (const [i, [expected, why]] of EXPECTED.entries()) {
  const actual = steps[i];
  if (actual === expected) continue;
  problems.push(
    `第 ${i + 1} 步是「${actual ?? '（不存在）'}」，期望「${expected}」（${why}）。` +
      `\n    顺序也有意义：check/test 在最前，构建类门禁在后。`,
  );
}

// ── 3. 每一步引用的脚本存在 ─────────────────────────────────────────
for (const step of steps) {
  const m = /^npm run ([\w:-]+)$/.exec(step);
  if (!m) {
    if (step !== 'npm test') {
      problems.push(`步骤「${step}」不是本检查认识的形态（应为 \`npm run <name>\` 或 \`npm test\`）`);
    }
    continue;
  }
  const name = m[1];
  if (typeof scripts[name] !== 'string' || scripts[name].trim() === '') {
    problems.push(`步骤「${step}」引用的脚本在 package.json 里没有定义`);
    continue;
  }
  // 形如 `node scripts/check-x.mjs` 的，检查文件真的在
  const fileMatch = /node (scripts\/[\w.-]+\.mjs)/.exec(scripts[name]);
  if (fileMatch && !existsSync(join(ROOT, fileMatch[1]))) {
    problems.push(`「${name}」指向的脚本文件不存在：${fileMatch[1]}`);
  }
}

// ── 4. 反向：定义了但没进编排的门禁 ─────────────────────────────────
const inAll = new Set(
  steps.map((s) => /^npm run ([\w:-]+)$/.exec(s)?.[1]).filter(Boolean),
);
/*
 * 这些是**故意不进**编排的，每条都要写明理由——
 * 「故意不加」与「忘了加」在输出里长得一样，只有把理由写下来才能区分。
 */
const NOT_IN_ALL = new Map([
  // 编排自身
  ['verify:all', '它就是编排本身（`package.json` 里的 verify:all 字段）——把它放进自己会无限递归'],
  ['verify:only', '**`verify` 的别名**——两者都跑 `scripts/bundle-and-verify.mjs`；'
    + '留着是因为它表达了「只跑契约、不跑别的」这个意图。'
    + '⚠️ 2026-09-28 修正：本条原先写的是「被 verify:all 的第 3 步调用」——'
    + '**而第 3 步现在是 `npm test`，它早就不被任何地方调用了。** '
    + '理由过时而没人发现，正是因为**没有东西核「理由是否还成立」**。'],
  ['verify:package-files', '它是 `check:package-files` 的**全量版**——要真打 tarball、'
    + '真装依赖、真构建，**每次跑要 40 秒以上**。'
    + '编排第 43 步跑的是快版（只核 `files` 白名单本身，判据①）；'
    + '**全量版（判据②）由 `verify:new-gates-mutations` 在验变异时顺带跑**——'
    + '而 `scripts/check-package-files.mjs` 里那个 `GATE_ARGS` 就是把 `--full` 拼上的地方。'
    + '**它不需要每次构建都付那个代价**，而「没人跑」与「跑过了」的区别由那条变异守着'],
  // 需要外部环境的
  ['verify:online', '对着线上 Demo 跑（`scripts/smoke-online.mjs`），需要环境变量 `SITE_ORIGIN`；'
    + 'GitHub Pages 跑不了内容协商（响应头不可改），'
    + '**实测那 7 项会红**——README 已写明这是限制，不适合做门禁'],
  // 交互式 / 人工触发
  ['wiki:review', '交互式：它**不写回文件**，只打印该粘进 frontmatter 的片段。'
    + '「我复核过了」是人的承诺，不能由脚本自动完成。'
    + '可测的部分由 `npm run verify:review` 覆盖（逐页比对状态与摘要）'],
  ['wiki:impact', '只读的人工报告：列三组影响面。它不判定对错，'
    + '判定由 `verify:impact` 拿 `knowledge/impact-cases.md` 当金标负责'],
  ['wiki:ask', '交互式问答：输入是自然语言问题，没有固定输入就没法当门禁。'
    + '它的可测部分已抽成 `src/lib/wiki/context-pack.ts`，判定由 `verify:answers` 负责'],
  // 人工核对的清单类
  ['measure', '量产物给**人**看（`scripts/measure.mjs`），判定由 `npm run verify:formats` 里对应的门禁做'],
  ['list:overclaims', '列出可被证伪的声称供人工核对（`scripts/list-overclaims.mjs`），**退出码恒为 0**——'
    + '它不判定对错，给它非 0 退出码会让「列清单」变成「门禁」'],
  // 需要显式输入才跑得起来的
  ['migrate:manifest', '需要 `node scripts/migrate-manifest.mjs <v1.json>`——'
    + '**没有默认输入**：仓库里那份 v1 是真实线上产物（`knowledge/fixtures/manifest-v1.json`），'
    + '但迁移本身是一次性动作，不需要每次构建都跑。它可测的部分（诊断是否精确）'
    + '已由 `verify:migrate` 覆盖'],
]);

/*
 * ⚠️ **2026-09-28 加：每条豁免理由必须含一个「可验证的具体引用」。**
 *
 * 2026-09-28 实测：`verify:only` 的豁免理由写的是
 * 「被 verify:all 的 **第 3 步**调用」——而第 3 步现在是 `npm test`，
 * **它早就不被任何地方调用了**。理由过时而没人发现。
 *
 * > 散文形式的理由会随代码变动而失效，**而没有任何东西提醒**。
 * > 所以判据是：理由里**必须出现一个当前仍然成立的引用**——
 * > 一个命令名、一步的序号、或一个文件路径。
 *
 * ⚠️ **而且那个引用必须真的存在。** 第一版只查「长得像」，
 * 于是 `npm run verify:reviw`（拼错）也能过——**那是形态九的同族**：
 * 「有引用」不等于「引用还成立」。
 * 所以下面逐个**真的去查**：文件存在、命令在 package.json 里有定义。
 *
 * ⚠️ **它量不到「理由是否还准确」**——语义判断仍然是人的事。
 * 机器能做的只是让**过时的那类失效**变得可见。
 */
const pkgForRefs = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/**
 * **豁免理由不引用编排里某一步的那些**，每条都要写明**为什么**。
 *
 * ⚠️ **登记每一条都要带一句「为什么」。** 一张光有名字的登记表
 * 与「自动豁免」的差别是：**它把「我不想核」变成了一句要写出来的话**，
 * 而那句话会被人读到。
 *
 * ⚠️ **本表只登记「不引用某一步」这一件事。**
 * 「理由里有没有可验证的引用」由判据 ③ 独立核（本表里的每条都得过它），
 * 「理由说的东西存不存在」由 ①② 独立核——**三件事互不替代**。
 *
 * ⚠️⚠️ **2026-09-29：这张表是被判据逼出来的，不是设计出来的。**
 * 我先加判据 ②½（核「理由里的『第 N 步是 X』」），跑了一遍看见 `✓` 就当它成立——
 * 而 `verify:only` 的理由里**一个那种写法都没有**，整段循环**一次都没进**。
 * 那之后才有了本表：**让「我不引用某一步」变成一句要写出来的话**。
 */
const NO_STEP_REF = new Map([
  ['verify:all', '它就是编排本身——**没有一步能调用它**，引用某一步在语义上就是错的。'],
  ['verify:online', '它对着**线上**跑（响应头在那儿才生效），而 `verify:all` 里没有任何一步连得上线上。'],
  ['wiki:review', '交互式：它不写回文件，只打印片段。**编排里没有它的位置**，因为编排只跑无人值守的东西。'],
  ['wiki:impact', '它不判定对错，只打印三组影响面。**编排里没有它的位置**——它是给人看的报告。'],
  ['wiki:ask', '输入是自然语言问题，**没有固定输入**；编排里的每一步都要能无人值守地跑。'],
  ['measure', '它量产物**给人看**（报告的字节数），**不判定任何东西**——没有判定就没有「在编排里」这个位置。'],
  ['list:overclaims', '**退出码恒为 0**——它列清单供人工核对，**不判定**。把它变成编排的一步会给出「全绿」的假信号。'],
  // ⚠️ **下面这条是判据 ②⅔ 报出来的**（2026-09-29）——我手工数豁免时**数成了 8 条**，
  // 因为我的数法只匹配到 `['名字', '...'],\n`，而这条的 key 带冒号、值跨了 4 行。
  // 判据**不数**，它逐条问「你登记了吗」，所以它当场抓到了我数漏的那条。
  ['migrate:manifest', '它**迁移线上产物**（写 `public/content-manifest.json`）——'
    + '一次性动作，**每次构建都跑没有意义**，而编排里的每一步都必须是每次都该跑的。'],
]);

console.log(`  豁免表 ${NOT_IN_ALL.size} 条，其中 ${NO_STEP_REF.size} 条登记了「不引用某一步」`);

for (const [name, why] of NOT_IN_ALL) {
  // ① 抽出所有 `npm run <名字>`
  for (const m of why.matchAll(/npm run ([\w:-]+)/g)) {
    if (typeof pkgForRefs.scripts?.[m[1]] !== 'string') {
      problems.push(
        `\`${name}\` 的豁免理由引用了 \`npm run ${m[1]}\`——**而 package.json 里没有这个脚本**。\n`
        + '    引用本身不存在，那条理由就是空的。',
      );
    }
  }
  // ② 抽出所有看起来像路径的引用（带扩展名）
  for (const m of why.matchAll(/`([\w./-]+\.(?:mjs|ts|json|md))`/g)) {
    const p = m[1];
    // 去掉 `node ` 前缀那一类
    if (!existsSync(join(ROOT, p))) {
      problems.push(
        `\`${name}\` 的豁免理由引用了 \`${p}\`——**而那个文件不存在**。\n`
        + '    引用本身不存在，那条理由就是空的。',
      );
    }
  }
  /*
   * ②½ **理由里若断言「第 N 步是 X」，核那一步现在真的是 X。**（2026-09-29 补）
   *
   * ①②核「引用的文件/命令存在」、③核「至少有一个引用」——
   * 而**「第 N 步」在 ③ 里只被当成「一种引用的写法」，它的内容从不被核**。
   *
   * > 2026-09-24 实测过一次：`verify:only` 的理由写「被第 3 步调用」，
   * > 而**第 3 步早就是 `npm test` 了**。**理由空了一个多月没人发现**，
   * > 因为**没有任何东西核「它说的那一步现在是什么」**。
   *
   * ⚠️⚠️ **第一版 12 秒过去仍然全绿，而那绿毫无意义。**
   * `verify:only` 的理由里**一个「第 N 步是 X」都没写**（它写的是「本条原先…」），
   * 于是整段循环**一次都没执行**。变异把第 3 步换成别的命令，它**照样绿**。
   *
   * > **「没匹配到」与「匹配到且一致」在输出上完全一样**（形态四）——
   * > 而**第一次实测就抓到了它**。**这不是假想，是那天刚发生的。**
   * > 治法是下一条判据 ②⅔：要求每条豁免**要么**引用一步、**要么**登记。
   *
   * 判据：抽出「第 N 步（现在）?是 `X`」这种**可判真假的说法**，
   * 拿 `EXPECTED` 里的第 N 步去比。
   * ⚠️ **按 `EXPECTED` 的序号算，不是 `steps[n-1]`**——
   * 两者在数量对得上时**逐字相同**（所以看不出区别），
   * 而在 `verify:all` 少了步、或 `npm test` 少算一步时**分叉**。
   * 判 ①② 用的是 `steps`（数出来的实际编排），判 ②½ 必须是**从语义上对应的那份**。
   */
  for (const m of why.matchAll(/第 (d+) 步(?:现在|目前)?(?:是|为|变成)s*`([^`]+)`/g)) {
    const n = Number(m[1]);
    const claimed = m[2];
    const actual = EXPECTED[n - 1]?.[0];
    if (actual === undefined) {
      problems.push(
        `\`${name}\` 的豁免理由说「第 ${n} 步是 \`${claimed}\`」——`
        + `**而 \`EXPECTED\` 里没有第 ${n} 步**。\n`
        + '    → 要么步号写错了，要么**这条理由所依据的状态已经不存在了**。\n'
        + '    **格式合法不等于引用有效**：写一个不存在的步号，这条理由就是空的。',
      );
      console.log(`  ✗ ${name}：理由说第 ${n} 步，而那份步骤清单里没有这一步`);
      continue;
    }
    if (actual !== claimed) {
      problems.push(
        `\`${name}\` 的豁免理由说「第 ${n} 步是 \`${claimed}\`」——`
        + `**而它现在是 \`${actual}\`**。\n`
        + '    → **编排变了而理由没跟**。\n'
        + '    这类漂移**没人会主动看**：理由是散文，只有它自己提到了「第 N 步」才检得到。',
      );
      console.log(`  ✗ ${name}：理由说第 ${n} 步是 ${claimed}，实际是 ${actual}`);
    } else {
      console.log(`  ✓ ${name}：理由里「第 ${n} 步是 ${claimed}」与编排一致`);
    }
  }
  // ③ 至少要有一个引用
  if (!/`(npm run [\w:-]+|[\w./-]+\.(?:mjs|ts|json|md))`|第 \d+ 步/.test(why)) {
    problems.push(
      `\`${name}\` 的豁免理由里没有任何**可验证的引用**（命令名 / 文件路径 / 第几步）。\n`
      + `    理由是散文就会随代码变动而失效，而没有人会回头看它——\n`
      + `    2026-09-28 实测 \`verify:only\` 的理由早就过时了（「被第 3 步调用」，`
      + `而第 3 步早就是别的了）。\n`
      + `    写清它指向哪个命令 / 文件 / 步骤。`,
    );
  }
  /*
   * ②⅔ **每条豁免要么说清「它在哪一步被核」，要么在 `NO_STEP_REF` 里登记。**（2026-09-29）
   *
   * ②½ 要求「理由里提到了第 N 步，就核那一步」——
   * **而「提到了」这件事本身就是可以没有的**。
   * 上一版实测过：整段 ②½ 一次都没执行，而门禁照样绿。
   *
   * > 那是形态四（没测到 ≠ 测到且一致），**而它不是假想**：
   * > 我加完判据、跑了一遍看见 `✓`、就当它成立——**12 秒过去，零次执行**。
   *
   * ⚠️ **② 必须是登记而不是自动豁免。**「理由里没写第 N 步」不该自动放过——
   * 那正是 ②½ 失效的那个条件。**让作者自己声明**，而声明本身要能被核：
   * `NO_STEP_REF` 的每一条都带一句为什么（那张表自己的注释里写明了这一点）。
   *
   * ⚠️ **本判据不看数字，只逐条问「你登记了吗」。** 这一点是被逼出来的：
   * 我手工数豁免时**数成了 8 条**（实际 9 条，漏了 key 带冒号、值跨 4 行的那条），
   * 而「比对两个数」需要**我先把两处都数对**——那正是手写清单的病。
   * 逐条问则**不需要数**。
   */
  if (!NO_STEP_REF.has(name) && !/第 \d+ 步/.test(why)) {
    problems.push(
      `\`${name}\` 的豁免理由**没有指向编排里的任何一步**——\n`
      + '    → 判据 ②½ 只在理由提到「第 N 步是 X」时才会去核，'
      + '**而你这条不会触发它**（2026-09-29 实测：整段判据零次执行，门禁照样绿）。\n'
      + '    要么在理由里写清「它在哪一步被核」，'
      + '要么在 `NO_STEP_REF` 里登记并写明为什么它不引用某一步。',
    );
  }

  /*
   * ⚠️ ④ **「第 N 步」也要真去核，不能只认格式。**（2026-09-28 实测的盲区）
   *
   * ③ 那条正则把「第 \d+ 步」算作**可验证的引用**，于是往理由里塞一句
   * 「见 verify:all 的第 999 步」就通过了——**格式合法、指向一个不存在的步骤**。
   *
   * > 讽刺的是，**这正是 `verify:only` 那条豁免当初真的出过事的地方**：
   * > 它的理由写「被第 3 步调用」，而第 3 步早就是 `npm test` 了。
   * > 门禁在自己的注释里记着这个教训，却只挡住了「没有引用」，
   * > **没挡住「引用了一个已经漂掉的步骤号」**。
   *
   * ⚠️ **但不能对所有「第 N 步」都报错**——`verify:only` 的理由里那句
   * 「而第 3 步现在是 `npm test`」是**被否定的历史陈述**，
   * 它的「第 3 步」不是「我指向第 3 步」。
   *
   * 所以判据分两种读法，靠**紧邻的词**区分：
   *
   * - **否定式**（`而第 N 步`、`原为第 N 步`、`已经不是第 N 步`）→ **不判**，
   *   它引述的正是「曾经指向某处、现在不是了」；
   * - **肯定式**（`第 N 步`、`见第 N 步`、句子里的裸引用）→ **必须落在编排范围内**。
   *
   * > 「靠一个词区分」是脆弱的，这是**已知代价**。不换别的办法是因为
   * > 真正的替代是「要求理由用结构化字段而不是散文」，
   * > 而那会把这个表从可读的注释变成配置。
   * > 判据太宽会漏，太严会逼人绕开——**选一个错的代价更小的，然后写明代价**。
   */
  const NEGATED_STEP = /(?:而|原为|原本是|已不是|不再是|曾经是)[^，。；]{0,6}第 \d+ 步/g;
  const withoutNegated = why.replace(NEGATED_STEP, '');
  for (const m of withoutNegated.matchAll(/第 (\d+) 步/g)) {
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1 || n > steps.length) {
      problems.push(
        `\`${name}\` 的豁免理由引用了「第 ${m[1]} 步」，而 \`verify:all\` 只有 ${steps.length} 步。\n`
        + '    **格式合法不等于引用有效**——写一个不存在的步骤号，这条理由就是空的。',
      );
    }
  }
}

for (const name of Object.keys(scripts)) {
  /*
   * ⚠️ **前缀必须包含 `check:`。**
   *
   * 2026-09-24 实测：这里原本写 `/^(verify|wiki):/`，
   * 于是 `check:site-agnostic` 与 `verify:site-mutations` **两者都扫不到**——
   * 前者因为前缀不匹配，后者因为名字里没有 `check`…
   * 而实际上后者有 `verify:` 前缀，是能扫到的。**真正漏的是 `check:*` 这一族。**
   *
   * 也就是说：这道检查**宣称**能抓「定义了却不在编排里的门禁」，
   * 却对以 `check:` 命名的门禁失明。
   * 判据本身没问题（前缀写窄了），但**宣称与能力不符**比没有更糟。
   */
  if (!/^(verify|wiki|check):/.test(name)) continue;
  if (inAll.has(name) || NOT_IN_ALL.has(name)) continue;
  problems.push(
    `门禁「${name}」存在但**不在 verify:all 里**。` +
      `若它是人工触发的（例如 verify:online），请把它加进 NOT_IN_ALL 并写明理由——` +
      `否则「忘了加进编排」和「故意不加」在输出里长得一样。`,
  );
}

/*
 * ── 4b. 有负向验证的门禁，它的负向验证覆盖了每一项判据 ──────────────
 *
 * ⚠️ **2026-09-24 补的**：上一轮我在 `check-site-agnostic.mjs` 的收尾语里
 * 写了「新增要手写」——而**那句话没有任何东西守着**。
 * 于是「加了一条判据但没加对应的变异」会静默通过。
 *
 * > **这是「注释里写了而代码没做」的第 N 次**，
 * > 只是这次「注释」是**给读者的输出**而不是源码注释。
 *
 * 判据：对每个「配了负向验证」的门禁，读它的负向脚本，
 * 确认变异条数**不少于**被测门禁的 `REQUIREMENTS` 条数。
 * 不够就红，并说清差几条。
 */
/*
 * 只列**有可数判据清单**的门禁。
 *
 * ⚠️ `check-exit-codes.mjs` 与 `check-json-output.mjs` **故意不在这里**：
 * 它们的判据是**平铺在代码里的**（`if (...) problems.push(...)`），
 * 没有可数的清单——而**用正则去数那些 `if` 会把错误分支的措辞也算进去**，
 * 得到的数不可信。
 *
 * > **一个不可信的自动检查比没有检查更糟**——
 * > 它要么误报训练人忽略输出，要么漏报让人误以为覆盖了。
 * > 所以这里显式排除，而不是「数一下凑合」。
 * >
 * > 那两个门禁的覆盖靠**它们各自的负向验证**（各 3 个变异），
 * > 以及**每次增删判据时人工同步**变异——这是现状，不是本检查提供的保证。
 */
const GATES_WITH_MUTATIONS = [
  { gate: 'scripts/check-site-agnostic.mjs', mutations: 'scripts/site-agnostic.mutations.mjs' },
];

console.log('');
console.log('负向验证是否覆盖了被测门禁的每一项判据');
console.log('─'.repeat(64));

for (const { gate, mutations } of GATES_WITH_MUTATIONS) {
  const gatePath = join(ROOT, gate);
  if (!existsSync(gatePath)) continue;
  const gateText = readFileSync(gatePath, 'utf8');
  // 判据条数 = `mustMatch: [` 的个数（每条判据一个）
  const criteria = (gateText.match(/mustMatch: \[/g) ?? []).length;
  if (criteria === 0) {
    console.log(`  – ${gate}：没有 REQUIREMENTS 式的判据清单，跳过`);
    continue;
  }
  const mutPath = join(ROOT, mutations);
  if (!existsSync(mutPath)) {
    problems.push(`${gate} 有 ${criteria} 项判据，但它的负向验证 ${mutations} 不存在`);
    console.log(`  ✗ ${gate}：负向验证缺失`);
    continue;
  }
  const mutText = readFileSync(mutPath, 'utf8');

  /*
   * ⚠️ 第一版只比**数量**（判据 3 项 vs 变异 4 个 → 绿）。
   * 而**数量够不等于每一项都被覆盖**——4 个变异可能都在测前两项。
   *
   * 变异验证实测：加第三条判据而不加对应变异，门禁**照样绿**。
   *
   * > 这与「只查一个方向」是同一类：**判据与被测对象不是一一对应**，
   * > 而「数量」这个代理指标**看起来足够、实际不够**。
   *
   * 所以改成**按 `file` 逐项对应**：每条 `REQUIREMENTS` 的 `file`
   * 要在变异脚本里被至少一个变异点到。
   */
  const requirementFiles = [...gateText.matchAll(/file: '([^']+)'/g)].map((m) => m[1]);
  const uncovered = requirementFiles.filter(
    (f) => !mutText.includes(f),
  );
  if (uncovered.length > 0) {
    problems.push(
      `${gate} 的这些判据在 ${mutations} 里**没有任何变异点到**：\n` +
        uncovered.map((f) => `        ${f}`).join('\n') + '\n' +
        `    **「新增要手写」这句话原本没有任何东西守着**。`,
    );
    console.log(`  ✗ ${gate}：${uncovered.length} 项判据没有对应的变异（${uncovered.join('、')}）`);
  } else {
    console.log(`  ✓ ${gate}：${requirementFiles.length} 项判据都有对应变异`);
  }
}

/*
 * ── 4c. 编排里的每道门禁，**覆盖它的变异脚本要么存在、要么登记理由** ────
 *
 * ⚠️⚠️ **2026-09-29 实测：4b 那个循环一次都没跑过 12 道门禁。**
 *
 * `GATES_WITH_MUTATIONS` 里**只有一道**（`check-site-agnostic`），
 * 而 `verify:all` 里有 **21 道**脚本门禁、其中 **13 道**在
 * `new-gates.mutations.mjs` 里有变异。
 * 于是对那 13 道，4b 压根不会看——**它只知道登记表里有的那一个**。
 *
 * > **「登记表里没有」与「核过了」在输出上完全一样**：
 * > 4b 打印的那行 `scripts/check-site-agnostic.mjs：3 项判据都有对应变异`
 * > 读起来像「每道门禁都核过了」，而实际上 12 道从未进入过那个循环。
 * >
 * > 而 4b 恰恰是**「谁还没被验」的那个判定者**——
 * > **判定者自己漏了 12 个对象，而没人看得出来。**
 *
 * 修法与 ②⅔ 同一形状：**清单一律从文件系统推导，不手写。**
 *   ① `scripts/*mutations*.mjs` 就是「有哪些变异脚本」（读目录，不写清单）
 *   ② `verify:all` 里跑的脚本门禁就是「有哪些要覆盖的对象」（已在 `steps` 里）
 *   ③ 「哪个脚本覆盖哪道门禁」由**文件名对应**推出来
 *      （`site-agnostic.mutations.mjs` ↔ `check-site-agnostic.mjs`），
 *      推不出来的必须在 `NO_MUTATION` 里**写明为什么**
 *
 * ⚠️ **③ 的对应关系是「去掉前缀后的名字相同」**，
 * 而这依赖命名约定——**所以它是本条判据最弱的一环**，
 * 写在这里是为了让下一个人知道**它有多可信**。
 * 真要更严，得让每个变异脚本自报 `target`（`new-gates.mutations.mjs` 已经这么做了）。
 */
{
  /** 「`check-xxx.mjs`」与「`xxx.mutations.mjs`」之间的对应：去掉前缀后同名。 */
  const stem = (f) => f
    .replace(/^check-/, '')
    .replace(/^verify-/, '')
    .replace(/\.mjs$/, '')
    .replace(/\.mutations$/, '');

  /**
   * 这道门禁有没有变异脚本覆盖它。
   *
   * ⚠️⚠️ **靠文件名推是错的——实测 13 道里 13 道都推不出。**
   *
   * 第一版用「`check-x.mjs` ↔ `x.mutations.mjs`」这个约定，
   * 而 7 个变异脚本的 stem 是：`exit-codes` / `json-output` / `migrate-manifest`
   * / **`new-gates`** / `retrieval-gates` / `second-site-real` / `site-agnostic`。
   * **13 道新门禁的变异全在 `new-gates.mutations.mjs` 一个文件里**，
   * stem 是 `new-gates`——与它们**逐个都对不上**。
   *
   * > **只有 4 道能推出来**（`check-exit-codes` / `check-json-output` /
   * > `migrate-manifest` / `check-second-site-real`），而那 4 道**恰好**
   * > 是各有独立变异脚本的那些。**巧合，不是规律。**
   *
   * 权威关系是变异脚本里的 **`target:` 字段**——
   * `new-gates.mutations.mjs` 47 条变异里每条都写了 `target`。
   * **从那里读，不从文件名猜。**
   *
   * ⚠️ **而 5 个变异脚本没有 `target` 字段**（`exit-codes` / `json-output` /
   * `migrate-manifest` / `retrieval-gates` / `second-site-real` /
   * `site-agnostic`）——那 6 个只能靠文件名，而**那 6 个恰好对得上**。
   * 两条路并用，**哪条推不出就试另一条**，都推不出才算未覆盖。
   */
  const mutationScripts = readdirSync(join(ROOT, 'scripts'))
    .filter((f) => f.includes('mutations') && f.endsWith('.mjs'));
  const targets = new Set(
    mutationScripts.flatMap((m) =>
      [...readFileSync(join(ROOT, 'scripts', m), 'utf8').matchAll(/target: '([^']+)'/g)].map((x) => x[1]),
    ),
  );

  const covered = (f) => targets.has(f) || mutationScripts.some((m) => stem(m) === stem(f));

  /**
   * 编排里跑的**门禁脚本**（变异脚本自己不算——它就是验证，不是被验证的对象）。
   * ⚠️ `bundle-and-verify.mjs` 也不算：它是端到端契约，没有可注入的判据层。
   */
  const gateScripts = steps
    .map((s) => /^npm run ([\w:-]+)$/.exec(s)?.[1])
    .filter(Boolean)
    .map((n) => (/node (scripts\/[\w.-]+\.mjs)/.exec(scripts[n] ?? '') ?? [])[1])
    .filter(Boolean)
    .map((f) => f.replace(/^scripts\//, ''))
    .filter((f) => !f.includes('mutations') && f !== 'bundle-and-verify.mjs');

  /**
   * ⚠️⚠️ **「覆盖」不等于「有变异脚本」——这是 4c 第一版栽的地方。**
   *
   * 第一版只认变异脚本，于是报出 **28 道未覆盖**。
   * 而其中绝大多数在 `knowledge/gate-negatives.md` 的表里**明明有 ✅ 红**——
   * 2026-09-24 那批验证是**手工做的**，后来固化成 7 个变异脚本，
   * **而那 7 个里有 5 个没有 `target` 字段**，覆盖关系只能从文件名推。
   *
   * > **「没找到变异脚本」≠「没被验过」**（形态十一，反向）。
   * > 台账里那一行「✅ 红」**就是**证据——它是被记下来的事实。
   *
   * 所以判据改成**三选一**，三样都是可从文件系统读出来的事实：
   *   ① 有覆盖它的变异脚本（按文件名对应）
   *   ② 台账表里有它的一行（**台账是台账，不重新判断对错，只查它在不在**）
   *   ③ 在 `NO_MUTATION` 里登记了理由
   *
   * ⚠️ **② 只查「在不在」，不查那行写的是不是「✅ 红」**——
   * 「未验」也是一行，那正是「已知的空白」，**不是缺口**。
   */
  const ledger = readFileSync(join(ROOT, 'knowledge', 'gate-negatives.md'), 'utf8');
  /**
   * 台账表里出现过的门禁命令名（第一列反引号里的那个）。
   *
   * ⚠️⚠️ **第一版要求「反引号后紧跟竖线」——而台账里有 12 行星着「（新）」**
   * （`` `check:two-paths`（新） ``），于是**那 12 行对这道判据等于不存在**。
   *
   * > 「（新）」是给人看的备注，而**机器不该因为它看不见那一行**——
   * > 那与「文件里没写」在输出上完全一样（形态四的变体）。
   *
   * 2026-09-29 实测：加 `check:release` 时它报「三样都没有」，
   * 而台账里**明明有那一行**（第 93 行）——差别只是「（新）」两个字。
   *
   * 所以改成：**取反引号里的名字，不关心后面跟什么**。
   */
  const inLedger = new Set(
    [...ledger.matchAll(/^\|\s*`((?:verify|check|wiki)[:\w-]*)`[^|]*\|/gm)].map((m) => m[1]),
  );

  const NO_MUTATION = new Map([
    ['check-staged.mjs', '它只比**暂存区与工作区**——而**注入的改动按定义就在工作区里**，'
      + '所以每一条针对它的变异都会「注入后本来就一致」。它核的是流程，不是代码。'],
  ]);

  /**
   * 编排里的门禁 → 它的**命令名**。
   *
   * ⚠️⚠️ **台账记的是命令名，而 `gateScripts` 给出的是脚本文件名——两样东西。**
   * 我第一版直接拿脚本文件名去 join 台账，于是**命中 0 道**，
   * 而台账里明明有 27 个门禁。**59 个单文件脚本里有 8 个命令名与脚本名不同**
   * （`check:anchors` → `check-anchor-links.mjs`），**这就是那 8 个的来源**——
   * 同一个坑，`check-command-scripts.mjs` 当初就是为它建的。
   *
   * 而 `NAME_DIVERGENCE` **就是那份权威对应表**，
   * 它的注释里写着「照着命令名去 grep 脚本会落空，我今天因此 ENOENT 了两次」，
   * 而 `check-command-scripts` 守着它。**用它，不要自己拼名字。**
   */
  const { NAME_DIVERGENCE } = await import('./lib/command-scripts.mjs');
  const cmdOfScript = new Map(NAME_DIVERGENCE.map(([cmd, file]) => [file.replace(/^scripts\//, ''), cmd]));

  /** 编排里的门禁命令名 → 它的脚本文件名。 */
  const scriptOfCmd = new Map(
    Object.entries(scripts)
      .map(([c, v]) => [c, (/node (scripts\/[\w.-]+\.mjs)/.exec(v ?? '') ?? [])[1]])
      .filter(([, f]) => f),
  );

  /** 这道门禁在台账里有没有一行。 */
  const recorded = (f) => {
    const cmd = cmdOfScript.get(f) ?? [...scriptOfCmd].find(([, v]) => v.replace(/^scripts\//, '') === f)?.[0];
    return cmd !== undefined && inLedger.has(cmd);
  };

  const uncovered = gateScripts.filter((f) => !covered(f) && !recorded(f) && !NO_MUTATION.has(f));
  console.log('');
  console.log('编排门禁的负向验证覆盖（4c：从文件系统推导，不手写清单）');
  console.log('─'.repeat(64));
  const viaScript = gateScripts.filter(covered).length;
  const viaLedger = gateScripts.filter((f) => !covered(f) && recorded(f)).length;
  console.log(
    `  ${gateScripts.length} 道编排门禁：${viaScript} 道有变异脚本、`
    + `${viaLedger} 道在台账里有记录、${NO_MUTATION.size} 道登记了理由`,
  );
  for (const [f, why] of NO_MUTATION) {
    console.log(`  – ${f}：${why}`);
  }
  if (uncovered.length > 0) {
    problems.push(
      `这些编排门禁**既没有变异脚本、台账里也没有一行**：\n`
      + uncovered.map((f) => `        scripts/${f}`).join('\n') + '\n'
      + '    → 补一个变异脚本、在台账里记一行、或在 `NO_MUTATION` 里写明为什么。\n'
      + '    **沉默不是理由**——「没登记」与「核过了」在输出上完全一样。',
    );
    console.log(`  ✗ ${uncovered.length} 道三样都没有：${uncovered.join('、')}`);
  } else {
    console.log('  ✓ 每道编排门禁都有变异脚本、台账记录、或登记过的理由');
  }
}

/*
 * ── 4d. 台账里「注入什么」那一列，**必须写得出别人能照着做的动作** ──────
 *
 * ⚠️ **4c 只核「台账里有没有这一行」，不核「那一行写的是不是真的」。**
 * 而**表格里写「✅ 红」还是「后来补记的」，机器判不了**——
 * 4c 的边界就写在这里，别让人以为它管了。
 *
 * **能判的是另一件事：那一行的「注入什么」够不够具体。**
 *
 * > 2026-09-29 实测：表里 68 行声称验过，其中 4 行写的是
 * > `闸二失效` / `闸一门槛归零` / `接缝识别失效` / `问句壳剔除失效`
 * > ——**全是 `verify:questions`**，而「闸二」在代码里**根本没有编号**。
 * > 那份文件的注释说的是「闸：先证明这把尺子量到了东西」，
 * > **「闸二」指向一个不存在的对象。**
 * >
 * > **半年后没有人能照着那一行重做那次验证**——而那正是台账的价值。
 *
 * 判据（**刻意窄**，只抓最硬的一种）：
 * 「注入什么」必须**含一个可定位的锚点**——文件路径、命令、标识符三者之一。
 *
 * ⚠️ **为什么不是「每个词都要能核」**：那是语义判断，机器做不了，
 * 而**判据太宽会逼人写废话**（把每行都塞进三个锚点，表格就没法读了）。
 * 这里只抓「**一个锚点都没有**」那一种——那几乎总是「当时没写清楚」。
 *
 * ⚠️ **分隔行与表头不参与判定**（它们也是 4 列），按内容排除。
 */
{
  const cells = (l) => l.split('|').slice(1, -1).map((s) => s.trim());
  const isSeparator = (l) => /^[\s|:-]+$/.test(l);
  const ledgerLines = readFileSync(join(ROOT, 'knowledge', 'gate-negatives.md'), 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map((l, i) => ({ line: i + 1, c: cells(l), raw: l }))
    // 「门禁 / 注入什么 / 结果 / 日期」四列，且结果列是结论而非分隔线
    .filter(({ c, raw }) => c.length === 4 && !isSeparator(raw) && /^(✅|⚠️|❌)/.test(c[2]));

  /**
   * 「注入什么」里有没有**一个能照着做的锚点**。
   *
   * ⚠️⚠️ **第一版判据是「有没有反引号」，报出 25 行——而它错了。**
   *
   * 「把 README 里的测试条数改成 999」「删掉一条金标用例」
   * **完全可复现**，只是没打反引号。
   * **「没加标记」≠「不可复现」**——那是我把格式当成了内容。
   *
   * 现在的判据是**句子里有没有任何具体对象**：
   * 数字、引着的东西（反引号 / 书名号 / 引号）、或一个标识符。
   *
   * > 而它**仍然不完美**：「删掉一条金标用例」被判成 vague，
   * > 而知道金标文件在哪就能做。**机器判不出「够不够具体」**——
   * > 所以这条判据只抓**最硬的一档**：整句一个具体对象都没有。
   * > **剩下的靠人读，而这一条保证的是「没有一行是完全无从下手的」。**
   */
  const hasAnchor = (what) =>
    /[「」『』"']/.test(what)          // 引着东西 = 点名了某个具体物
    || /[`]/.test(what)               // 反引号包着的标识符
    || /\d/.test(what)                 // 数字 = 指到具体位置
    || /[A-Za-z_$][\w$]*/.test(what); // 标识符

  const vague = ledgerLines.filter(({ c }) => !hasAnchor(c[1]));
  console.log('');
  console.log('台账「注入什么」那一列的可复现性（4d）');
  console.log('─'.repeat(64));
  console.log(`  声称验过的 ${ledgerLines.length} 行，其中 ${vague.length} 行没有可定位的锚点`);
  if (vague.length > 0) {
    problems.push(
      '台账里这些行**没有写清注入的是什么**——下一个人没法照着重做那次验证：\n'
      + vague.map((v) => `        ${v.c[0]}：${v.c[1]}`).join('\n') + '\n'
      + '    → 「注入什么」必须含一个**别人能照着做的锚点**：\n'
      + '    一个文件名、一个 `npm run` 命令、或一个反引号包着的标识符。\n'
      + '    **台账的全部价值就是「照着它能重做」**，而写不出动作的那行等于没记。',
    );
    for (const v of vague) console.log(`  ✗ ${v.c[0]}：${v.c[1]}`);
  } else {
    console.log('  ✓ 每一行都写得出别人能照着做的动作');
  }
}

/*
 * ── 4e. 台账里点名的文件路径，**要么真存在、要么明说它没了** ────────────
 *
 * 4d 让台账里出现了大量**具体路径**（那正是它要的），
 * **而具体路径会过期**——这是 4d 直接带来的新失效模式。
 *
 * > 2026-09-29 实测：台账里 23 个路径，1 个不存在——
 * > `knowledge/log.md`。而那一行**明写着**「那个文件被删了两次」。
 * >
 * > **所以「不存在」本身不是缺口**——**「不存在且没说明」才是**。
 * > 两者在输出上完全一样，而一个是**已记录的历史**。
 *
 * 判据：点名了路径、而那个路径不存在、**且同一行没提「删 / 没有 / 不存在」**。
 *
 * ⚠️ **豁免是按「行」而不是按「文件」**——同一行里提到别的路径不该被牵连。
 * ⚠️ **「删了」「移除了」「没有」这三个词足够**，不要求精确措辞；
 * 加词容易漏，而**漏报的后果是这条判据渐渐没人信**。
 */
{
  /*
   * ⚠️⚠️ **豁免词必须在「路径之外」判，不能扫整行。**
   *
   * 我注入一个中文的假路径 `src/lib/wiki/这个文件不存在.ts`，
   * 门禁**照样绿**——因为豁免正则扫的是**整行**，
   * 而**那个文件名里就有「不存在」三个字**。
   *
   * > **豁免词可以藏在被豁免的对象里**，而那正是豁免最危险的形态：
   * > 一个叫「不存在」的文件，永远不需要解释自己为什么不存���。
   *
   * 所以判据改成：**先把所有路径从那一行里摘掉，再看剩下的文字**。
   * ⚠️ 而「解释」通常写在**结果列或门禁列**（那一行的散文部分），
   * 「注入什么」列里往往没有——所以**不能只看注入列**，看的是**整行去掉路径后**。
   */
  const DELETED = /删(了|掉|除)|移除|不存在|没有(这个|那个)?文件|已废弃/;
  const broken = [];
  for (const [i, line] of ledgerText.split('\n').entries()) {
    if (!line.startsWith('|')) continue;
    const PATH_IN_LINE = /`((?:src|scripts|knowledge|docs|public|AGENTS)[^`\s]*\.(?:mjs|ts|md|json|yml|astro))`/g;
    const cells = line.split('|').slice(1, -1).map((s) => s.trim());
    /*
     * ⚠️ **路径正则必须容许中文——第一版用 `[\w./-]`，而 JS 的 `\w` 是 ASCII。**
     *
     * 我拿一个中文路径注入，门禁**照样绿**——而 `existsSync` 明确是 false。
     * **判据压根没看见那个路径**，而它读的是一个中文文档。
     *
     * > 台账里本来就有中文文件名（`knowledge/fixtures/second-site/导出-总览.md`），
     * > 而**恰恰是这些路径最需要核**——它们最容易被改名。
     *
     * 所以路径段用「非反引号、非空」来界，而不是 `\w`。
     */
    for (const m of line.matchAll(PATH_IN_LINE)) {
      // ⚠️ **豁免只看「去掉所有路径之后」的文字**——见上面那段注释。
      const withoutPaths = line.replace(PATH_IN_LINE, '');
      if (!existsSync(join(ROOT, m[1])) && !DELETED.test(withoutPaths)) {
        broken.push({ line: i + 1, path: m[1], gate: cells[0] ?? '' });
      }
    }
  }
  console.log('');
  console.log('台账里点名的路径是否还在（4e）');
  console.log('─'.repeat(64));
  if (broken.length > 0) {
    problems.push(
      '台账里点名了这些文件，而它们**不存在、那一行也没说为什么**：\n'
      + broken.map((b) => `        第 ${b.line} 行 ${b.gate} → ${b.path}`).join('\n') + '\n'
      + '    → 4d 刚把台账里的「注入什么」换成具体路径，**而具体路径会过期**。\n'
      + '    修文件，或在那一行写明「已删 / 已改名」。',
    );
    console.log(`  ✗ ${broken.length} 处路径不存在且无说明`);
  } else {
    console.log('  ✓ 台账里点名的路径都还在，或那一行明说了它没了');
  }
}

/*
 * ── 4f. 每道**扫 `scripts/` 源码**的门禁，都必须排除 `*.mutations.mjs` ────
 *
 * ⚠️ **2026-09-29 实测撞到过一次，代价是「干净态就红」。**
 *
 * 我给判据 6 写一条「`src/content` 不再递归」的变异，
 * 而那条变异的 `replace` 里写着「遍历一个内容目录」那个调用——
 * **而 `check-field-coverage` 有一条判据扫的正是这个形状。**
 * 注释被剥掉后，**字符串字面量与真调用逐字相同**。
 *
 * > **变异脚本天生握着别的门禁判据要看的形状**——
 * > 而它并不「自己遍历内容目录」，它只是**在描述**那种遍历。
 *
 * 处置：`check-field-coverage` 补上了排除。**而那三道早就排除了**——
 * 于是「不统一的那一处」在**第一次写变异时**才发作。
 *
 * 判据：**从文件系统扫出「哪些门禁读 `scripts/` 源码」**，
 * 逐个查它排不排除 `*.mutations.mjs`。
 *
 * ⚠️⚠️ **判据的形状被坑过一次：先量「有 readdirSync 的门禁」，
 * 报出 12 个「没排除」——而那 12 个扫的是 `dist` / `docs` / `src/content`，
 * **压根不读 `scripts/` 的源码**，所以不会误报。**
 * **「没排除」≠「会误报」**——那是我拿「有没有这个调用」当成了
 * 「这个调用扫的是哪里」。
 *
 * 所以判据要**先确定扫的是哪个目录**，再问排不排除。
 * 实测：**只有 2 道**门禁读 `scripts/` 源码。
 */
{
  const SCRIPTS = join(ROOT, 'scripts');
  const scansScripts = (src) =>
    /readdirSync\(\s*(?:scriptDir|SCRIPTS|join\([^)]*'scripts'\))/i.test(src);

  const offenders = readdirSync(SCRIPTS)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => {
      const src = readFileSync(join(SCRIPTS, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return { f, scans: scansScripts(src), excludes: src.includes('mutations') };
    })
    .filter((x) => x.scans && !x.excludes)
    .map((x) => x.f);

  const readers = readdirSync(SCRIPTS)
    .filter((f) => f.endsWith('.mjs'))
    .filter((f) => scansScripts(
      readFileSync(join(SCRIPTS, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, ''),
    )).length;

  console.log('');
  console.log('扫 scripts/ 源码的门禁是否排除了变异脚本（4f）');
  console.log('─'.repeat(64));
  if (offenders.length > 0) {
    problems.push(
      `这些门禁**读 \`scripts/\` 源码**，而没排除 \`*.mutations.mjs\`：\n`
      + offenders.map((f) => `        scripts/${f}`).join('\n') + '\n'
      + '    → 变异脚本里**描述**某个调用形状的字符串，会被当成真的调用。\n'
      + '    **代价是「干净态就红」**——而门禁说的那件事压根不存在（2026-09-29 实测）。',
    );
    console.log(`  ✗ ${offenders.length} 道没排除：${offenders.join('、')}`);
  } else {
    console.log(`  ✓ ${readers} 道读 scripts/ 源码的门禁都排除了变异脚本`);
  }
}

/*
 * ── 4g. 台账里**门禁自己报出来的实测值**，必须与现在跑出来的一致 ───────
 *
 * ⚠️ **这是 4d 之后第一处真正的数字漂移，而它是当场抓到的。**
 *
 * 2026-09-29 实测：台账里写着「一次性探针扫了 **48** 个单文件命令」，
 * 而 `check-command-scripts` 现在报的是「**62** 个命令，9 个与脚本名对不上」。
 * 分叉数没错（8），**总数从 48 涨到 59 了**——
 * 因为这几天加了十几道门禁，**而那一句没人核**。
 *
 * > 与「文档里的实测数字也是断言」同族，**但更隐蔽**：
 * > 那句话在**台账**里，而台账的规矩是「记事实」，**不是「记当前状态」**。
 *
 * ⚠️⚠️ **而判据的方向必须反过来。**
 *
 * 我先试的是**扫「现在/当前/当下 + 数字」的句子**——**3 句，全是误报**：
 * 一句是转述的过时理由、一句是耗时描述、一句是结论编号。
 *
 * > **判据太宽就变成噪声，而噪声会让人忽略真信号**——
 * > 而这里连一处真信号都没有（逐条看过：台账里没有「现在有 N 条」的门禁级声明）。
 *
 * 所以改成从**可重跑的那一侧**下手：**只核「门禁自己会报出来的那个数」**。
 * 这类句子有固定形状（「扫了 N 个」「检查了 N 个」），
 * **而它们的来源是门禁输出——重跑一遍就能对**。
 *
 * ⚠️ **只覆盖两张有登记的表**（命令数 / 锚点数）：
 * 那些数字的来源是**门禁输出**，而不是散文。
 * 新的登记要连「哪个命令能重算它」一起写，否则这条判据自己也变成手写清单。
 *
 * ⚠️⚠️⚠️ **而它只核台账那一份——同一个数字在仓库里被抄了 7 遍。**
 *
 * 2026-09-29 实测：「48 个单文件命令 / 8 个分叉」这个事实，
 * 当时出现在 **8 个地方**（台账 ×2、`check-gate-list` 的 `EXPECTED` ×1 与注释 ×1、
 * `check-command-scripts` 的文件头、`lib/command-scripts.mjs` 的文件头、
 * `check-single-literal` 的注释、`docs/cli.md` 的表格）。
 * 4g 抓到台账那 2 处，**其余 6 处要人自己记得改**——而我改完台账就差点忘了。
 *
 * * ⚠️ **「8」这个数我是数出来的，不是记的**（`grep -rl` 后按文件计数：
 * 台账 2、`check-gate-list` 2、其余 4 个文件各 1）。
 *
 * > **一个数字在八个地方写着，就要有八处都能被核对。**
 * > 否则修了一处，另七处继续骗人——**而读者读到的是任意一处**。
 * >
 * > 本条判据**明确不管那五处**。要管，就得让每个转述点都带上
 * > 「哪个命令能重算它」——**那是把转述变成结构化字段**，代价大得多。
 * > **选一个错的代价更小的，然后写明代价**（与判据 ④ 的处置同形）。
 */
{
  /**
   * **每一类可重算的数字：台账里的正则 + 怎么算出现在的值。**
   *
   * ⚠️⚠️ **2026-09-29 从两类扩到三类——因为量出来第三类也漂了。**
   *
   * 我原以为只有「命令数 / 分叉数」需要核，实测去扫那 6 处
   * 4g 管不到的转述点时，发现：
   *
   * | 那一类 | 台账写的 | 实测 |
   * |---|---|---|
   * | 命令数 | 48 | **59** |
   * | **变异条数** | **43** | **56** |
   * | **编排步数** | **33** | **43** |
   *
   * ⚠️ **后两类的漂移在台账之外的 4 个文件里也有**：
   * `docs/cli.md` 三处「33 步」、`check-gate-list` 的 `EXPECTED` 一处「43 条变异」。
   * **同一个数字抄多遍这件事本身没被任何东西核**——4g 只核台账。
   *
   * ⚠️ **而「33 步」这种历史记录不能核**：台账里也有
   * 「README 的『19 步』立刻被抓出来，而它早就是 23 步了」这类句子——
   * **那是在记当时发生过的事，核它反而是错的**。
   * 所以每条正则都要**排除明显是历史的写法**（见各处注释）。
   */
  const RECOMPUTABLE = [
    {
      what: '命令数',
      re: /(\d+)\s*个(?:单文件)?命令/g,
      min: 10,   // 排除「4 个命令」这类举例
      actual: () => {
        const m = CMD_SCRIPTS_OUT();
        return m ? { total: Number(m[1]), divergent: Number(m[2]) } : null;
      },
      keys: ['total'],
    },
    {
      what: '分叉数',
      re: /(\d+)\s*个(?:的)?(?:命令名与脚本名|与脚本名)对不上|(\d+)\s*个分叉/g,
      actual: () => {
        const m = CMD_SCRIPTS_OUT();
        return m ? { total: Number(m[1]), divergent: Number(m[2]) } : null;
      },
      keys: ['divergent'],
    },
    {
      /*
       * ⚠️ **变异条数是从变异脚本自己数出来的**——
       * 而**数的方式必须与它报告的方式一致**。
       * `new-gates.mutations.mjs` 最后打印 `ok/CASES.length`，
       * 所以权威值是 `CASES` 的长度，**不是**「有多少个左花括号」也不是「有多少行 why」。
       */
      what: '变异条数',
      /*
       * ⚠️⚠️ **第一版只写「(\d+) 条变异」，报出 4/30/34 三处，全是历史记录。**
       *
       * 台账里那些是「34 条变异里 2 条一直假红」——**它记的是当时发生过的事**，
       * 核它反而是错的（那件事已经过去了，而数字会一直变）。
       *
       * > **历史记录与现状声明在字面上完全一样**——
       * > 唯一的区别是**它前面有没有「现在有多少」那类词**。
       *
       * 所以只认**紧跟着一个现状标志**的写法（「共 / 全部 / 现有 / 目前是 N 条」）。
       * ⚠️ 而这**必然漏**：将来有人写一句不带标志的现状声明，就核不到。
       * **这是「判据太宽变噪声」与「判据太窄漏」之间选的后者**——
       * 因为噪声会让人忽略真信号，而漏报只是漏报。
       */
      re: /(?:共|全部|现有|目前是)\s*(\d+)\s*条变异/g,
      actual: () => {
        const src = readFileSync(join(ROOT, 'scripts', 'new-gates.mutations.mjs'), 'utf8');
        // ⚠️ **必须 `lastIndexOf`**——变异脚本里那段算 `MUT_COUNT` 的自省代码
        // **也含 `const CASES = [` 这个字符串**，而 `indexOf` 会找到**它自己**，
        // 于是数出 0 条，而 4g 把 0 当成「台账写 58、实测 0」。
        //
        // > **「数一个字符串」在「那个字符串也出现在别处」时会数到自己**——
        // > 而症状是「0」，看上去像一个合法的实测值。
        const i = src.lastIndexOf('const CASES = [');
        const end = src.indexOf('\n];', i);
        if (i < 0 || end < 0) return null;
        return { total: (src.slice(i, end).match(/^  \{$/gm) ?? []).length };
      },
      keys: ['total'],
    },
    {
      what: '编排步数',
      /*
       * ⚠️ **只认「N 步」紧跟着「verify:all / 全部 / 全」的那种**——
       * 台账里「19 步」「23 步」那些是**历史记录**
       *（记当时 README 写的数、以及它被抓出来的过程），**核它反而是错的**。
       */
      // ⚠️ **`verify:all` 与「有」之间隔着反引号与加粗星号**
      // （台账写的是 `` `verify:all` **有 43 步** ``），所以那几样要一并容许。
      re: /(?:共|全部|现有|目前是)\s*(\d+)\s*步|verify:all`?\s*\**\s*有\s*\**(\d+)\s*步/g,
      actual: () => ({ total: steps.length }),
      keys: ['total'],
    },
  ];

  console.log('');
  console.log('台账里门禁自报实测值的对账（4g）');
  console.log('─'.repeat(64));

  for (const item of RECOMPUTABLE) {
    const claimed = [...ledgerText.matchAll(item.re)]
      .map((m) => Number(m[1] ?? m[2]))
      .filter((n) => Number.isInteger(n) && (!item.min || n >= item.min));
    const got = item.actual();
    if (!got) {
      problems.push(
        `**「${item.what}」的重算途径失效了**——本判据靠它取实测值。\n`
        + '    → 而**「查不动」与「对得上」在输出上完全一样**（形态四的变体）。',
      );
      console.log(`  ✗ ${item.what}：重算失败，4g 此刻核不到它`);
      continue;
    }
    const bad = [...new Set(claimed.filter((n) => !item.keys.some((k) => got[k] === n)))];
    if (bad.length > 0) {
      problems.push(
        `台账里「${item.what}」写着 **${bad.join(' / ')}**，而现在算出来是 **${item.keys.map((k) => got[k]).join(' / ')}**。\n`
        + '    → 那是**门禁自己报出来的数**，重算一遍就能对，**而它漂了没人发现**。\n'
        + '    改台账（若那几句记的是历史事实，就写清是哪一天）。',
      );
      console.log(`  ✗ ${item.what}：台账写 ${bad.join('/')}，实测 ${item.keys.map((k) => got[k]).join('/')}`);
    } else {
      console.log(`  ✓ ${item.what}：${[...new Set(claimed)].join('/') || '（台账里没这个说法）'} 与实测一致`);
    }
  }
}

// ── 5. 文档里转述的步骤数与实际一致 ────────────────────────────
/*
 * **两份文档，不是一份。**
 *
 * 第一版只查 `docs/cli.md`，于是 `README.md` 的「实测数据」表里
 * 「**19 步**」一直没人管——而它早就是 23 步了。
 *
 * > **加了检查却只覆盖一个文件，等于给「另一处会漂」发了通行证。**
 *
 * 两份的写法不同，所以判据分两种：
 *   - `docs/cli.md`：逐条列出步骤 → 逐位比对名字与顺序；
 *   - `README.md`：只写「N 步」 → 比对那个数。
 * 两种都**必须核**：数字会漂，而读者正是照它判断「我该跑多少道检查」。
 */
const knownNames = new Set(EXPECTED.map(([e]) => e.replace(/^npm run /, '').replace(/^npm /, '')));
const README = 'README.md';
const DOCS_WITH_STEP_COUNT = ['docs/cli.md', README];

for (const docPath of DOCS_WITH_STEP_COUNT) {
  const full = join(ROOT, docPath);
  if (!existsSync(full)) {
    problems.push(`${docPath} 不存在——它转述了 verify:all 的步数，缺了就无法核对`);
    continue;
  }
  const text = readFileSync(full, 'utf8');
  const line = text.split('\n').find((l) => l.includes('`npm run verify:all`') && l.includes('→'));

  if (docPath === README) {
    // README 不逐条列步骤，只写「N 步」与「其中 M 道是负向验证」——那两个数都要核。
    // ⚠️ 2026-09-24 实测：加了本检查后，README 的「19 步」立刻被抓出来
    //（实际已是 23），而同一行里的「两道负向验证」**也**是错的（实际三道）——
    // **只核一个数，另一个照样漂。**
    const count = /\*\*(\d+)\s*步\*\*/.exec(text);
    if (!count) {
      problems.push(
        `${docPath} 里找不到「N 步」这个说法。\n` +
          `    本检查靠它核对文档有没有跟上编排——**找不到就当没写这一段**。`,
      );
    } else if (Number(count[1]) !== steps.length) {
      problems.push(
        `${docPath} 里写「**${count[1]} 步**」，而 verify:all 实际是 ${steps.length} 步。\n` +
          `    **转述的数字会漂**，而读者照它判断该跑多少道检查。`,
      );
    }

    /*
     * 负向验证有几道：**显式枚举**，不从名字猜。
     *
     * ⚠️ 第一版想用「脚本名里含 mutation」来数——**那是字面量判据**，
     * 结果只数出 1 道（`verify:site-mutations`），
     * 而另外两道叫 `verify:exit-codes` 与 `verify:migrate`，名字里没有那个词。
     * **和本轮前几次一样的病：用能看见的那部分去推全貌。**
     *
     * 判据的正则也写错过一次：README 那句是
     * 「**会先弄坏自己再证明能报红**」，而我只写了前半句 → 永远不匹配 → 静默放过。
     * **断言要匹配真实输出，而不是匹配你记得的那句话。**
     */
    const NEGATIVE_VERIFICATIONS = [
      'verify:site-mutations',
      'verify:exit-codes',
      'verify:migrate',
      'verify:json-mutations',
      'verify:second-site-real-mutations',
      'verify:retrieval-gates',
    ];
    const missing = NEGATIVE_VERIFICATIONS.filter((n) => typeof scripts[n] !== 'string');
    if (missing.length > 0) {
      problems.push(
        `本检查以为存在这些负向验证，但 package.json 里没有：${missing.join('、')}。\n` +
          `    **要么补上，要么从这里删掉**——两者都要有个明确决定，` +
          `否则「有几道负向验证」这个数会从一个没人维护的清单里来。`,
      );
    }
    /*
     * ⚠️ **第二个错：文档里写的是中文数字。**
     *
     * 第一版用 `/其中(\d+)道是…/`，而 README 那句是「其中**三**道」——
     * `\d` 只匹配 0-9，**「三」是汉字（U+4E09）**，于是永远不匹配，
     * 判据静默放过了所有漂移。
     *
     * > 写断言时该做的是**先看一眼那行现在到底写了什么**，
     * > 而不是写一个「它大概会那样写」的正则。
     * > 这次是先做了变异（改成「九道」）却没报，才回头查的——
     * > **变异验证又一次抓到了正向跑不出来的错。**
     */
    const CN_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const claimed = /其中([一二三四五六七八九])道是\*\*会先弄坏自己/.exec(text);
    if (!claimed) {
      // 没写就不报：这一句是可选的说明，不该因为它没写就红
    } else {
      const said = CN_DIGITS[claimed[1]];
      if (said !== NEGATIVE_VERIFICATIONS.length) {
        problems.push(
          `${docPath} 里写「其中 ${said} 道是负向验证」，而清单里是 ${NEGATIVE_VERIFICATIONS.length} 道。\n` +
            `    判据来自本文件的 NEGATIVE_VERIFICATIONS 清单，不来自文档自身。`,
        );
      }
    }
    continue;
  }

  {
    /*
     * 只取**反引号里**的步骤名。
     * ⚠️ 第一版按 `→` 切整行，于是表格行首尾（`| npm run verify:all | **19 步**…`）
     * 也被算成一步——**切分范围不对，判据就废了**。
     */
    const names = [...line.matchAll(/`([\w:.-]+)`/g)]
      .map((m) => m[1])
      .filter((n) => n === 'npm' || /^(verify|wiki|check):/.test(n) || knownNames.has(n))
      .map((n) => n.replace(/^npm run /, '').replace(/^npm /, ''))
      .filter((n) => knownNames.has(n));
    const expectedNames = EXPECTED.map(([e]) => e.replace(/^npm run /, '').replace(/^npm /, ''));
    if (names.length !== expectedNames.length || names.some((n, i) => n !== expectedNames[i])) {
      problems.push(
        `${docPath} 里列的 verify:all 步骤与实际不一致。\n` +
          `    文档写：${names.join(' → ')}\n` +
          `    实际是：${expectedNames.join(' → ')}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处问题。\n`);
  process.exit(1);
}
console.log(`  ✓ ${steps.length} 步齐全、顺序正确、脚本都存在`);
console.log('  ✓ 没有「定义了却不在编排里」的门禁');
console.log(`  ✓ ${NOT_IN_ALL.size} 条豁免理由都含可验证的引用（命令 / 文件 / 步骤）`);
console.log('  ✓ CI 的 test 分支与完整门禁接线均被负向验证');
console.log(`  ✓ ${DOCS_WITH_STEP_COUNT.join(' 与 ')} 转述的步数与实际一致\n`);
