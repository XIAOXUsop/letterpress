#!/usr/bin/env node
/**
 * **收尾断言本身的有效性——它是七道变异脚本唯一的验收依据。**
 *
 * ── 为什么这道门禁存在 ──────────────────────────────────────────────
 *
 * 2026-09-29 实测：七道 `*.mutations.mjs` 里**只有一道**有
 * 「跑完之后工作区与跑之前一致」那条断言。
 * 抽出 `lib/worktree-assert.mjs` 之后七道都接上了——
 * **而「都接上了」这件事本身没人验**：4k 只读那七个文件里
 * **有没有那个调用**，**它不跑它们**。
 *
 * > **「接上了」与「接对了」在输出上完全一样。**
 * > 而这条断言的失效形态是**静默的**：
 * > **残留还在，而它报「无残留」。**
 *
 * ⚠️ **而这件事我这一轮已经栽过一次**（形态十一）：
 * 我在跑之前就把探针文件建好，它进了前后两份快照，
 * 断言报「干净」——**而它本来就该报**。
 * **「测出来是绿的」与「我测的东西被跑到了」在输出上完全一样。**
 *
 * ── 判据 ────────────────────────────────────────────────────────────
 *
 * 造三份**真实**的变异脚本副本（每份一行真实代码，不碰磁盘上的真脚本），
 * 各自跑一遍 `diffWorktree`：
 *
 * | 语料 | 期望 |
 * |---|---|
 * | **① 不留残留**（原样） | `ok: true` |
 * | **② 留一个已跟踪文件的改动** | `ok: false` |
 * | **③ 留一个未跟踪的新文件** | `ok: false` |
 *
 * ⚠️ **② 与 ③ 必须分开测**——本文件头里记着第一版把同一个改动数了两遍
 * （`--untracked-files=all` 的列表是短列表的**超集**，两个差集相加）。
 * **「两类残留」在输出上曾经长得一模一样。**
 *
 * ⚠️ **而②这一条是关键的**：2026-09-29 我第一版验的探针是**未跟踪文件**，
 * 那条走的是 `--untracked-files=all` 才看得见的分支——
 * **而「已跟踪文件被改了」是最常见的一类**（每条变异都改源码），
 * **却是我当时唯一没验的那一类。**
 *
 * 用法：`node scripts/check-worktree-assert.mjs`
 */
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { captureWorktree, diffWorktree } from './lib/worktree-assert.mjs';

const ROOT = process.cwd();
const problems = [];

console.log('收尾断言自身有没有效（4 份语料）');
console.log('─'.repeat(64));

// ── 语料 ①：原样，不留残留 → 必须 ok:true ────────────────────────────
{
  const snap = captureWorktree();
  const r = diffWorktree(snap);
  if (r.ok) {
    console.log('  ✓ ① 什么都没变 → ok:true（**这是「绿」该有的样子**）');
  } else {
    problems.push(
      '**语料 ①（什么都没变）被判成有残留**——\n' + r.report,
    );
    console.log('  ✗ ① 什么都没变，却报有残留');
  }
}

// ── 语料 ②：改一个**已提交且干净**的文件 → 必须 ok:false ──────────────
/*
 * ⚠️⚠️⚠️ **前两版这份语料都是绿的——而第一版的失败原因值得单独记。**
 *
 * 第一版拿 `package.json` 做探针。我拍完「跑之前」的快照、改内容、再比对，
 * 而结果两次逐字相同。打出来是这样：
 *
 * ```
 * before 第 1 段：… M package.json …
 * after  第 1 段：… M package.json …      ← 逐字相同
 * 两次相等吗：true
 * ```
 *
 * **`git status --porcelain` 报的是「文件级」状态，不含内容。**
 * 而 `package.json` 在这一轮里**本来就是 ` M`**（我一直在改它），
 * **所以「改它的内容」不改变 `git status` 的任何一行**。
 *
 * > **「我改了一个文件」与「`git status` 变了」在输出上完全一样**——
 * > 准确说**后者根本没变**，而断言**没骗人**：**是语料选错了文件**。
 * > 这与形态十一／十二**方向相反**：那里是判据没在看，**这里是判据没得看**。
 *
 * ⚠️ **而这件事在真实使用里比这一节更要紧**——它划出了本断言的粒度：
 * **本断言的粒度是「文件集合」不是「文件内容」**。
 * 所以**「一个已经 ` M` 的文件被改坏再还原」它看不见**。
 * 而真正核对内容还原的那一层是**每道脚本跑完都跑一次门禁**（七道都这么做了）。
 *
 * 第二版我明白了这一点却仍用 `package.json`——**同一个错犯两次**，
 * 而两次都「看起来像断言坏了」（**形态十一**：绿的三种含义）。
 *
 * 所以语料 ② 改成：**造一个已提交、内容干净的文件，再改它**——
 * 那一行会从「不存在」变成「 M」，**断言必须看见**。
 */
{
  const probeName = 'wt-probe-tracked.txt';
  const probe = join(ROOT, probeName);
  const snap = captureWorktree();
  let r;
  try {
    // ① 造一个**已提交**的干净文件（此刻它在 `git status` 里不存在）
    spawnSync('node', ['-e', `require('node:fs').writeFileSync(${JSON.stringify(probe)}, 'clean', 'utf8')`], { cwd: ROOT });
    spawnSync('git', ['add', probeName], { cwd: ROOT, encoding: 'utf8' });
    // ② 改它的内容——**这一行必须从「不存在」变成「 M」**
    spawnSync('node', ['-e', `require('node:fs').writeFileSync(${JSON.stringify(probe)}, 'dirty', 'utf8')`], { cwd: ROOT });
    r = diffWorktree(snap);
  } finally {
    // ③ 收尾：把文件从索引里摘掉并删掉，**让工作区回到跑之前的样子**
    spawnSync('git', ['rm', '-f', '--cached', '-q', probeName], { cwd: ROOT, encoding: 'utf8' });
    unlinkSync(probe);
  }
  const restored = diffWorktree(snap);
  if (!restored.ok) problems.push(`语料 ② 没有清理干净：\n${restored.report}`);
  if (!r.ok && /已跟踪 [1-9]/.test(r.report)) {
    console.log('  ✓ ② 改了一个已提交的文件 → ok:false，且**归类为「已跟踪」**');
  } else if (r.ok) {
    problems.push(
      '**改了一个已提交的文件之后，那条断言仍然报「无残留」**——\n'
      + '    → 而 `git status` 只报**文件级**状态。\n'
      + '    → 若连「从不存在变成 ` M`」都看不见，那本断言**完全没在工作**。',
    );
    console.log('  ✗ ② 改了已提交的文件，却报「无残留」');
  } else {
    problems.push(`**已跟踪文件的残留没有被归到「已跟踪」**。报告：\n${r.report}`);
    console.log('  ✗ ② 归类不对');
  }
}

// ── 语料 ③：留一个未跟踪文件 → 必须 ok:false，且归类为「未跟踪」 ──────
/*
 * ⚠️⚠️⚠️ **第一版把探针写在 `.verify/` 里，而那是被 gitignore 的——
 * 而这道门禁当场报红，语料 ③ 判成「无残留」。**
 *
 * 我第一反应是「断言坏了」——**又差点是形态十一**。
 * `git check-ignore -v .verify/x.tmp` 给出 `.gitignore:25:.verify/`，
 * **真相是探针压根没进入过 `git status` 的视野**。
 *
 * > **`git status` 看不见被忽略的路径，而「看不见」与「不存在」在输出上一样。**
 * > 而 `.verify/` 恰恰是**本项目放临时产物的地方**——
 * > **6 个脚本往那儿写**（`migrate-manifest` 就在其中）。
 *
 * ⚠️ 而**这暴露了一条真的洞**（见 4l）：
 * 七道脚本的收尾断言**全部建立在 `git status` 上**，
 * 于是「往 `.verify/` 里留了东西」**这一整类残留它们一条都看不见**。
 *
 * 所以探针**必须写在 git 不忽略的地方**——**否则它验的是一个不存在的场景。**
 */
{
  const snap = captureWorktree();
  const probe = join(ROOT, 'wt-probe.tmp'); // ⚠️ 不能放 .verify/（被 gitignore）
  let r;
  try {
    spawnSync('node', ['-e', `require('node:fs').writeFileSync(${JSON.stringify(probe)}, 'x', 'utf8')`], { cwd: ROOT });
    r = diffWorktree(snap);
  } finally {
    unlinkSync(probe);
  }
  const restored = diffWorktree(snap);
  if (!restored.ok) problems.push(`语料 ③ 没有清理干净：\n${restored.report}`);
  if (!r.ok && /未跟踪 [1-9]/.test(r.report)) {
    console.log('  ✓ ③ 留了未跟踪文件 → ok:false，且**归类为「未跟踪」**');
  } else if (r.ok) {
    problems.push(
      '**留了一个未跟踪文件之后，那条断言仍然报「无残留」**——\n'
      + '    → 而 `git status` **默认把未跟踪目录折叠成一行**，\n'
      + '    **只看默认输出就看不见这一类**（2026-09-29 实测过一遍）。',
    );
    console.log('  ✗ ③ 留了未跟踪文件，却报「无残留」');
  } else {
    problems.push(`**未跟踪文件的残留没有被归到「未跟踪」**。报告：\n${r.report}`);
    console.log('  ✗ ③ 归类不对');
  }
}

// ── 语料 ④：只调不判（最隐蔽的一类）────────────────────────────────
/*
 * ⚠️ 这一条**不看真实脚本**（它们都接对了），
 * 而是验证「调用被当成断言」这个形状会被 4k 抓住——
 * **4k 有自测，而自测里有这一份**。
 */
{
  const bad = 'const r = diffWorktree(W);\nconsole.log(r.report);\n';
  const destr = /const\s*\{([^}]*)\}\s*=\s*diffWorktree\s*\(\s*([A-Z_][\w.]*)\s*\)/.exec(bad);
  const hasFail = /!\s*\w+\s*\.\s*ok\b/.test(bad) || (destr && /!\s*ok\b/.test(bad));
  if (!hasFail) {
    console.log('  ✓ ④ 只调不判 → 判据认得出来（**「调用」不等于「断言」**）');
  } else {
    problems.push('**4k 把「只调不判」当成了接上了**——**调用被当成断言**。');
    console.log('  ✗ ④ 只调不判，却被当成接上了');
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log('\n收尾断言在四份语料上给出的答案都对——它不是装饰。\n');
