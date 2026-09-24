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
 * 这条检查量三件事：
 *   1. 步骤数量与 `knowledge/gate-negatives.md` 里记的一致（防「悄悄少一步」）；
 *   2. 每一步引用的 `npm run <name>` 在 `package.json` 里**有定义**；
 *   3. 每一步对应的脚本文件**真的存在**。
 *
 * ⚠️ **它量的是「声明的完整性」，不是「有效性」**——
 * 一门禁存在且被编排，**不代表它有效**。那件事记在
 * `knowledge/gate-negatives.md`（负向验证记录）里，两者缺一不可。
 *
 * 用法：`node scripts/check-gate-list.mjs`
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const problems = [];

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
  ['npm run check:staged', '**暂存区与工作区一致**（提交前自检：add 过之后又改过的东西不会被提交）'],
];

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const scripts = pkg.scripts ?? {};
const all = scripts['verify:all'] ?? '';

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
  ['verify:all', '它就是编排本身，不能包含自己'],
  ['verify:only', '被 verify:all 的第 3 步调用，单独跑没有产物可查'],
  // 需要外部环境的
  ['verify:online', '对着 GitHub Pages 上的 Demo 跑；Pages 跑不了内容协商，'
    + '基线本身就是红的（README 已写明是限制），不适合做门禁'],
  // 交互式 / 人工触发
  ['wiki:review', '交互式：它**不写回文件**，只打印该粘进 frontmatter 的片段。'
    + '「我复核过了」是人的承诺，不能由脚本自动完成'],
  ['wiki:impact', '只读的人工报告：列三组影响面。它不判定对错，'
    + '判定由 verify:impact（金标）负责'],
  ['wiki:ask', '交互式问答：输入是自然语言问题，没有固定输入就没法当门禁。'
    + '它的可测部分已抽成 src/lib/wiki/context-pack.ts（15 条测试）'],
  // 人工核对的清单类
  ['measure', '量产物给**人**看，判定由 check-formats 里对应的门禁做'],
  ['list:overclaims', '列出可被证伪的声称供人工核对，**退出码恒为 0**'],
  // 需要显式输入才跑得起来的
  ['migrate:manifest', '需要 `node migrate-manifest.mjs <v1.json>`——'
    + '**没有默认输入**：仓库里那份 v1 是真实线上产物（knowledge/fixtures/），'
    + '但迁移本身是一次性动作，不需要每次构建都跑。它可测的部分（诊断是否精确）'
    + '已由 verify:migrate 覆盖'],
]);
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
console.log(`  ✓ ${DOCS_WITH_STEP_COUNT.join(' 与 ')} 转述的步数与实际一致\n`);
