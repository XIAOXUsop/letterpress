#!/usr/bin/env node
/**
 * **版本号、git tag、`CHANGELOG` 三者必须对得上——发布前那一步不能靠记性。**
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 2026-09-29 实测：本项目**只有一个 tag**（`v0.1.0`，2026-09-18），
 * 它指向 `9361b2b`，**而 HEAD 在它之后 220 个提交**。
 *
 * ```
 * $ git tag
 * v0.1.0  2026-09-18  9361b2b
 * $ git log --oneline -1 v0.1.0
 * 9361b2b fix(ci): 内容格式探针必须排在产物检查之后
 * $ git log --oneline -1 HEAD
 * 920e7ee 加发布前护栏 prepublishOnly，并给它一个归类的退出码
 * ```
 *
 * 而 `package.json` 仍写着 `0.1.0`。**所以读的人会以为 `0.1.0` 就是当前状态**——
 * 而实际上 220 个提交（其中包括「让构建失败」的一整套知识层门禁）
 * **从未反映在任何 tag 上**。
 *
 * > **`prepublish-guard` 的最后一句提醒「确认版本号、`CHANGELOG`」是散文。**
 * > 而本项目栽过好几次「注释/散文里写了而代码没做」——
 * > **所以那句话要变成可判定的。**
 *
 * ── 判据 ────────────────────────────────────────────────────────────
 *
 * ① **tag 存在，且它指向的提交不是 HEAD**（不是最新的 → 已发过、但 HEAD 更新）
 *    ——这是**已发布过**的判据。**一个 tag 都没有**也要报。
 * ② **最新 tag 的版本号与 `package.json` 的 `version` 相同**——
 *    两者是**同一个事实的两处真值**，会各改一处。
 * ③ **仓库里有 `CHANGELOG`**，且**最新一节写的就是当前版本号**——
 *    没有它，「这次发了什么」在仓库里无处可查。
 *
 * ⚠️ **①② 不主张「该发版了」**——那是人的判断（时机、语义化版本号合不合适）。
 * 本检查只核**「已发布的状态」与「仓库写着的状态」对不对得上**。
 * 而「HEAD 比 tag 新」**不是缺陷**，只是「发过、之后又改了」——
 * 所以**不报**，只在输出里写明差多少个提交。
 *
 * ⚠️ **而 ③ 是本项目自己的决定**，不是 npm 的规定：
 * 生态里小项目常不做 `CHANGELOG`。所以它可关（见 `SKIP_CHANGELOG`），
 * **而「关掉」这件事必须写在源码里**，不能靠不写文件来隐式关掉。
 *
 * 用法：`node scripts/check-release.mjs`
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const problems = [];

console.log('发布状态对账');
console.log('─'.repeat(64));

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;

/** 跑一条 git 命令，返回去空行的输出。 */
const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

const tags = git('tag', '--list', '--sort=-v:refname').split('\n').filter(Boolean);
console.log(`  \`package.json\` 的 version：${version}`);
console.log(`  git tag：${tags.length === 0 ? '（一个都没有）' : tags.join('、')}`);

// ── ① 至少要有一个 tag ────────────────────────────────────────────────
if (tags.length === 0) {
  problems.push(
    '**一个 git tag 都没有**——而 `package.json` 写着 `version: ' + version + '`。\n'
    + '    → 「已经发过的版本」在仓库里**没有任何记录**。\n'
    + '    → 而 `prepublish-guard` 会**允许**这次发布（它只核门禁绿不绿）——\n'
    + '    **「发得出去」与「发过没有记录」是两件事。**',
  );
  console.log('  ✗ 一个 tag 都没有');
} else {
  const latest = tags[0];
  console.log(`  ✓ 最新 tag：${latest}`);

  // ── ② tag 的版本号与 package.json 相同 ─────────────────────────────
  // ⚠️ **要剥掉 `v` 前缀**——而 `git tag` 两种写法都有人用。
  const tagged = latest.replace(/^v/, '');
  if (tagged !== version) {
    problems.push(
      `**最新 tag 是 \`${latest}\`（版本 \`${tagged}\`），而 \`package.json\` 写 \`${version}\`。**\n`
      + '    → 两者是**同一个事实的两处真值**，而它们**各改一处**就会分叉。\n'
      + '    → 要么改 `package.json`（`npm version` 会同步改它并打 tag），\n'
      + '    要么改 tag（`git tag -d` 后重打）——**但别只改一处**。',
    );
    console.log(`  ✗ tag 是 ${tagged}，package.json 是 ${version}`);
  } else {
    console.log(`  ✓ tag 与 \`package.json\` 的版本号相同（${tagged}）`);
  }

  // ── HEAD 比 tag 新多少——**报出来，但不当作缺陷** ──────────────────────
  /*
   * ⚠️ **「HEAD 比 tag 新」不是缺陷**，只是「发过、之后又改了」。
   * 而本项目栽过「判据太宽就变成噪声」——
   * 所以这里只**报事实**，不 `problems.push`。
   *
   * 而它**必须报出来**：不然读者看到「tag 与 package.json 一致」
   * 会以为「0.1.0 就是当前状态」——而实际上后面还有 220 个提交。
   */
  try {
    const behind = Number(git('rev-list', '--count', `${latest}..HEAD`));
    if (behind > 0) {
      console.log(
        `  – HEAD 比 \`${latest}\` **新 ${behind} 个提交**——`
        + '**这不是缺陷**（发过、之后又改了），但意味着',
      );
      console.log('    「`package.json` 的版本号」**不等于**「当前代码的状态」。');
    } else {
      console.log(`  ✓ HEAD 就在 \`${latest}\` 上`);
    }
  } catch {
    problems.push('**`git rev-list` 失败**（可能不是 git 仓库）——本检查此刻核不到任何东西。');
    console.log('  ✗ `git rev-list` 失败');
  }
}

// ── ③ CHANGELOG ───────────────────────────────────────────────────────
/*
 * ⚠️⚠️ **这一条已关掉，而关掉的理由是量出来的，不是「不想做」。**
 *
 * 2026-09-29 实测：`v0.1.0..HEAD` 有 **220 个提交**，
 * 其中 **136 个没有类型前缀**——而看内容，**绝大多数是这一轮的门禁工作**
 * （`加判据 4c…`、`README 的「30 秒开始」补上第一步…`）。
 *
 * **而它们不是「使用者能感知的变更」**，是内部质量工作。
 * 从 `git log` 自动生成 CHANGELOG 也不行——那 136 条要**逐条归类**，
 * **那是判断题，不是机械转换**。
 *
 * > **判据逼人做它不该做的事时，人会绕开**（而不是照做）。
 * > 而「写一份假装完整的 CHANGELOG」比「没有 CHANGELOG」更坏：
 * > **它会让读者以为 release note 是权威的**。
 *
 * 所以：**显式关掉**，并把理由写在这里——
 * 「关掉」与「忘了做」在输出上完全一样（形态四），
 * **所以关掉这件事本身必须能被查到**。
 *
 * ⚠️ **要开回来的条件**：等项目开始对外发版，
 * 且**发版的那一次**手工写（那时「这版有什么」是清楚的）。
 */
const SKIP_CHANGELOG = true;
const CL = join(ROOT, 'CHANGELOG.md');
if (SKIP_CHANGELOG) {
  console.log('  – `CHANGELOG`：**本项目显式选择不做**');
  console.log('    理由：v0.1.0 之后 220 个提交里 136 个是内部门禁工作，');
  console.log('    **不是使用者能感知的变更**——见本文件里那一段的完整说明。');
  if (existsSync(CL)) {
    console.log('    ℹ 而 `CHANGELOG.md` **存在**——要开回来就把 `SKIP_CHANGELOG` 改成 `false`。');
  }
} else if (!existsSync(CL)) {
  problems.push(
    '**仓库里没有 `CHANGELOG.md`。**\n'
    + '    → 「这一版发了什么」在仓库里**无处可查**——\n'
    + '    而 npm 页面上的说明是手写的，**会与实际内容漂开**。\n'
    + '    → 不想做就**显式关掉**：把本文件里的 `SKIP_CHANGELOG` 改成 `true`，\n'
    + '    **别靠不写文件来隐式关掉**——那与「忘了写」在输出上完全一样。',
  );
  console.log('  ✗ 没有 CHANGELOG.md');
} else {
  const text = readFileSync(CL, 'utf8');
  // 最新一节：第一个含版本号的标题行
  const first = /^\s*#+\s*\[?v?(\d+\.\d+\.\d+[^\]\s]*)\]?/m.exec(text);
  if (!first) {
    problems.push(
      '**`CHANGELOG.md` 里找不到任何版本号标题**'
      + '（期望形如 `## [0.2.0] - 2026-09-29`）。\n'
      + '    → 而「最新一节写的是哪一版」是它唯一的机器可读信息。',
    );
    console.log('  ✗ CHANGELOG 里找不到版本号标题');
  } else if (first[1] !== version) {
    problems.push(
      `**\`CHANGELOG.md\` 最新一节是 \`${first[1]}\`，而 \`package.json\` 是 \`${version}\`。**\n`
      + '    → 「这一版发了什么」与「现在是哪一版」对不上。',
    );
    console.log(`  ✗ CHANGELOG 最新一节 ${first[1]}，package.json ${version}`);
  } else {
    console.log(`  ✓ CHANGELOG 最新一节是 ${first[1]}`);
  }
}

// ── ④ 这个仓库对外承诺的是「模板」还是「包」？而它必须写明 ──────────────
/*
 * ⚠️ **2026-09-29 实测到的一处真不一致。**
 *
 * README 第 55 行明写「**这是模板，所以第一步是 clone 而不是 install**」——
 * 而 `package.json` 里现在有一整套「当包发」的装备：
 *
 * | 装备 | 为谁准备 |
 * |---|---|
 * | `files` 白名单 | `npm pack` / `npm publish` |
 * | `prepublishOnly` 护栏 | `npm publish` |
 * | `keywords` / `repository` / `homepage` | npm 页面 |
 * | `description`（英文） | npm 搜索结果 |
 *
 * > **而 README 只承诺了 clone。** 那一整套装备**没有一句承诺**——
 * > 于是它成了**自说自话**：门禁在守一个没人承诺过的发布流程。
 *
 * 而**两种定位的要求不同**：
 *
 * | | 模板（clone 改） | 包（`npm i`） |
 * |---|---|---|
 * | 要 `files` 白名单吗 | 不要（clone 整个仓库） | **要** |
 * | 要 `peerDependencies` 吗 | 不要 | **要**（否则锁死使用者的 astro） |
 * | 别人拿到的是什么 | 一整个能改的站点 | 一个依赖 |
 *
 * 2026-09-29 实测 clone 会拿到 **227 个文件**（含 `scripts/`、`knowledge/`、
 * `docs/`——**那些对 clone 的人有用**，改内容、跑门禁都要用），
 * 而 `files` 白名单只让 `npm pack` 出 124 个。
 *
 * 所以判据**不主张哪一种**，只要求：**写明是哪一种**，
 * 而那份声明**必须与 `package.json` 的形状自洽**——
 * 说「模板」却**没有** `files` 与护栏，是准备工作没做完；
 * 说「包」却**没有** `peerDependencies`，是锁死了使用者的 astro。
 */
{
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const claimsTemplate = /这是\s*\**模板\**/.test(readme);
  const claimsPackage = /npm (?:i|install|add)\s+letterpress/.test(readme);
  const s = pkg.scripts ?? {};

  console.log(`  对外承诺：${claimsTemplate ? '模板（clone 下来改）' : claimsPackage ? '包（当依赖装）' : '**两处都没写明**'}`);

  if (!claimsTemplate && !claimsPackage) {
    problems.push(
      '**README 里既没写「这是模板」，也没写「可以 `npm i` 当依赖装」。**\n'
      + '    → 而 `package.json` 里已经有一整套「当包发」的装备\n'
      + '    （`files` 白名单、`prepublishOnly` 护栏、`keywords` / `repository` / `homepage`）。\n'
      + '    → **没有承诺的准备工作是自说自话**：门禁在守一个没人承诺过的流程。\n'
      + '    → 在 README 里明写是哪一种。',
    );
    console.log('  ✗ 没写明是模板还是包');
  } else if (claimsTemplate) {
    // 说「模板」：装备可以有（为将来发），但 `peerDependencies` 就不该有
    if (s.prepublishOnly === undefined) {
      problems.push(
        '**README 说这是模板，而 `prepublishOnly` 护栏没了。**\n'
        + '    → 那一整套「当包发」的装备里，它是最要紧的一道（发布前跑全量门禁）。',
      );
      console.log('  ✗ 说「模板」却没有 `prepublishOnly` 护栏');
    } else if (pkg.peerDependencies) {
      problems.push(
        '**README 说这是模板，而 `package.json` 有 `peerDependencies`。**\n'
        + '    → 那是**被安装的包**才需要的字段——它约束的是「装我的人」。\n'
        + '    → 而模板是 clone 下来的，**没有「装我的人」**。\n'
        + '    → 要么改 README 说它是包，要么删掉 `peerDependencies`。',
      );
      console.log('  ✗ 说「模板」却有 `peerDependencies`');
    } else {
      console.log('  ✓ 说「模板」，而护栏在、`peerDependencies` 不在——两者自洽');
    }
  }
  console.log(
    '    ℹ clone 会拿到 **227** 个文件（含 `scripts/`、`knowledge/`、`docs/`——',
  );
  console.log('    **那些对 clone 的人有用**），而 `files` 只让 `npm pack` 出 124 个。');
}

// ── ⑤ 定位的**措辞**必须在全文唯一 ────────────────────────────────────
/*
 * ⚠️ **④ 只核「有没有写明」，不核「写的是不是同一件事」。**
 *
 * 2026-09-29 实测的漏洞形状：④ 的 `claimsTemplate` 是**全文搜「这是模板」**，
 * 而**别处若写一句「它是一个 Astro 集成包」/「这不是模板」**，
 * ④ **照样绿**——因为它只认自己搜的那一句。
 *
 * > **全文搜一个词找到「有一处这么说」，不等于「没有别处说反的」。**
 * > 而 README 是**给人读的**，人会补一句说明——
 * > **补的那一句正是最容易与原句矛盾的地方**。
 *
 * 判据：扫出**明确的对立表述**，有一处就报。
 *
 * ⚠️ **而「一种说法」不能靠字符串相等判**——同义不同字
 * （「主题」与「模板」、`template` 与 `starter`）是常态，
 * 判「同义」是语义问题，**机器做不了**。
 * 所以只抓**明确的对立/转向句式**——**那才是真正会误导读者的**。
 *
 * ⚠️ **而这必然漏**：有人写「它更像库而不是模板」而正则抓不到。
 * **漏比误报便宜**——误报会逼人改掉本来正确的句子。
 * 而那是本项目反复交的学费（判据太宽就变成噪声）。
 */
{
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const CONTRADICTS = [
    { re: /不是\s*\**模板/, what: '「不是模板」' },
    { re: /只[是为]?\s*\**主题/, what: '「只是主题」' },
    { re: /当成\s*\**?(npm\s*)?(依赖|包)/i, what: '「当成依赖/包」' },
    { re: /可以\s*`?npm (?:i|install|add)\s+letterpress/i, what: '「可以 npm i letterpress」' },
  ];
  const hits = CONTRADICTS.filter((c) => c.re.test(readme));
  if (hits.length > 0) {
    problems.push(
      `README 里同时出现了**互相矛盾的定位**：\n`
      + hits.map((h) => `        ${h.what}`).join('\n') + '\n'
      + '    → 而 ④ 只认「这是模板」那一句，**看不到别处的对立表述**。\n'
      + '    → 读者读到**任意一句**都会照着做——而两句给的用法不一样。\n'
      + '    → 删掉对的那句，或改成本项目实际支持的那一种。',
    );
    console.log(`  ✗ README 里有 ${hits.length} 处与「这是模板」矛盾的表述：${hits.map((h) => h.what).join('、')}`);
  } else {
    console.log('  ✓ README 里没有与「这是模板」矛盾的表述');
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log('\n版本号、tag、CHANGELOG 对得上。\n');
