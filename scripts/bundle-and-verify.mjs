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
 * 它已经作为 Vite 的依赖存在于 node_modules，不需要额外装。
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
