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
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * 从包自己的 `bin` 字段解析 CLI 入口，不猜 `node_modules/.bin` 的平台扩展名。
 *
 * @param {string} packageName
 * @param {string} [binName]
 */
export function resolveNodeBin(packageName, binName = packageName) {
  /*
   * 不能直接 `require.resolve('包/package.json')`：Pagefind 这类包用 exports
   * 封住了 package.json，明明安装着却会抛 ERR_PACKAGE_PATH_NOT_EXPORTED。
   * 从 Node 自己的模块搜索路径逐个找，仍然不依赖工作区位置或平台扩展名。
   */
  let pkgPath;
  let pkg;
  for (const searchRoot of require.resolve.paths(packageName) ?? []) {
    const candidate = join(searchRoot, packageName, 'package.json');
    try {
      pkg = JSON.parse(readFileSync(candidate, 'utf8'));
      pkgPath = candidate;
      break;
    } catch {
      // 继续尝试 Node 的下一个标准模块搜索目录
    }
  }
  if (!pkgPath || !pkg) throw new Error(`找不到已安装包 ${packageName}`);

  const { bin } = pkg;
  const relative = typeof bin === 'string' ? bin : bin?.[binName];
  if (!relative) throw new Error(`${packageName} 没有名为 ${binName} 的 CLI 入口`);
  return join(dirname(pkgPath), relative);
}

/** astro CLI 的绝对入口。 */
export const astroBin = resolveNodeBin('astro');

/**
 * 用当前 Node 运行任意依赖包的 CLI，全程不开 shell。
 *
 * @param {string} packageName
 * @param {string[]} args
 * @param {{ binName?: string, cwd?: string, env?: Record<string, string> }} [options]
 * @returns {Promise<number>}
 */
export function runNodeBin(
  packageName,
  args,
  { binName = packageName, cwd = process.cwd(), env = {} } = {},
) {
  const bin = resolveNodeBin(packageName, binName);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, ...env },
    });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

/**
 * 跑一条 astro 命令。
 *
 * @param {string[]} args 例如 `['build']`
 * @param {{ cwd?: string, env?: Record<string, string> }} [options]
 * @returns {Promise<number>} 退出码；信号终止时返回 1
 */
export function runAstro(args, { cwd = process.cwd(), env = {} } = {}) {
  return runNodeBin('astro', args, { binName: 'astro', cwd, env });
}
