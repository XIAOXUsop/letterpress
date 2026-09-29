#!/usr/bin/env node
/**
 * **变异脚本的收尾断言：跑完之后，工作区必须与跑之前一样。**
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 2026-09-29 实测：**七道变异脚本里只有一道有这条断言**
 * （`new-gates.mutations.mjs`），另外六道的收尾是
 * 「跑一遍门禁，绿了就算还原干净」。
 *
 * > **而「门禁绿了」与「工作区没被我改脏」在输出上完全一样。**
 *
 * 六道各自的收尾只回答「被测的那一道还绿吗」，**不问「我改了什么」**。
 * 于是有两类残留它们永远看不见：
 *
 * | 残留 | 现有断言能看见吗 |
 * |---|---|
 * | 注入的那一处没还原 | ✅ 能（门禁会红） |
 * | **顺手改的第二处没还原**（`alsoEdit` 那种） | ❌ 不能——而它可能完全不影响门禁 |
 * | **被测的 CI 步骤顺手改了别的**（清空 `dist`、装依赖、格式化） | ❌ 不能 |
 * | **临时 fixture 留在磁盘上** | ❌ 不能 |
 *
 * 而 2026-09-28 那次「34 条变异里 2 条一直假红」就是这一类：
 * `spawnSync` 返回 `status: null`，**子进程压根没跑成**，
 * **文件却已经被改了**——门禁红是真的红，**而结论是假的**。
 *
 * ⚠️ 而那六道里有一道（`retrieval-gates`）改的是**生产源码**
 * `src/lib/wiki/retrieve.ts`——**残留的代价最高的那一道，恰恰没有这条断言。**
 *
 * ── 判据 ────────────────────────────────────────────────────────────
 *
 * `git status --porcelain` 的**归一化后**输出必须与**跑之前**一致。
 *
 * ⚠️ **要比较「前」与「后」，不能只判「后」是空的**——
 * 提交前工作区本来就可能有改动，而「空」会把
 * 「本来就有改动」与「我弄脏了」混成一条。
 *
 * ⚠️ **比两次**：一次默认、一次 `--untracked-files=all`。
 * 默认那次**把未跟踪目录折叠成一行**，
 * 所以「我往 `.verify/` 里留了三个临时文件」**在输出上是干净的**。
 *
 * 用法：
 *
 * ```js
 * const WORKTREE = captureWorktree();
 * // …跑变异…
 * const { ok, report } = diffWorktree(WORKTREE);
 * if (!ok) { console.log(report); process.exit(1); }
 * ```
 */
import { spawnSync } from 'node:child_process';

const norm = (s) =>
  String(s ?? '').split('\n').filter(Boolean).sort().join('\n');

/** 两段快照之间的分隔符。**必须是可见的**——U+0001 在源码里看不见，
 * 而「看不见的分隔符」与「拼错了的分隔符」在输出上完全一样。 */
const SEP = '';

/** `git status` 没跑成功时的标记——**不默默当成「工作区干净」**。 */
const FAILED = ' GIT_FAILED:';

/**
 * 记下当前工作区的样子——**要在注入任何东西之前调**。
 *
 * @param {string} [cwd]
 * @returns {string} 归一化后的两次 `git status` 拼接（以 {@link SEP} 分隔）
 */
export function captureWorktree(cwd = process.cwd()) {
  const run = (args) =>
    spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60_000 });

  /*
   * ⚠️ **`r.status === null` 与「输出为空」必须分开**——
   * 那与 `spawnSync` 那个坑同族（`status: null` 是「压根没拿到」），
   * 而「没拿到」被当成「工作区是干净的」，**恰好是最危险的读法**。
   */
  const short = run(['status', '--porcelain']);
  const full = run(['status', '--porcelain', '--untracked-files=all']);

  if (short.error || short.status !== 0) {
    return `${FAILED}${short.error?.code ?? short.status}`;
  }
  if (full.error || full.status !== 0) {
    return `${FAILED}${full.error?.code ?? full.status}`;
  }
  return `${norm(short.stdout)}${SEP}${norm(full.stdout)}`;
}

/**
 * 比对当前工作区与 `before`，返回能不能算「没残留」。
 *
 * @param {string} before  `captureWorktree()` 的返回值
 * @param {string} [cwd]
 * @returns {{ ok: boolean, report: string }}
 */
export function diffWorktree(before, cwd = process.cwd()) {
  const after = captureWorktree(cwd);

  // ── 核不到就明说，不默默放过 ────────────────────────────────────────
  if (before.startsWith(FAILED) || after.startsWith(FAILED)) {
    return {
      ok: false,
      report:
        '  ✗ **工作区状态取不到**（`git status` 没跑成功）——\n'
        + '    → 本轮**不能**断言「没留下残留」，而「核不到」与「干净」在输出上完全一样。\n'
        + `    → 之前：${before.slice(0, 80)}｜现在：${after.slice(0, 80)}`,
    };
  }

  if (after === before) {
    return { ok: true, report: '  ✓ 跑完之后工作区与跑之前一致（无残留）' };
  }

  const diffOf = (a, b) => {
    const bs = new Set(String(b ?? '').split('\n').filter(Boolean));
    const as = new Set(String(a ?? '').split('\n').filter(Boolean));
    return {
      added: [...as].filter((l) => !bs.has(l)),
      gone: [...bs].filter((l) => !as.has(l)),
    };
  };

  /*
   * ⚠️⚠️ **只看长列表的差集，并按状态前缀分类**（2026-09-29 修的一处错）。
   *
   * 第一版报「已跟踪 1、未跟踪 1」——而实际只有**一个**新文件。
   * 根因：`--untracked-files=all` 的列表**是短列表的超集**
   * （已跟踪的改动也在里面），于是我把两个差集**相加**，
   * **同一处改动被数了两遍**。
   *
   * > **「两个清单的差集」与「两类残留」在输出上完全一样**——
   * > 而这两者一个按**分类**分、一个按**取数方式**分，**重合得很自然**。
   *
   * 所以：**长列表的差集是完备的**（它含全部），
   * 再按**每行的状态前缀**分类——`??` 是未跟踪，其余是已跟踪。
   * **一个来源，一次计数。**
   */
  const d = diffOf(after.split(SEP)[1], before.split(SEP)[1]);
  const isUntracked = (l) => l.startsWith('??');
  const count = (arr) => arr.filter(isUntracked).length;

  const total = d.added.length + d.gone.length;
  const show = (arr, sign) =>
    arr.slice(0, 10).map((l) => `      ${sign} ${l}`).join('\n')
    + (arr.length > 10 ? `\n      …… 还有 ${arr.length - 10} 处` : '');

  return {
    ok: false,
    report:
      '  ✗ **跑完之后工作区变了**——本轮变异留下了残留。\n'
      + (d.added.length ? show(d.added, '+') + '\n' : '')
      + (d.gone.length ? show(d.gone, '-') + '\n' : '')
      + `    → 共 ${total} 处：已跟踪 ${total - count(d.added) - count(d.gone)}、`
      + `未跟踪 ${count(d.added) + count(d.gone)}。\n`
      + '    → 每条变异都会还原它注入的那一处，**而这一条抓的是「我注入之外的改动」**。\n'
      + '    2026-09-28 那 2 条一直假红就是这一类：`spawnSync` 返回 `status: null`，\n'
      + '    **子进程压根没跑成、文件却已经被改了**——门禁红是真的红，而结论是假的。',
  };
}
