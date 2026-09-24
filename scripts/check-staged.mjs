#!/usr/bin/env node
/**
 * 暂存区对账：**将要提交的内容，必须与工作区里刚被验证过的那份一致。**
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────
 *
 * 2026-09-24 实测一次**真实的丢修复**：
 *
 * 1. 修好一处编码乱码并完成验证；
 * 2. 之后又改了别的文件；
 * 3. 一次 `git add -A` —— **把修好的与没修的混在一起提交**；
 * 4. 而**门禁当时是绿的**（它核的是工作区，而工作区是对的）。
 *
 * > **验证通过 ≠ 验证的是你将要交付的东西。**
 * > 修复与新改动混在同一个未提交的工作区里时，两者会共享一次「已验证」的状态，
 * > 而提交的是**最后一次写入**——未必是验过的那一版。
 *
 * ── 它能做什么、不能做什么 ─────────────────────────────────────────
 *
 * **能**：在**已经 `git add` 过**之后，报出「暂存区与工作区不一致」。
 * 那正是 `git add -A` 之后最容易漏看的状态。
 *
 * **不能**：保证「工作区里那份被验证过」。**没有任何 git 层面的检查能知道
 * 某次 `verify:all` 跑完之后有没有人改过文件**——那需要记录时间戳或内容哈希，
 * 而门禁不写状态。
 *
 * > 所以它**不是一道门禁，是一道提交前的自检**。
 * > 它挂在 `verify:all` 里的意义是：**跑完它，你至少知道此刻
 * > 「工作区 = 暂存区」这件事成立**，而这条信息在提交那一刻仍然有效。
 *
 * 用法：`npm run check:staged`（也挂在 `verify:all` 末尾）
 */
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();

/**
 * ⚠️ **用 `execFileSync` 拿文本，不要用管道。**
 *
 * Git Bash 用 cp936 而非 UTF-8：`git diff | node` 里中文会被按 GBK 解码，
 * **看起来像文件损坏了**，而文件与 git 都是好的。
 * 2026-09-24 为此差点「重写」一个好文件。
 */
const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

console.log('暂存区对账');
console.log('─'.repeat(64));

let problems = 0;

// ── 1. 有没有暂存但未提交的东西 ───────────────────────────────────
let staged = '';
try {
  staged = git('diff', '--cached', '--name-only');
} catch (error) {
  console.log('  – 不在 git 仓库里（或 git 不可用），跳过');
  process.exit(0);
}

const stagedFiles = staged.split('\n').filter(Boolean);

/*
 * ── 报告类的输出统一放这里，两个分支都调 ──────────────────────────
 *
 * ⚠️ **2026-09-24 犯过两次同型的错**：
 * 第一次是「报未跟踪文件」那段被放在「暂存区为空就 return」之后
 * （迭代 BE 修掉了）；第二次是「领先几个提交」那段**又**放在后面。
 *
 * > **每加一段报告就记得挪一次位置，第二次一定会忘。**
 * > 所以这里把「报告」收进一个函数，由两个分支统一调用——
 * > **新增报告时只改这一个函数，不存在「放哪」的选择。**
 */
function reportAll() {
  reportUntracked();
  /*
   * 顺带报一下「这次提交会让分支领先 main 多少个」。
   *
   * ⚠️ **起因是我自己连续说错**：那几条总结里我写
   * 「领先 main 48 / 52 / 54 / 58 / 61 / **63** 个提交」，而实测是 **59**。
   * **每一个都是凭印象加 1 报出来的**——
   * 而每次变化只 +1，于是「凭上次数 +1」看起来很合理，直到有一次我跳了一轮。
   *
   * > **这类数字不该由人（或 agent）心算**：让命令报，不要让人报。
   * > **不判定**（领先多少不是对错问题），只**显示**。
   */
  console.log('');
  try {
    const base = git('rev-parse', '--verify', 'origin/main').trim();
    const count = Number(git('rev-list', '--count', `${base}..HEAD`).trim());
    const shortBase = git('rev-parse', '--short', base).trim();
    /*
     * ⚠️ **两个数，不是一个。**
     * 第一版写「这次提交之后，本分支领先 N 个」——
     * 而**暂存区为空时根本没有这次提交**（`reportAll` 在那个分支里也跑）。
     * 报一个不存在的提交之后的数，比不报更糟。
     */
    console.log(`  ℹ 当前 HEAD 领先 origin/main ${count} 个提交（基线 ${shortBase}）`);
    if (stagedFiles.length > 0) {
      console.log(`    这次提交之后会是 ${count + 1} 个。`);
    } else {
      console.log('    暂存区是空的，所以**现在不会有新提交**。');
    }
    if (count === 0) {
      console.log('    ⚠️ 领先 0 个——若你预期有一批改动没进去，回去看上面的一致性检查。');
    }
  } catch {
    // 没有 origin/main（首次 clone、或远端还没建这个分支）——不是错误
    console.log('  ℹ 拿不到 origin/main，跳过「领先几个提交」的显示。');
  }
}

if (stagedFiles.length === 0) {
  console.log('  – 暂存区是空的（还没 `git add`）——**这一步要在 add 之后、commit 之前跑**');
  console.log('');
  console.log('  本检查只在「已经 add 过」时才有意义：');
  console.log('    git add -A && npm run check:staged');
  reportAll();
  console.log('');
  process.exit(0);
}

// ── 2. 暂存区与工作区一致吗 ──────────────────────────────────────
const unstaged = git('diff', '--name-only').split('\n').filter(Boolean);
const onlyStaged = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);

if (unstaged.length > 0) {
  problems += unstaged.length;
  console.log(`  ✗ 有 ${unstaged.length} 个文件「已暂存但之后又改过」：`);
  for (const f of unstaged) console.log(`      ${f}`);
  console.log('');
  console.log('    **暂存区里是旧版本，工作区里是新版本**——');
  console.log('    `git commit` 提交的是前者，而门禁验的是后者。');
  console.log('    要提交新的就再 `git add` 一次；要提交旧的心里有数。');
} else {
  console.log(`  ✓ 暂存区（${onlyStaged.length} 个文件）与工作区一致`);
}

// ── 3. 有没有被忽略掉的新文件 ─────────────────────────────────────
/*
 * ⚠️ `git add -A` 会把它们加进来，**但 `git add <具体文件>` 不会**——
 * 而「我改了 A 忘了 add B」正是上一轮那类丢东西的另一个方向。
 *
 * ⚠️ **2026-09-24 第一版把它放在了「暂存区为空就 return」之后。**
 * 后果是：**暂存区空的时候这段永远不执行**——
 * 而「我 `git add` 了 A、忘了 `git add` 刚建的 B」这个场景，
 * **恰恰发生在暂存区非空时**（A 进去了），所以那版还能报；
 * 真正报不到的是「B 存在但一个都没 add」。
 *
 * > **同一段代码放在两个分支里，就会在其中一个分支里失效**——
 * > 而「它在那条路径上会不会执行」正是最容易忘核的东西。
 */
function reportUntracked() {
  let untracked = '';
  try {
    untracked = git('ls-files', '--others', '--exclude-standard');
  } catch {
    untracked = '';
  }
  const untrackedFiles = untracked.split('\n').filter(Boolean);
  if (untrackedFiles.length === 0) return;
  console.log('');
  console.log(`  ℹ 有 ${untrackedFiles.length} 个未跟踪的文件（没被 add）：`);
  for (const f of untrackedFiles.slice(0, 8)) console.log(`      ${f}`);
  if (untrackedFiles.length > 8) console.log(`      …还有 ${untrackedFiles.length - 8} 个`);
  console.log('    这不是错误——**但如果你刚新增了文件，它可能没进去**。');
}

reportAll();

console.log('');
if (problems > 0) {
  console.log('提交前请先解决上面的不一致。');
  process.exit(1);
}
console.log('可以提交。');
