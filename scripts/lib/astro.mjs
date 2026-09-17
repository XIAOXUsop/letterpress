/**
 * 以「不开 shell」的方式运行 astro 命令。
 *
 * ── 为什么需要这层封装 ────────────────────────────────────────────────
 *
 * 原先两个检查脚本都是这样跑的：
 *
 *     spawn('npx', ['astro', 'build'], { shell: process.platform === 'win32' })
 *
 * Windows 上 `npx` 实际是 `npx.cmd`，不经过 shell 就起不来，所以当时开了 shell。
 * 但 Node 对「`shell: true` + 参数数组」会发 **DEP0190**：参数会被 shell 再解释一遍，
 * 等于给命令注入留了一扇门（路径里带空格或 `&` 就出问题）。而
 * `npm run verify:all` 的输出里混着这条弃用警告，也让人分不清哪些是真问题。
 *
 * 现在改成**用当前这个 Node 直接执行 astro 自己的入口脚本**：
 * 不经过 shell、不拼接字符串、不猜 `node_modules/.bin` 的扩展名，
 * Windows / macOS / Linux 行为一致，项目路径含空格或中文也不受影响。
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/** astro CLI 的绝对入口——从包自己的 bin 字段读，不硬编码 `node_modules/astro/bin/...` */
export const astroBin = (() => {
  const pkgPath = require.resolve('astro/package.json');
  const { bin } = require('astro/package.json');
  return join(dirname(pkgPath), bin.astro);
})();

/**
 * 跑一条 astro 命令。
 *
 * @param {string[]} args 例如 `['build']`
 * @param {{ cwd?: string, env?: Record<string, string> }} [options]
 * @returns {Promise<number>} 退出码；信号终止时返回 1
 */
export function runAstro(args, { cwd = process.cwd(), env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [astroBin, ...args], {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, ...env },
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}
