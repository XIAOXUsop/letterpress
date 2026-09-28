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

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log('\n版本号、tag、CHANGELOG 对得上。\n');
