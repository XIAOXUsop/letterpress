#!/usr/bin/env node
/**
 * 把验证脚本打包后再跑。
 *
 * ── 为什么需要这一步 ────────────────────────────────────────────────
 *
 * 验证脚本要 import 项目里的 TypeScript 源码（协商逻辑），这样验的才是
 * **真正跑在生产上的那份代码**，而不是复制一份。
 *
 * 但 Node 的类型剥离只做语法层面的擦除，**不做 `.js` → `.ts` 的路径重写**
 * （那是 TypeScript 编译器的行为）。而项目里的 import 写的是 `./accept.js`
 * ——这是 TS + ESM 的标准写法，编译后路径才对——于是 Node 找不到文件。
 *
 * 用 esbuild 打成一个包就绕过了这个问题：esbuild 懂 TS 的路径约定。
 */

/*
 * ── esbuild 是**幽灵依赖**，这里必须点名 ──────────────────────────────
 *
 * 上面那句"它已经作为 Vite 的依赖存在于 node_modules，不需要额外装"是**真的**，
 * 但它成立的原因是 npm 把传递依赖**提升**到了顶层 node_modules——
 * 而不是因为 esbuild 是本项目的依赖。package.json 的 dependencies 与
 * devDependencies 里都没有它。
 *
 * 这个区别不是学究：提升是 npm 的实现细节（hoisting），换成 pnpm 或
 * 开启 `--install-strategy=nested` 就不成立，那时这个脚本会在
 * `import { build } from 'esbuild'` 上直接崩，而崩的地方离原因很远。
 *
 * 所以**要么在 devDependencies 里显式声明它，要么在脚本里明确注释这个依赖来源**。
 * 现在选后者——升级 Vite 时它会连带给一个 esbuild 大版本，
 * 显式钉版本反而要多维护一处；而这条路径只用于验证脚本，不进产物。
 * 触发条件是"换了包管理器或安装策略"，那时会立刻炸出来，不是静默的。
 */

import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'node_modules', '.cache', 'letterpress');
const outFile = join(outDir, 'verify.mjs');

await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [join(root, 'scripts', 'verify-negotiation.mjs')],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // 只打包项目自己的代码，node 内置模块保持外链
  external: [],
  logLevel: 'error',
});

const child = spawn(process.execPath, [outFile], { stdio: 'inherit', cwd: root });
child.on('exit', (code) => process.exit(code ?? 1));
