#!/usr/bin/env node
/**
 * **`npm publish` 之前，全量门禁必须绿。**
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 2026-09-28 实测：这个项目**七种 lifecycle 脚本一个都没有**，
 * 而 `private` 也没声明（**默认 `false`，即「允许发布」**）。
 * 于是任何人在任何一个绿的分支上敲 `npm publish` 都能发出去。
 *
 * > 而 npm **不会**替你跑 `verify:all`——
 * > 它的 lifecycle 默认是空的（本文件挂上的那个除外）。
 *
 * ── 挂在哪个 hook 上：这不是记忆，是查来的 ──────────────────────────
 *
 * 读的是 **npm 11 自带的官方文档**
 * （`node_modules/npm/docs/content/using-npm/scripts.md` 第 151–157 行）：
 *
 * ```
 * #### `npm publish`
 * * `prepublishOnly`   ← **只在 npm publish**
 * * `prepack`         ← npm pack / npm publish / git 依赖
 * * `prepare`
 * * `postpack`
 * * `publish`
 * ```
 *
 * 而 `prepack` 的那一条（第 63–65 行）明写它**在 `npm pack` 时也跑**——
 * ⚠️ **而本项目的 `check:package-files` 每次 CI 都跑 `npm pack`**。
 * 挂 `prepack` 会让那道门禁**触发它自己**。
 *
 * > **hook 名相似，语义完全不同**——而那个相似正是容易选错的理由。
 * > 所以这条判断的依据写在文件里，**下一个人不必重新查一遍**。
 *
 * ── 判据 ────────────────────────────────────────────────────────────
 *
 * 跑一遍 `verify:all`，**非 0 就拒绝发布**。
 *
 * ⚠️ **必须是「跑一遍」而不是「看一眼上次的退出码」**——
 * 本项目栽过：「跑完 `verify:all` 看到 `Tests 514 passed` 就提交了，
 * 而那次退出码是 1」。
 */
import { spawnSync } from 'node:child_process';
import { EXIT_ENVIRONMENT, EXIT_GATE_FAILED } from '../src/lib/cli/exit-codes.mjs';

const ROOT = process.cwd();

console.log('发布前检查');
console.log('─'.repeat(64));
console.log('  正在跑 `verify:all`（这一步通常要几分钟）…\n');

/*
 * ⚠️ **Windows 上必须用 `cmd.exe /c npm`**——2026-09-28 实测踩过：
 * `npm.cmd` 是**批处理文件**，Node 在 `shell: false` 下起不来它
 * （`spawnSync` 返回 `status: null` + `error: EINVAL`，**子进程压根没跑**）。
 *
 * 而 `null !== 0` 为真 —— 于是**每一次都会被读成「发布前检查失败」**，
 * 而真相是「它没跑」。
 *
 * > **「检查失败」与「检查压根没跑」在输出上完全一样**（形态十一）。
 */
const NPM_CMD = process.platform === 'win32'
  ? { cmd: 'cmd.exe', args: ['/c', 'npm'] }
  : { cmd: 'npm', args: [] };

const r = spawnSync(NPM_CMD.cmd, [...NPM_CMD.args, 'run', 'verify:all'], {
  cwd: ROOT,
  stdio: 'inherit',
  timeout: 3_600_000,
});

/*
 * ⚠️ **先看 `r.error`，再看退出码。**
 *
 * `r.error` 存在 = **子进程压根没起来**（超时、被系统拒绝、路径不对），
 * 而那时 `r.status` 是 `null`。
 * **而 `null !== 0` 会把「压根没跑」读成「检查失败」。**
 *
 * > 两者都要拒绝发布——**但诊断必须说清是哪一种**，
 * > 否则下一个人会去查门禁，而门禁根本没问题。
 */
if (r.error) {
  console.error(
    `\n✗ \`verify:all\` 压根没跑起来（${r.error.code ?? r.error.message}）。\n`
    + '  **这不是门禁的问题**——请先修好环境再发布。\n'
    + '  而它**照样被拒绝**：拿不到「绿」就不能发。\n'
    + `  （退出码 ${EXIT_ENVIRONMENT} = 环境错，**不是** ${EXIT_GATE_FAILED}——`
    + '「压根没跑」与「跑了但没过」是两件事。）\n',
  );
  process.exit(EXIT_ENVIRONMENT);
}

if (r.status !== 0) {
  console.error(
    `\n✗ \`verify:all\` 退出码 ${r.status}——**门禁没过，不发。**\n`
    + '  修好上面报的那些，或确认是不是改动本身的问题。\n'
    + `  （本脚本的退出码是 ${EXIT_GATE_FAILED} = 门禁未通过；`
    + `而 \`verify:all\` 自己的 ${r.status} 已经在上面打过了。）\n`,
  );
  process.exit(EXIT_GATE_FAILED);
}

console.log('\n✓ `verify:all` 绿了，可以发。');
console.log('  ⚠️ 发布前最后确认：版本号、`CHANGELOG`、以及这一次是不是该发。\n');
