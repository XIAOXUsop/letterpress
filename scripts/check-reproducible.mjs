#!/usr/bin/env node
/**
 * 可复现构建检查：在两个时区对同一份源码做干净构建，逐文件比较 SHA-256。
 *
 * 只比较一两个代表文件会漏掉时间戳、枚举顺序或随机 ID 混进其他产物的情况，
 * 所以这里覆盖 `npm run build` 的完整输出：Astro 页面、图片、RSS、sitemap、
 * markdown 孪生、内容清单以及 Pagefind 索引。连续构建只能发现随机性；跨时区
 * 构建还能抓到 `Intl.DateTimeFormat`、本地日历分组等机器环境泄漏。
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runAstro, runNodeBin } from './lib/astro.mjs';
import { cleanBuildState } from './lib/clean.mjs';

const root = process.cwd();
const dist = join(root, 'dist');

async function cleanBuild(timeZone) {
  await cleanBuildState(root);

  const env = { TZ: timeZone };
  const astroCode = await runAstro(['build'], { env });
  if (astroCode !== 0) throw new Error(`Astro 构建失败（退出码 ${astroCode}）`);

  // `npm run build` 的第二段也必须纳入；否则搜索索引可以每次变化而检查仍是绿的。
  const pagefindCode = await runNodeBin('pagefind', ['--site', dist], { env });
  if (pagefindCode !== 0) throw new Error(`Pagefind 构建失败（退出码 ${pagefindCode}）`);
}

/**
 * 跨时区比较抓不到“今年”这种一年才变化一次的时钟泄漏，所以额外禁止生产源码
 * 无参数读取系统时钟。内容解析用 `new Date(value)` 不受影响；若未来真需要当前时间，
 * 必须显式注入，才能在测试和构建中固定它。
 *
 * ⚠️ **`Date()` 的裸调用曾经漏在外面**（2026-09-22 修）。原先的模式是
 * `\b(?:new\s+Date\s*\(\s*\)|Date\.now\s*\()`——只覆盖 `new Date()` 与
 * `Date.now()`，而 `Date()` **不带 `new` 也是一个读当前时间的调用**
 * （ECMAScript 里无参数调用返回当前时间的字符串，行为与 `new Date()` 同）。
 *
 * 实测：往 `src/config.ts` 里放一行 `export const published = Date();`，
 * 跨时区可复现检查**照常通过**（0 处违规）。也就是说这条门禁写着"禁止读构建时钟"，
 * 实际只禁了两种写法——**第三种写法一次都没被守过**。
 */
async function assertNoBuildClock(dir) {
  const violations = [];

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(?:astro|ts)$/.test(entry.name) || entry.name.endsWith('.test.ts')) continue;

      const source = await readFile(full, 'utf8');
      // `Date()` 裸调用也要抓：它和 `new Date()` 一样读当前时间。
      // `(?<![\w.])` 排除掉 `new Date()`（那是允许的形态，上面单独判）
      // 与任何 `x.Date()` 这类成员调用。
      const pattern =
        /\bnew\s+Date\s*\(\s*\)|\bDate\.now\s*\(|(?<![\w.])Date\s*\(\s*\)/g;
      for (const match of source.matchAll(pattern)) {
        const line = source.slice(0, match.index).split('\n').length;
        violations.push(`${full.slice(root.length + 1).replace(/\\/g, '/')}:${line}`);
      }
    }
  }

  await walk(dir);
  if (violations.length > 0) {
    throw new Error(
      `生产源码读取了构建时钟：\n${violations.map((item) => `  - ${item}`).join('\n')}`,
    );
  }
}

async function snapshot(dir) {
  const result = new Map();

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    // 文件系统不保证枚举顺序；检查本身也必须是确定性的。
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }

      const body = await readFile(full);
      const relative = full.slice(dir.length + 1).replace(/\\/g, '/');
      result.set(relative, {
        bytes: body.byteLength,
        sha256: createHash('sha256').update(body).digest('hex'),
      });
    }
  }

  await walk(dir);
  return result;
}

console.log('\n可复现构建检查');
console.log('─'.repeat(64));

await assertNoBuildClock(join(root, 'src'));
console.log('\n生产源码时钟检查通过。');

console.log('\nUTC 时区干净构建…');
await cleanBuild('UTC');
const first = await snapshot(dist);

console.log(`\n得到 ${first.size} 个文件；清空缓存后在 America/Los_Angeles 时区构建…`);
await cleanBuild('America/Los_Angeles');
const second = await snapshot(dist);

const allPaths = [...new Set([...first.keys(), ...second.keys()])].sort();
const differences = [];
for (const path of allPaths) {
  const before = first.get(path);
  const after = second.get(path);
  if (!before) differences.push({ path, reason: '只在第二次构建出现' });
  else if (!after) differences.push({ path, reason: '只在第一次构建出现' });
  else if (before.sha256 !== after.sha256) {
    differences.push({
      path,
      reason: `${before.bytes} B / ${before.sha256.slice(0, 12)} → ${after.bytes} B / ${after.sha256.slice(0, 12)}`,
    });
  }
}

console.log('\n' + '─'.repeat(64));
if (first.size === 0 || second.size === 0) {
  console.error('检查失败：至少一次构建没有产生任何文件。');
  process.exit(1);
}
if (differences.length > 0) {
  console.error(`检查失败：${differences.length} 个产物在 UTC 与 America/Los_Angeles 之间不同。`);
  for (const difference of differences.slice(0, 20)) {
    console.error(`  ✗ ${difference.path}：${difference.reason}`);
  }
  if (differences.length > 20) console.error(`  …另有 ${differences.length - 20} 个`);
  process.exit(1);
}

console.log(`可复现构建检查通过：${second.size} 个文件跨时区逐字节一致。`);
console.log('America/Los_Angeles 构建产物保留在 dist/，可直接预览或部署。\n');
