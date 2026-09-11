#!/usr/bin/env node
/**
 * 子路径部署检查。
 *
 * ── 为什么这条必须单独验 ────────────────────────────────────────────
 *
 * `npm run dev` 的 base 是 `/`，前缀为空——这时候**所有没加前缀的
 * 绝对路径都工作正常**。所以这个 bug 在本地开发时完全看不出来，
 * 只有真正部署到 GitHub Pages 项目站（`/仓库名/`）才会整站失效。
 *
 * 而「整站失效」的表现是所有样式、脚本、内链同时 404——排查时会
 * 先怀疑托管平台，而不是自己少写了一个前缀。
 *
 * 这个脚本用一个假的 base 构建一遍，然后扫描产物里的每一个绝对路径。
 * 任何绕过 `path()` 的链接都会在这里被抓住。
 *
 * 用法：`npm run verify:base`
 */

import { spawn } from 'node:child_process';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** 用这个假 base 构建。选它是因为长度与真实的仓库名接近。 */
const FAKE_BASE = '/letterpress';

const root = process.cwd();
const dist = join(root, 'dist');

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...env },
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

console.log(`\n子路径部署检查（SITE_BASE=${FAKE_BASE}）`);
console.log('─'.repeat(64));

// 干净的构建，避免缓存的产物混进来
await rm(join(root, '.astro'), { recursive: true, force: true });
await rm(dist, { recursive: true, force: true });

console.log('\n用假 base 构建…');
const buildCode = await run('npx', ['astro', 'build'], {
  SITE_BASE: FAKE_BASE,
  // Windows 上 Git Bash 会把 `/letterpress` 当成路径转换成 `D:/App/Git/letterpress`。
  // 这个变量在 Node 里设置，不经过 shell，所以不受影响——但为了保险还是显式注明。
  MSYS_NO_PATHCONV: '1',
});

if (buildCode !== 0) {
  console.error('\n构建失败，无法继续检查。');
  process.exit(1);
}

// ── 扫描产物里的绝对路径 ────────────────────────────────────────
const problems = new Map();

async function scan(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await scan(full);
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;

    const html = await readFile(full, 'utf8');
    const rel = full.slice(dist.length + 1).replace(/\\/g, '/');

    // href="/xxx" 或 src="/xxx"，排除协议相对地址（//example.com）
    for (const m of html.matchAll(/(?:href|src)="(\/[^/"][^"]*)"/g)) {
      const url = m[1];
      if (!url.startsWith(`${FAKE_BASE}/`)) {
        const list = problems.get(url) ?? [];
        list.push(rel);
        problems.set(url, list);
      }
    }
  }
}

await scan(dist);

console.log('\n检查绝对路径是否都带 base 前缀');
if (problems.size === 0) {
  console.log('  ✓ 全部链接都带 base 前缀');
} else {
  console.log(`  ✗ ${problems.size} 种路径没带前缀：`);
  for (const [url, files] of [...problems].sort()) {
    console.log(`      ${url}   （出现在 ${files.length} 个页面，例如 ${files[0]}）`);
  }
}

// ── 顺带确认产物结构没被 base 弄坏 ──────────────────────────────
const required = ['index.html', 'posts/index.html', 'wiki/index.html', 'og.png', 'robots.txt'];
for (const rel of required) {
  try {
    await readFile(join(dist, rel));
    console.log(`  ✓ ${rel} 存在`);
  } catch {
    console.log(`  ✗ ${rel} 缺失`);
    problems.set(rel, ['(缺失)']);
  }
}

console.log('\n' + '─'.repeat(64));
console.log(problems.size === 0 ? '子路径部署检查通过。\n' : `发现 ${problems.size} 处问题。\n`);
process.exitCode = problems.size === 0 ? 0 : 1;
