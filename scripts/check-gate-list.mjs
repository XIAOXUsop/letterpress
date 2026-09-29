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
 * 这条检查量 12 件事，分两套编号：
 *
 * | 编号 | 量什么 |
 * |---|---|
 * | `1`–`5` | 步骤数量与顺序、脚本存在、豁免理由、文档转述的步数 |
 * | `4b`–`4k` | 负向验证覆盖、台账可复现性与会漂的数字、扫源码的门禁的排除规则、变异脚本自身的收尾断言 |
 *
 * ⚠️ **没有 `4a`**——而这行注释原先写着「4a 到 4g 各是一条」。
 * **「文档里写的编号」与「实际编号」对不上**，而那是本项目栽过多次的形状。
 * ⚠️ 而 `4b` 想核的「每条判据有没有对应变异」**至今做不到**——
 * 它只认 `mustMatch: [` 那种形状，而这 12 条**一条都不在那个形状里**。
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
import { sliceArrayLiteral } from './lib/array-literal.mjs';

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
/**
 * 从一条 npm 脚本的定义里**抽出它指向的那个 `.mjs` 文件名**。
 *
 * ⚠️⚠️ **这个形状在 2026-09-29 之前被写了 4 遍**（判据 3、4c、4i、scriptOf 各一份），
 * 而**它们 4 处都不认中文文件名**——
 * `/node (scripts/[w.-]+.mjs)/` 里的 `w` **是 ASCII**。
 *
 * > 我为判据 3 写的那条变异注入了一个**中文**的假路径，
 * > 门禁**照样绿**——而我先读成「判据失效」，
 * > 真相是**它压根没看见那个路径**（形态四：「查不到」≠「没有」）。
 * >
 * > **而那不是变异的问题，是判据的真盲点**：
 * > 判据 3 声称核「脚本文件存在」，**而一个中文名的脚本它核不了**。
 *
 * 所以：**路径段用「非引号、非空白」来界**，不用 `w`。
 */
const scriptPathOf = (def) =>
  /node (scripts\/[^\s"']+\.mjs)/.exec(def ?? '')?.[1];

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
  ['npm run verify:retrieval-gates', '**五道检索闸逐一失效，每次金标都变红**（它们曾经被「这道闸有人在量」想当然）'
    + '。⚠️ **它其实是一个负向验证脚本**（`retrieval-gates.mutations.mjs`）——**而命令名看不出来**'],
  ['npm run verify:impact', '影响分析金标（9 条）'],
  ['npm run verify:answers', '**答案能定位到证据**（阶段 3 退出条件 ③）'],
  ['npm run verify:review', '**wiki:review 说的复核状态与 frontmatter 一致**（它原先全报「未复核」）'],
  ['npm run verify:portability', '核心模块可加载性 + 可选链形状'],
  ['npm run check:site-agnostic', '**站点事实可由调用方覆盖**（阶段 4 第 6 项）'],
  ['npm run verify:site-mutations', '上一道门禁的负向验证（把它依次弄坏四次，每次都必须真红）'],
  ['npm run check:exit-codes', '**CLI 错误码都已归类**（阶段 4 第 3 项）'],
  ['npm run verify:exit-codes', '上一道门禁的负向验证（三种漏法：字面 1、拼错常量名、未登记的数字）'
    + '。⚠️ **命令名里没有 `-mutations`**，而它指向的是 `exit-codes.mutations.mjs`'],
  ['npm run verify:json-output', '**`--json` 模式下失败也有结构化输出**（阶段 4 第 3 项剩的一半）'],
  ['npm run verify:json-mutations', '上一道的负向验证（三类违约：stdout 空 / ok 不是 false / code 与退出码打架）'],
  ['npm run verify:migrate', '**v1 → v2 迁移的诊断够不够精确**（5 种坏法，阶段 4 退出条件第二半）'
    + '。⚠️ **命令名里没有 `-mutations`**，而它指向的是 `migrate-manifest.mutations.mjs`'],
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
  // ⚠️ **走 `scriptPathOf` 而不是自己再写一遍正则**——2026-09-29 实测
  // 这一处曾单独保留旧写法，于是中文文件名它看不见（而门禁照样绿）。
  const file = scriptPathOf(scripts[name]);
  if (file && !existsSync(join(ROOT, file))) {
    problems.push(`「${name}」指向的脚本文件不存在：${file}`);
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
/*
 * ⚠️⚠️ **这张表原先只有一道——而编排里有 7 个变异脚本。**
 *
 * 2026-09-29 实测：把 `package.json` 的 scripts 与这张表并排打出来，
 * 看见「7 个变异脚本、1 条登记」——
 * **而表外那六个不是「没人验」，是「没人登记」**：
 * 它们的对应关系**在各自的文件名里自明**（`exit-codes.mutations` ↔ `check-exit-codes`）。
 *
 * > **「没人登记」与「没人验」在输出上完全一样**——
 * > 而这一条本来是**「哪道门禁有负向验证」的权威清单**。
 *
 * ⚠️ **两条不对得自明，都写明依据**：
 * - `migrate-manifest.mutations.mjs` 验的是**迁移诊断**——而它没有对应的
 *   `check-migrate.mjs`（迁移的判据在 `src/lib/cli/migrate.ts` 里，
 *   被 `verify:migrate` 自己检查）。**所以那一栏留空并写明原因**。
 * - `retrieval-gates.mutations.mjs` 验的是 **`check-questions.mjs`**
 *   （它自己文里写明：关掉一道检索闸，金标必须变红）。
 */
const GATES_WITH_MUTATIONS = [
  { gate: 'scripts/check-site-agnostic.mjs', mutations: 'scripts/site-agnostic.mutations.mjs' },
  { gate: 'scripts/check-exit-codes.mjs', mutations: 'scripts/exit-codes.mutations.mjs' },
  { gate: 'scripts/check-json-output.mjs', mutations: 'scripts/json-output.mutations.mjs' },
  { gate: 'scripts/check-second-site-real.mjs', mutations: 'scripts/second-site-real.mutations.mjs' },
  {
    gate: 'scripts/check-questions.mjs',
    mutations: 'scripts/retrieval-gates.mutations.mjs',
    why: '**它验的是检索金标**——关掉五道检索闸中的任何一道，`check-questions` 的金标必须变红。'
      + '（这两道是「闸」与「量闸的尺子」的关系，**不共用名字是故意的**。）',
  },
  {
    gate: '（无对应门禁脚本）',
    mutations: 'scripts/migrate-manifest.mutations.mjs',
    why: '**它验的是迁移诊断的精确度**，而迁移的判据在 `src/lib/cli/migrate.ts` 里，'
      + '**没有独立的 `check-migrate.mjs`**——所以这一行**故意留空**。',
  },
  {
    /*
     * ⚠️ **这一行是 2026-09-29 才补的——而补的正是「判定者自己」。**
     *
     * 把磁盘上的变异脚本与这张表并排打出来，发现 **7 个里有 1 个不在册**：
     * `new-gates.mutations.mjs`——**也就是本检查自己那个脚本**。
     *
     * > 而本文件头写着：「`4b` 正是**决定别人有没有被验**的那一道」——
     * > **而它自己没登记**，也就是**没人核「它有没有效」**。
     *
     * ⚠️ 它**不能**按「门禁 ↔ 变异脚本」的一对一登记（它验的是**十几道**门禁），
     * 所以那一栏写的是它自己；**理由要写明「它验的是一批、不是一道」。
     */
    gate: '（一批：`GATES` 数组里那一批）',
    mutations: 'scripts/new-gates.mutations.mjs',
    why: '**它验的不是一道门禁，是一批**（`GATES` 数组里那一批）——'
      + '所以一对一登记在这里不成立，那一栏写的是它自己。'
      + '⚠️ **而它是唯一一个「判定别人有没有被验」的脚本**，'
      + '**它自己有没有效同样要有人核**——见 `new-gates.mutations.mjs` 文件头的记述'
      + '（那一层的自查至今**未验**，是已登记的空白）。',
  },
];

/**
 * 4b 那一节的标题。
 *
 * ⚠️ **它是被 4h 核的那个对象**——所以**必须只有一处**。
 * 第一版它在 `console.log` 里写一遍、在 4h 里又抄一遍，
 * **而 4h 核的是「它有没有写明范围」**——
 * **同一句话写两遍，改一处就核到的是另一处**（形态八）。
 *
 * ⚠️ **而这个字符串本身是被改过的**：原话是
 * 「负向验证是否覆盖了被测门禁的**每一项**判据」，
 * 而实测它只遍历一张**只有一道**的登记表——
 * **「标题声称的范围」与「实际核到的范围」在输出上完全一样**。
 */
const SECTION_4B_TITLE =
  '负向验证是否覆盖了**有 REQUIREMENTS 式清单的**门禁的每一项判据';

console.log('');
console.log(SECTION_4B_TITLE);
console.log('─'.repeat(64));

for (const { gate, mutations } of GATES_WITH_MUTATIONS) {
  const gatePath = join(ROOT, gate);
  if (!existsSync(gatePath)) continue;
  const gateText = readFileSync(gatePath, 'utf8');
  // 判据条数 = `mustMatch: [` 的个数（每条判据一个）
  const criteria = (gateText.match(/mustMatch: \[/g) ?? []).length;
  if (criteria === 0) {
    /*
     * ⚠️⚠️ **2026-09-29 改了这一行的说法，而原说法在骗人。**
     *
     * 原来打印 `  – …：没有 REQUIREMENTS 式的判据清单，跳过`——
     * **一个 `–`，与上面那些 `✓` 只差一个符号**，
     * 而「没核」与「核过了」在语义上完全不同。
     *
     * > **「跳过」与「已核」在输出上几乎一样**（形态四的变体）——
     * > 而这一行是**唯一**会打「跳过」的地方。
     *
     * 现在改成明说：**本检查核不到它，而它由 4c 核**——
     * 4c 逐道问「有没有变异脚本覆盖 / 台账里有没有一行 / 登记过理由」，
     * **那是对每一道都问的**（本轮实测：编排里 44 道，4c 逐道给出去向）。
     *
     * ⚠️ 而**「4c 会核它」这件事必须写出来**——
     * 不然读者看到「跳过」只会以为**没人管它**。
     */
    console.log(
      `  – ${gate}：本检查核不到它（没有 \`mustMatch: [\` 式的判据清单，`
      + '数那些 `if` 不可信）；**它由 4c 核**——「有没有变异脚本覆盖它」',
    );
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
  /*
   * ⚠️⚠️⚠️ **第一版拿 `file: '…'` 当判据清单——而那不是清单。**
   *
   * 2026-09-29 实测：`check-site-agnostic.mjs` 里有 **3 个 `mustMatch: [`**
   *（真判据，每处一个 `{ pattern: /…/ … }` 对象）与 **3 个 `file: '…'`**
   *（**注释里举的例子**，讲「变异要改哪个文件」用的）。
   *
   * 两者**数目相同、内容无关**，而变异脚本碰巧都提到了那 3 个路径——
   * **于是「3 项判据都有对应变异」是巧合，不是「核过了」**。
   *
   * > **「数目对上了」与「逐项对应上了」在输出上完全一样**——
   * > 而这一条原本**从来没有真的核过任何东西**。
   *
   * 所以：**逐项对应按 `mustMatch` 的 `pattern` 走**——
   * **那才是判据本身**。而「变异脚本提到了它」用一个**可判的代理**：
   * **pattern 里的关键标识词**（取前若干个标识符）在变异脚本里出现过。
   *
   * ⚠️ **而这个代理不完美**：pattern 里的词若在变异脚本里以别的写法出现，就查不到。
   * **那必然漏**——而**漏比误报便宜**（误报会逼人改本来正确的门禁）。
   */
  const mustMatchPatterns = [...gateText.matchAll(/mustMatch: \[\s*\{[\s\S]*?pattern:\s*\/(.+?)\/[a-z]*/g)]
    .map((m) => m[1]);
  /** pattern 里的「标识符」——去掉正则语法，只留能当词用的部分。 */
  /**
   * pattern 里的「**标识符**」——而**不是所有英文单词**。
   *
   * ⚠️⚠️ **第一版不过滤，于是 `export` / `function` / `string` / `readonly`
   * 全被当关键词**——而它们**在任何 JS 文件里都存在**。
   * 于是「那一堆关键词都找到了」**也是巧合**，只是换了一种巧合。
   *
   * > **「匹配到了」与「匹配到了有意义的东西」在输出上完全一样。**
   *
   * 所以：**先剔掉 JS 关键字与内置类型名**。
   *
   * ⚠️ **而这仍是代理指标**：剩下的词若在变异脚本里以别的写法出现，就查不到。
   * **那必然漏**——而**漏比误报便宜**（误报会逼人改本来正确的门禁）。
   */
  const JS_NOISE = new Set([
    'export', 'function', 'return', 'string', 'number', 'boolean', 'readonly',
    'const', 'let', 'var', 'type', 'interface', 'class', 'new', 'this',
  ]);
  const keywordsOf = (pattern) =>
    [...new Set((pattern.match(/[A-Za-z_$][\w$]{3,}/g) ?? [])
      .map((k) => k)
      .filter((k) => !JS_NOISE.has(k)))];
  const requirementKeys = mustMatchPatterns
    .flatMap((p) => keywordsOf(p))
    /* ⚠️ **还要剔掉「只在 pattern 里、源码里并没有」的词**——
     * 比如 `ReadonlyMap` 出现在 `reservedPostRoutes?: ReadonlyMap<…>` 那个
     * pattern 里，而**它是**源码里的类型标注……
     * 而 `kind` / `site` 这类**到处都是**的词命中的概率接近 1。
     *
     * > **「匹配到了」与「匹配到了有意义的东西」在输出上完全一样**——
     * > 而这里唯一的分法是**要求这个词在该门禁源码里也真是一个标识符**。
     */
    .filter((k) => {
      const declared = new RegExp(`\\b(function|const|let|class|interface|type|readonly|export)\\s+[^\\n]{0,40}\\b${k}\\b`)
        .test(gateText);
      return declared || k.length >= 6;
    });
  const requirementFiles = requirementKeys;
  /*
   * ⚠️⚠️⚠️ **判据自己的中间量必须能被看见——2026-09-29 为此折腾了一整轮。**
   *
   * 那一刻发生的事：我按这段代码**在旁边复现**了一遍「它算出哪几个关键词」，
   * **得到 6 个**；而**门禁自己打印 9 个**。
   * **两个数不一致，而我完全不知道该信哪个**——
   * 于是我改了五处、猜了十几次、最后连「它到底跑的是哪段代码」都没定位到。
   *
   * 查清只花了一行：在 `requirementFiles` 后面打一个 `console.log`，
   * **然后跑一次门禁**。
   *
   * > **复现的是「我以为的代码」，而问题恰恰是它不是真的。**
   * > 而「打出来」核的是**它现在真的在跑的那份**——
   * > **这两件事只有后者能回答「它到底在算什么」。**
   *
   * 所以这一段是**判据的门禁自己的诊断**：
   * 设 `LP_DIAG_4B=1` 就会把它算出的那个集合打出来。
   * ⚠️ **默认不打**（那会污染 CI 的输出），
   * 而**「需要看时打一下」比「猜十几次」便宜得多**。
   */
  if (process.env.LP_DIAG_4B) {
    console.log(
      `  [诊断] 4b 算出的关键词（${requirementFiles.length} 个）：`
      + requirementFiles.join('、'),
    );
  }
  const uncovered = requirementFiles.filter(
    (f) => !mutText.includes(f),
  );
  if (uncovered.length > 0) {
    problems.push(
      `${gate} 的这些判据在 ${mutations} 里**没有任何变异点到**：\n` +
        uncovered.map((f) => `        ${f}`).join('\n') + '\n' +
        `    **「新增要手写」这句话原本没有任何东西守着**。`,
    );
    console.log(`  ✗ ${gate}：${uncovered.length} 个 pattern 关键词在变异脚本里没出现（${uncovered.join('、')}）`);
  } else {
    console.log(`  ✓ ${gate}：${criteria} 项判据，${requirementFiles.length} 个 pattern 关键词都能在变异脚本里找到`);
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
   * > 一个叫「不存在」的文件，永远不需要解释自己为什么不存在。
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
    {
      /*
       * ⚠️ **2026-09-29 加——因为「GATES 里有几道门禁」也被人手抄进了多处。**
       *
       * 我在 `GATES_WITH_MUTATIONS` 那一栏写「GATES 里的 15 道」，
       * 在 4b 的注释里写「15 个关键词」——**而 `GATES` 一直在变**
       *（上一轮就从 15 变到 16：加进了 `verify-negotiation.mjs`）。
       *
       * > **「15」这个字面量出现在三个文件里，而它们都不会提醒我它漂了。**
       * > 而 4g 已经在核「命令数 / 变异条数 / 编排步数」了——
       * > **同一种病，第三处不在核的范围内。**
       *
       * ⚠️ **数法必须与 `new-gates.mutations.mjs` 报的一致**：
       * 它打印的是 `GATES.length`，所以权威值是**那个数组的元素个数**，
       * 而**不是**「行尾有多少个字符串」。
       *
       * ⚠️ **而 `check-gate-list.mjs` 自己就在 `GATES_WITH_MUTATIONS` 的那一栏里**，
       * 所以这个正则若匹配到的是**注释里的历史记录**，就会自己把自己判红。
       * 因此 `re` **只认现状标志**（与上面三条同一处置），
       * 且**排掉「关键词」那处**——它是 4b 内部算法的一个中间量，
       * **与「有几道门禁」无关**（同一批数字里的另一个数）。
       */
      what: 'GATES 里的门禁数',
      re: /(?:共|全部|现有|目前是)\s*(\d+)\s*道|带\s*\**`?GATES`?\**\s*的\s*(\d+)\s*道/g,
      actual: () => {
        /*
         * ⚠️⚠️⚠️ **这个数法前两版都错，而两版都量出了「完全合法的数」。**
         *
         * ① **`indexOf` 找到了它自己**——本文件里另有一处
         *    `sliceArrayLiteral(...)` 的调用，而那个变量名是**字符串字面量**。
         *    `indexOf('const GATES = [')` 命中的是**那一行**，
         *    于是量出 **20**（而真值 16）。
         *    ⚠️ 而**同一个陷阱在 `new-gates.mutations.mjs` 里早被记过**
         *    （`MUT_COUNT` 用 `lastIndexOf`，注释写着「自省代码自己就含它」）——
         *    **同一个仓库里两处，一处记着，一处没记。**
         *
         * ② **「剔注释」用正则剔，会吃掉真实内容**——
         *    `check-single-literal.mjs` 这个**字符串**里含块注释的开头记号，
         *    于是那条剔注释的正则从那里一路吃到下一个块注释结束记号，
         *    **`GATES` 的后半段被当成注释删了**，
         *    而前半段（`GATE_COUNT` 那几行里的字面量）**被算成了条目**。
         *
         *    > **三个数（1 / 20 / 16）没有一个会报错**——
         *    > 而本文件记着的形态十二说「绿也可能是量法错了」；
         *    > **这里连绿都没有，只有三个数，而它们都长得像实测值。**
         *
         * 处置：共用 `lib/array-literal.mjs` 的 `sliceArrayLiteral`（用
         * **`lastIndexOf`**），数法是**数条目字面量**——
         * **不剔注释**，因为**注释里没有 `'*.mjs'` 这种形状的字面量**。
         */
        const s = sliceArrayLiteral('scripts/new-gates.mutations.mjs', 'GATES');
        if (!s) return null;
        return { total: (s.body.match(/'[\w.-]+\.mjs'/g) ?? []).length };
      },
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

/*
 * ── 4h. 4b 的**声称范围**必须与它实际核到的一致 ────────────────────────
 *
 * ⚠️ **2026-09-29 实测：4b 的标题在骗人。**
 *
 * 它打印的是「负向验证是否覆盖了被测门禁的每一项判据」——
 * 而它的循环只遍历 `GATES_WITH_MUTATIONS`，**实测那张表里只有一道**
 * （`check-site-agnostic`）。量出来：
 *
 * - 有 `mustMatch: [` 式清单的（4b 能核）：**2 个**（`check-gate-list`、`check-site-agnostic`）
 * - 没有清单的（4b 那个出口）：**46 个**
 *
 * > **「标题声称的范围」与「实际核到的范围」在输出上完全一样**——
 * > 读者读到「每一项判据」，会以为那 46 个平铺 `problems.push` 的脚本
 * > 也被核过了。**而它们一次都没进过那个循环。**
 *
 * 所以判据：**4b 的标题里若出现「每一项」/「所有」这类全称词，
 * 而它遍历的登记表门禁数 < 编排里的门禁数，就必须写明差在哪。**
 *
 * ⚠️ **而 4c 才是逐道核的那一道**（编排里 44 道它逐道给出去向）——
 * **所以这不是「没人管」，而是「管它的不是这一道」**，
 * **而那句话必须写在输出里**，否则读者以为那 46 个没人管。
 */
{
  const title = SECTION_4B_TITLE;
  const registered = GATES_WITH_MUTATIONS.length;
  const orchestration = new Set(
    steps
      .map((s) => /^npm run ([\w:-]+)$/.exec(s)?.[1])
      .filter(Boolean)
      .map((c) => (/node (scripts\/[\w.-]+\.mjs)/.exec(scripts[c] ?? '') ?? [])[1])
      .filter(Boolean)
      .filter((f) => !f.includes('mutations')),
  ).size;

  console.log('');
  console.log('4b 的声称范围（4h）');
  console.log('─'.repeat(64));
  const namesOut = /没有 .*式清单|有 REQUIREMENTS/.test(title);
  if (registered < orchestration && !namesOut) {
    problems.push(
      `4b 的标题声称核「每一项判据」，而它只遍历 ${registered} 道`
      + `（编排里有 ${orchestration} 道脚本门禁）。\n`
      + '    → **「标题声称的范围」与「实际核到的范围」在输出上完全一样**，\n'
      + '    而读者读到「每一项」会以为那些平铺 `problems.push` 的脚本也核过了。\n'
      + '    → 而 **4c 才是逐道核的那一道**——所以那句话必须写明。',
    );
    console.log(`  ✗ 4b 声称「每一项」而只遍历 ${registered}/${orchestration} 道`);
  } else {
    console.log(`  ✓ 4b 的标题已写明它只核「有 REQUIREMENTS 式清单的」那些（${registered} 道，编排里共 ${orchestration} 道）`);
    console.log(`    ⚠️ 而**其余 ${orchestration - registered} 道由 4c 逐道核**（有没有变异脚本覆盖 / 台账里有没有一行 / 登记过理由）——`);
    console.log('    **「本检查核不到」与「没人管」不是一回事。**');
  }
}

/*
 * ── 4i. 每道**有编号判据**的门禁，变异数不该少于判据数 ────────────────
 *
 * ⚠️ **这是 4b 那个「做不到」的最诚实版本。**
 *
 * 4b 想核「每条判据有没有对应变异」，而它只能对**一张 `mustMatch: [` 表**做
 * （逐项 `file` 对应）。**而本文件这 12 条判据不在那个形状里**——
 * 全仓库只有 2 个脚本有那种表。
 *
 * > **判据没有可数的清单，就数不出「几条判据」。**
 * > 而**数判据本身不可信**——4b 自己的注释写着
 * > 「用正则去数那些 `if` 会把错误分支的措辞也算进去」。
 *
 * 所以这里**换一个更弱但可信的口径**：**数「带编号的判据标题」**
 * （形如 `── 4c. ` / `── ② `），而**不试图逐项对应**。
 *
 * ## ⚠️⚠️ **这个口径的已知代价，必须写明**
 *
 * | 它能抓 | 它抓不到 |
 * |---|---|
 * | **某道门禁的变异数明显少于它的判据数** | 「4 条变异都在测前 2 条判据」 |
 * | （那是最常见的漏法） | 「一条变异其实一次测了多条判据」 |
 *
 * > **「数够」是必要条件，不是充分条件。**
 * > 而 4b 那个 `file` 逐项对应**是充分得多**——**但它要求门禁有那张表**，
 * > **而本项目 12 条判据都没有**。
 * >
 * > **要更强的保证，就得给每条判据一个可被引用的锚点**——
 * > 那是把注释变成配置，**代价大得多**。
 * > **选一个错的代价更小的，然后写明代价**（与判据 ④ 同一处置）。
 *
 * ⚠️ **而判据被显式关掉时（像 `check:release` 的 `CHANGELOG`），
 * 它仍在编号里** —— 所以「变异数少于它」可能只是**关掉的那几条**。
 * **所以这一条报的是「值得看一眼」，不是「一定有洞」**——
 * 它把差别摆出来，让人能判断，而**不是替人判断**。
 */
{
  const pkgJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const mutationText = readdirSync(join(ROOT, 'scripts'))
    .filter((f) => f.includes('mutations') && f.endsWith('.mjs'))
    .map((f) => readFileSync(join(ROOT, 'scripts', f), 'utf8'))
    .join('\n');

  const rows = [];
  for (const cmd of new Set(
    steps
      .map((s) => /^npm run ([\w:-]+)$/.exec(s)?.[1])
      .filter(Boolean),
  )) {
    const f = (/node (scripts\/[\w.-]+\.mjs)/.exec(pkgJson.scripts[cmd] ?? '') ?? [])[1]
      ?.replace(/^scripts\//, '');
    if (!f || f.includes('mutations') || !existsSync(join(ROOT, 'scripts', f))) continue;
    const text = readFileSync(join(ROOT, 'scripts', f), 'utf8');
    const criteria = new Set(
      [...text.matchAll(/──\s*([0-9]+[a-z]?|[①-⑤](?:[½⅔⅛])?)\.?\s/g)].map((x) => x[1]),
    ).size;
    if (criteria === 0) continue;
    /*
     * ⚠️⚠️ **第一版只数变异脚本，于是报出 5 道——而其中大部分**在台账里有手工记录**
     * （2026-09-29 实测：`verify:search` / `check:manifest-schema` /
     * `check:staged` 在台账里都有「✅ 红」的行）。
     *
     * > **「没有变异脚本」≠「没人验过」**——那是形态十一的反向，
     * > 而本项目栽过好几次。2026-09-24 那批门禁的验证**全是手工做的**，
     > 之后才固化成 7 个变异脚本。
     *
     * 所以数**两个来源**：变异脚本（机器可复现）+ 台账里那几行（人做过、记下了）。
     * ⚠️ **而台账里「有几行」不等于「覆盖了几条判据」**——
     * 那正是这个口径的代价，**写在这一条的判据说明里**。
     */
    /*
     * ⚠️⚠️ **第二版又栽在「怎么数台账那一列」上。**
     *
     * 第一版数 `ledgerText.split('`verify:search`')` 的长度——**全文出现次数**，
     * 于是它报「3 行台账」，而**表格里只有 1 行**（另两处在正文里被提及）。
     * **正文提及不是验证记录**——而这正是形态十一（形态十一的反向）：
     * **「提到了」被当成了「验过了」**。
     *
     * 所以只数**表格第一列**（形如 `| \`verify:search\` | …`）。
     *
     * > 而这**必然低估**：一条变异/一次验证**可以同时测多条判据**，
     * > 而表格是**按「注入了什么」一行行记的**，不是按判据。
     * > **所以这个数是下界**——而它与变异数相加当「验证条数」是**粗略的近似**。
     * > 这个代价写在上面那段「已知代价」里。
     */
    const inLedger = ledgerText
      .split('\n')
      .filter((l) => new RegExp(`^\\|\\s*\`${cmd}\``).test(l)).length;
    /*
     * ⚠️⚠️ **`covers` 优先于「数有几条变异」。**
     *
     * `covers: ['④']` 是变异作者**自己登记**的「我这条测的是哪几条判据」，
     * 而**数 target 的个数**只能回答「有几条」——**那正是 4i 那个口径的软肋**
     * （「一条变异一次测了多条判据」它数不出来）。
     *
     * 2026-09-29 实测能不能答上来：`check:release` 的 3 条变异逐条能答
     * （② / ④ / ⑤），**而 ① 与 ③ 零覆盖**——
     * **「3 条变异 / 5 条判据，差 1」那个「差 1」，靠数是看不出来的**：
     * ② 那条只测②、④ 那条只测④、⑤ 那条只测⑤，**3 条对 3 条判据**，
     * **剩下的 ①③ 才是真空白**。
     *
     * > **登记比数准**，因为它是**作者声明**而不是**代理指标**——
     * > 而「代理指标」这个教训本项目交过很多次学费
     * > （「变异数 ≥ 判据数」这个判断第一版就抓错了）。
     *
     * ⚠️ **而 `covers` 是可选的**：没登记的仍按「数 target」算，
     * **并在输出里标明是哪种口径**——否则两个口径的数字混在一起没法比较。
     */
    const target = `target: '${f}'`;
    const coveredIds = new Set();
    let hasCovers = false;
    for (const block of mutationText.split('\n  {')) {
      if (!block.includes(target)) continue;
      /*
       * ⚠️⚠️ **必须排除注释里的 `covers`——2026-09-29 实测栽在这。**
       *
       * 一条变异的**注释里**写着 `covers: ['⑤']`（举例子），
       * 而这条正则照样匹配它，于是**它被当成一条真登记**——
       * 而那个编号在那个门禁里不存在，**门禁立刻假红**。
       *
       * > **「描述」与「声明」在字面上完全一样**（都是 `covers: [...]`），
       * > 而**注释掉的那一份同样会被 grep 到**。
       *
       * 所以：**先把块注释与行注释剥掉**，再找 `covers`。
       */
      const code = block
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const m = /covers:\s*\[([^\]]*)\]/.exec(code);
      if (!m) continue;
      hasCovers = true;
      for (const id of m[1].matchAll(/['"]([^'"]+)['"]/g)) coveredIds.add(id[1]);
    }
    // ⚠️ **与上面那个 `criteria` 的正则必须一致**——
    // 第一版这里写的是 `──s*…`，而 `\s` 被 shell 吃掉一层变成了字面 `s`，
    // **于是它一个都匹配不到、`ownIds` 恒为空、后面那行「未覆盖的判据」永远不打印**。
    // 而症状是「输出里少了一行」——**不报错，只是少了**（形态四）。
    const ownIds = [...new Set([
      ...[...text.matchAll(/──\s*([0-9]+[a-z]?|[①-⑤](?:[½⅔⅛])?)\.?\s/g)].map((x) => x[1]),
      /*
       * ⚠️⚠️ **还要认「行内编号」——2026-09-29 实测漏了 3 条判据。**
       *
       * `check-gate-list` 的 `NOT_IN_ALL` 那个循环里，判据写成
       * `// ① 抽出所有 npm run` 这种**行内**形状，而上面那条只认
       * **段标题**（`// ── 4c. `）——**于是那 3 条（①②③）凭空消失**，
       * 而**那 5 条变异（第 1–5 条）正是测它们的**。
       *
       * > `check:release` 的 ①–⑤ 恰好是**段标题**，所以第一版对它**全部认到**——
       * > **同一个编号在两个文件里放法不同，而只认一种时另一种的判据就成了空白。**
       *
       * ⚠️ **必须限定在「行首是注释」**（行首两个斜杠）且编号后跟空格——
       * 否则正文里引用一个编号也会被数进去。
       *
       * ⚠️⚠️ **而上面那行注释里我本来写的是正则字面量**，
 * **而「反斜杠 s 星号」后面紧跟一个斜杠，就组成了块注释的结束符**——
       * **它当场闭合了这个块注释**，后两行变成了代码里的语法错误。
 * 这就是「块注释里绝不能出现结束符序列」那条——
       * **我在这份文件里已经犯过五次，这是第六次**，
 * **而描述这个坑时也不能写出那个序列**——我刚才就是这么自我复现的。
       * 而症状不是「编译报错」而是**后面几行被当成代码**（错误信息指向别处）。
       */
      ...[...text.matchAll(/^\s*\/\/\s*([①-⑤](?:[½⅔⅛])?)\s/gm)].map((x) => x[1]),
      /*
       * ③ **块注释里那种**（行首是星号）——2026-09-29 实测：
       * `②½` 与 `②⅔` 两条判据是这么写的，而前两种形状都认不到它们。
       *
       * > 于是 `covers: ['②½']` 会被报成「指向不存在的判据」——
       * > **而那条判据真的存在**。
       *
       * ⚠️ 判据编号一共**三种放法**（段标题 / 行内双斜杠 / 块注释内），
       * 而我**前两版都只认前两种**——
       * **「同一种编号，三种放法」**（上一轮是两种）。
       */
      ...[...text.matchAll(/^\s*\*\s*([①-⑤][½⅔⅛])\s/gm)].map((x) => x[1]),
    ])];
    rows.push({
      cmd,
      criteria,
      ownIds,
      muts: mutationText.split(target).length - 1,
      ledger: inLedger,
      hasCovers,
      coveredIds,
    });
  }

  /*
   * ⚠️⚠️ **`covers` 登记的判据号必须真存在——而这是一个新的失效面。**
   *
   * 登记一份「我这条测的是 ④」，而那个门禁**没有 ④**（作者记错了、
   * 或者那条判据被删了）——**那么登记看起来很认真，实际上一条也没测**，
   * 而 4i 数不出来。
   *
   * > **登记的「权威性」来自它能被核对**——
   * > 而「能数出来」不等于「核对过」。
   *
   * 所以：每条 `covers` 里的编号必须在**该门禁自己的编号判据集合**里。
   */
  {
    const orphans = [];
    for (const r of rows) {
      if (!r.hasCovers) continue;
      const file = scriptOf(r.cmd);
      if (!file) continue;
      // ⚠️⚠️ **必须复用 `ownIds` 的口径，不能自己再写一遍正则。**
      //
      // 2026-09-29 实测：这里原先只有「段标题」那一种形状，
      // 而上面那个 `ownIds` 已经认了三种——**于是同一个门禁的同一个编号，
      // 在「数判据」时被认到、在「校验 covers」时被判成不存在**。
      //
      // > **「一个事实两处实现」的最隐蔽形状**：
      // > 两处都不是错，**而它们不一致**——症状是「明明有那条判据却说没有」。
      const ids = new Set(
        r.ownIds,
      );
      for (const id of r.coveredIds) {
        if (!ids.has(id)) {
          orphans.push(`\`${r.cmd}\` 的 covers 写了 ${id} —— 而它没有 ${id} 这条判据`);
        }
      }
    }
    if (orphans.length > 0) {
      problems.push(
        '这些 `covers` 登记**指向不存在的判据**：\n'
        + orphans.map((o) => `        ${o}`).join('\n') + '\n'
        + '    → **登记看起来很认真，实际上一条也没测**——而 4i 数不出来。\n'
        + '    → 登记的权威性**来自它能被核对**：编号必须真在那个门禁里。',
      );
      console.log(`  ✗ ${orphans.length} 条 covers 指向不存在的判据`);
    } else {
      console.log('  ✓ 每条 covers 登记的判据号都真实存在');
    }
  }

  /** 有 `covers` 就用它（**作者声明**），否则退回「数」（**代理指标**）。 */
  const covered = (r) => (r.hasCovers ? r.coveredIds.size : r.muts + r.ledger);
  /**
   * ⚠️⚠️ **只报「明显不成比例」的——而这道阈值是量出来的。**
   *
   * 收紧台账计数后实测 4 道是「验证 < 判据」：
   * `verify:search`（2/4）、`check:manifest-schema`（1/3）、
   * `check:release`（4/5）、`check:staged`（0/3）。
   *
   * **而其中至少三道不是洞**：
   * - `check:release` 的 ③（CHANGELOG）**已显式关掉**（`SKIP_CHANGELOG`）；
   * - `check:staged` 的 3 条判据**同属一道自检**（暂存区/工作区/忽略文件），
   *   **一条注入就能同时测到**；
   * - `verify:search` 的第 4 条（JS 体积）**可能已被别的门禁的变异覆盖**。
   *
   * > **「差 1」是常态，「差一半且零变异」才是值得看一眼的。**
   * > 而**一道天天红的门禁没人会看**——那是判据太宽的代价，
   * > 本项目栽过好几次（「判据太宽就变成噪声，噪声让人忽略真信号」）。
   *
   * 所以阈值：**变异数为 0，且验证条数不到判据数的一半**。
   * 那样只剩 `check:staged`（0/3）与 `check:manifest-schema`（0/3）——
   * **而那两道的判据都同属一个自检流程**，**是该补变异还是该合并判据，是人的判断**。
   */
  /**
   * **明知不适用、而理由已写明的那些。**
   *
   * ⚠️ `check:staged` 是这里的第一条：它核的是**暂存区与工作区是否一致**，
   * 而**每一条针对它的变异都会「注入后本来就一致」**——
   * 变异改的是**工作区**，而它要抓的是「**暂存区那份**没跟着更新」。
   *
   * > **注入手段与被测对象不兼容**——那不是「没人验」，是**验不了**。
   * > 而「验不了」必须**写下来**，否则它与「忘了验」在输出上完全一样。
   *
   * ⚠️ 而登记在这儿的**每一条都要能回答「凭什么验不了」**——
   * 写不出来就说明只是懒得写，那该补变异。
   */
  const NOT_VERIFIABLE = new Map([
    ['check:staged', '它核的是**暂存区那份**与工作区是否一致，而**变异注入的正是工作区**——'
      + '注入后两者「本来就不一致」，而那正是它要抓的：'
      + '**注入手段与被测对象不兼容**，不是「没人验」。'
      + '（这也是 4c 里 NO_MUTATION 登记的那一条，理由相同。）'],
    ['check:manifest-schema', '它读的是**产物**（`dist/content-manifest.json`），'
      + '而**没有变异脚本会去改产物**（改了构建就重建了）——'
      + '要覆盖它得先有一个能稳定地产生「不符合 schema 的产物」的手段，'
      + '**而那需要先有那条判据的负向验证设计**。'],
  ]);
  const RATIO = 0.5;
  const short = rows.filter(
    (r) => r.muts === 0 && covered(r) < r.criteria * RATIO && !NOT_VERIFIABLE.has(r.cmd),
  );
  // ⚠️ **排除 `NOT_VERIFIABLE` 里那些**——它们已经单独打过一行「验不了」，
  // 在「差不多」里再列一次是**同一件事说两遍**（形态八）。
  const borderline = rows.filter(
    (r) => covered(r) < r.criteria && !short.includes(r) && !NOT_VERIFIABLE.has(r.cmd),
  );
  console.log('');
  console.log('每道门禁的「验证条数 vs 编号判据数」（4i）');
  console.log('─'.repeat(64));
  console.log(`  ${rows.length} 道有编号判据；${borderline.length} 道验证略少于判据、${short.length} 道明显不成比例`);
  console.log(`    （验证条数 = 变异脚本的 target 数 + 台账**表格第一列**里提到它的那几行）`);
  console.log(`    ⚠️ 阈值是「**零变异**且**不足一半**」——「差 1」是常态，报它只会变成噪声。`);
  for (const [cmd, why] of NOT_VERIFIABLE) {
    // ⚠️ **不截断**——理由被截断就等于「没说清」，而那正是本条要防的东西。
    console.log(`  – ${cmd}：**验不了**——${why}`);
  }
  for (const r of borderline) {
    // ⚠️ **标明是哪种口径**——两个口径的数字**混在一起就没法比较**。
    const how = r.hasCovers ? `登记覆盖 {${[...r.coveredIds].join('、')}}`
      : `${r.muts} 条变异 + ${r.ledger} 行台账`;
    const missing = r.hasCovers ? r.ownIds.filter((id) => !r.coveredIds.has(id)) : [];
    console.log(
      `  – ${r.cmd}：${r.criteria} 条判据 vs ${how}（**差不多**）`
      + (missing.length
        ? `\n      ⚠️ 登记里**没有**的判据：${missing.join('、')}`
        : ''),
    );
  }
  if (short.length > 0) {
    problems.push(
      '这些门禁**一条变异都没有，而它的判据数明显多于已有的验证记录**：\n'
      + short.map((r) => `        ${r.cmd}：0 条变异 + ${r.ledger} 行台账 / ${r.criteria} 条判据`).join('\n') + '\n'
      + '    → 而 **4b 核不了它们**（它只对有 `mustMatch: [` 表的门禁做逐项对应，\n'
      + '    **而本项目这十几条判据一条都不在那个形状里**）。\n'
      + '    → **但这仍不一定是有洞**：那些判据可能同属一道自检\n'
      + '    （一条注入就能同时测到），或已被**别的**门禁的变异覆盖。\n'
      + '    → **补变异还是合并判据，是人的判断**——本检查只把差别摆出来。\n'
      + '    → 要更强的保证，得给每条判据一个**可被引用的锚点**。',
    );
    for (const r of short) {
      console.log(`  ✗ ${r.cmd}：0 条变异 + ${r.ledger} 行台账 / ${r.criteria} 条判据`);
    }
  } else {
    console.log('  ✓ 没有「零变异且明显不成比例」的门禁');
  }

  /*
   * ── 4j. 磁盘上的**每个**变异脚本都必须在这张表里 ──────────────────────
   *
   * ⚠️ **2026-09-29 实测：7 个变异脚本里 1 个不在册**——
   * 而那一个是 \`new-gates.mutations.mjs\`，**也就是本检查自己那个**。
   *
   * > 而本文件头写着「4b 正是**决定别人有没有被验**的那一道」——
   * > **而它自己没登记**，也就是**没人核「它有没有效」**。
   *
   * 而上面那个循环对「gate 那一栏不是脚本路径」的行是
   * \`if (!existsSync(gatePath)) continue;\`——
   * **静默跳过**，**而「静默」与「核过了」在输出上完全一样**。
   *
   * 所以这一条单列：**从文件系统扫出全部 \`*.mutations.mjs\`，
   * 逐个问「这张表里有没有它」**。
   *
   * ⚠️ **而这判的是「有没有登记」不是「有没有效」**——
   * 后者至今**无人验证**（见 \`new-gates.mutations.mjs\` 文件头），
   * **那是本项目已知最大的空白**。
   */
  {
    const onDisk = readdirSync(join(ROOT, 'scripts'))
      .filter((f) => f.includes('mutations') && f.endsWith('.mjs'));
    const listed = new Set(
      GATES_WITH_MUTATIONS.map((g) => g.mutations.replace(/^scripts\//, '')),
    );
    const missing = onDisk.filter((f) => !listed.has(f));
    console.log('');
    console.log('变异脚本是否都在 4b 的册子里（4j）');
    console.log('─'.repeat(64));
    if (missing.length > 0) {
      problems.push(
        `这些变异脚本**在磁盘上，却不在 4b 的册子里**：\n`
        + missing.map((f) => `        scripts/${f}`).join('\n') + '\n'
        + '    → **「没登记」与「没人验」在输出上完全一样**——\n'
        + '    而这张表是**「哪道门禁有负向验证」的权威清单**，\n'
        + '    **漏登记 = 那套验证在清单上不存在**。\n'
        + '    → 加进 `GATES_WITH_MUTATIONS`（若它验的不是一道门禁，\n'
        + '    **把那一栏写清它验的是谁/哪一批，并写明理由**）。',
      );
      console.log(`  ✗ ${missing.length} 个变异脚本没在册：${missing.join('、')}`);
    } else {
      console.log(`  ✓ 磁盘上 ${onDisk.length} 个变异脚本都在册里`);
    }

    /*
     * ── 4k. 每道变异脚本都必须有「跑完之后工作区没变」那条断言 ────────────
     *
     * ⚠️ **2026-09-29 实测：七道里只有一道有**——
     * `new-gates.mutations.mjs`（2026-09-28 加的，因为那次「2 条一直假红」）。
     * 另外六道的收尾只问「被测门禁还绿吗」，**不问「我改了什么」**，
     * **而这两件事在输出上完全一样**。
     *
     * ⚠️ **而代价最高的那一道恰恰没有**：
     * `retrieval-gates.mutations.mjs` 改的是**生产源码**
     * `src/lib/wiki/retrieve.ts`——七道里唯一一个碰 `src/` 的。
     *
     * ⚠️ **判据不能只搜「那句断言的字面」**——七道接的是
     * `lib/worktree-assert.mjs` 的 `diffWorktree(...)`，
     * 而**共用一个实现**正是这里想要的（一份逻辑、七处调用）。
     * 所以判据问的是**「有没有调那个共用函数」**。
     *
     * ⚠️ **而「调用了」不等于「结果被采用了」**——
     * 少写一个失败分支，那道脚本照样报「干净」。
     *
     * ⚠️⚠️⚠️ **第一版的判据写错了，而它是绿的——**被自测当场抓住**。**
     *
     * 我写的是「核 `if (!ok)` 那一形」，而**七道脚本全都写的是**
     * `{ const { ok, report } = diffWorktree(WORKTREE); if (!ok) … }`
     * ——**解构之后变量就叫 `ok`**。所以那条正则**一条都没匹配上**，
     * 于是 `noWorktree` **永远是空的**，4k **报「✓ 7 道都有」**。
     *
     * > **「判据压根没在看」与「它核过且都合格」在输出上完全一样。**
     * > 而这是我 2026-09-28 记过的那一条（4b 曾经从来没真核过任何东西），
     * > **换成 `mustMatch` 那一版的形状，栽的是同一个坑。**
     *
     * 所以判据改成**「解构出那个变量名，然后核那个名字进了否定分支」**——
     * **从被测文件里推出变量名，而不是假设它是 `ok`。**
     * 这也顺带覆盖了 `if (!r.ok)`（不解构）那一种写法。
     *
     * **这仍是代理指标**（真要确定，得把断言弄坏一次看它红不红），
     * **而漏比误报便宜**——判据太宽会逼人改本来正确的脚本。
     */
    const noWorktree = [];
    for (const f of onDisk) {
      const src = readFileSync(join(ROOT, 'scripts', f), 'utf8');
      const call = /diffWorktree\s*\(\s*([A-Z_][\w.]*)\s*\)/.exec(src);
      if (!call) { noWorktree.push(f); continue; }
      /*
       * ⚠️ **解构出来的名字**才是失败分支里该用的那个——
       * 而 `if (!ok)` 这种**字面量**只认一种写法（2026-09-29 栽的就是它）。
       */
      const destr = new RegExp(
        `const\\s*\\{([^}]*)\\}\\s*=\\s*diffWorktree\\s*\\(\\s*${call[1]}\\s*\\)`,
      ).exec(src);
      const names = destr
        ? destr[1].split(',').map((s) => s.split(':').pop().trim()).filter(Boolean)
        : [];
      const hasFailBranch =
        names.some((n) => new RegExp(`!\\s*${n}\\b`).test(src))
        || /!\s*\w+\s*\.\s*ok\b/.test(src);
      if (!hasFailBranch) {
        noWorktree.push(`${f}（调了但没进失败分支）`);
      }
    }
    console.log('');
    console.log('每道变异脚本都有「工作区没变」断言（4k）');
    console.log('─'.repeat(64));
    if (noWorktree.length > 0) {
      problems.push(
        `这些变异脚本**没有「跑完之后工作区没变」那条断言**：\n`
        + noWorktree.map((f) => `        scripts/${f}`).join('\n') + '\n'
        + '    → **「门禁绿了」与「我没把工作区改脏」在输出上完全一样**。\n'
        + '    → 而残留的后果是**结论作废**：门禁红是真的红，'
        + '**而那红可能来自上一次没还原干净的文件**。\n'
        + '    → 接 `lib/worktree-assert.mjs` 的 `diffWorktree(WORKTREE)`，'
        + '**并把 `!ok` 接进失败分支**。',
      );
      console.log(`  ✗ ${noWorktree.length} 个没有：${noWorktree.join('、')}`);
    } else {
      console.log(`  ✓ ${onDisk.length} 道都有，且都接进了失败分支`);
    }

    /*
     * ── 4k 自测：**判据自己也要先被验一遍** ──────────────────────────────
     *
     * ⚠️ 形态十一：「绿」既可能是「它没看见」，也可能是「压根没被喂进去」。
     * 而本项目栽过两次假绿（2026-09-28：锚点根本不存在，注入压根没发生；
     * 2026-09-29：探针在跑之前就建好，于是它进了前后两份快照）。
     *
     * > **而 4k 的判据是两条正则**——它**极可能**在某天因为
     * > 某道脚本换了个写法而**一条都匹配不上**，**而那时的输出是
     * > 「✓ N 道都有」**，与「每道都真的接上了」逐字相同。
     *
     * 所以造三份**临时语料**（在内存里，不碰磁盘上的脚本）跑同一段判据：
     * 完全没接 / 调了但没进失败分支 / 真的接了。**三个数必须分别是 2 / 1 / 0。**
     *
     * ⚠️ **而第三份语料是最要紧的**——它对应「判据在正常状态下长什么样」。
     * **若第三份也报缺，那这条判据在正常状态下就会误报**，
     * 而误报会逼人去拆掉本来正确的接线（判据收紧时必须先证不误报）。
     */
    const judge = (src) => {
      const call = /diffWorktree\s*\(\s*([A-Z_][\w.]*)\s*\)/.exec(src);
      if (!call) return false;
      const destr = new RegExp(
        `const\\s*\\{([^}]*)\\}\\s*=\\s*diffWorktree\\s*\\(\\s*${call[1]}\\s*\\)`,
      ).exec(src);
      const names = destr
        ? destr[1].split(',').map((s) => s.split(':').pop().trim()).filter(Boolean)
        : [];
      return names.some((n) => new RegExp(`!\\s*${n}\\b`).test(src))
        || /!\s*\w+\s*\.\s*ok\b/.test(src);
    };
    const SAMPLES = [
      ['完全没接', 'const a = 1;\n', false, '一份没写任何接线的脚本'],
      ['调了但没进失败分支',
        'const r = diffWorktree(W);\nconsole.log(r);\n', false, '调了但结果被丢掉'],
      ['**七道脚本现在那种写法**（解构 + `if (!ok)`）',
        'const { ok, report } = diffWorktree(W);\nif (!ok) fail();\n', true,
        '**解构出来的名字进了否定分支**——这是判据必须认的那一种'],
      ['不解构、直接取属性',
        'const r = diffWorktree(W);\nif (!r.ok) fail();\n', true, '另一种合法写法'],
      ['只调不判（又一次）',
        'diffWorktree(W);\n', false, '**调用被当成断言**——返回值没人看'],
    ];
    let selfOk = true;
    for (const [name, src, want, why] of SAMPLES) {
      const got = judge(src);
      if (got === want) console.log(`    ✓ ${name}：${why}`);
      else {
        selfOk = false;
        problems.push(
          `**4k 的自测不通过**（${name}——${why}）：期望 ${want}，实际 ${got}。\n`
          + '    → 而「自测不通过」与「判据坏了」在输出上完全一样，'
          + '**所以这条自测自己也要能被怀疑**。',
        );
        console.log(`    ✗ ${name}：期望 ${want}，实际 ${got}`);
      }
    }
    console.log(
      selfOk
        ? '    ✓ 4k 的判据在五份语料上给出的答案都对（**包括正常状态那两种**）'
        : '',
    );
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
