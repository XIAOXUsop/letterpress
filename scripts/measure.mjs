#!/usr/bin/env node
/**
 * 实测产物：把 README 实测数据表里的数字**逐条量一遍**，用门禁的同一套口径。
 *
 * ── 为什么要有这个命令 ──────────────────────────────────────────────
 *
 * 2026-09-24 一天之内，我在核对 README 数字时**连续四次量错**：
 *
 *   ① 用 `du -sk` 量字体 → 104，而门禁用字节数得 100（`du` 按 4 KB 块对齐）
 *   ② 写「6 个 js + 1 个 wasm」→ wasm 是**推的**，实际 `find` 出来 0 个
 *   ③ 门禁的错误信息里写「`du -sk` 得出 25」→ 那是 `ceil(bytes/4096)`，
 *      而 `du` 实际报 104（块对齐**之后**再算 KB）——两个不同的算法
 *   ④ 刚才用 `int(102164/1024)` 量字体 → 99，而 `round` 得 100
 *
 * **四次都是同一个根因：每次重新发明量法。**
 * 而门禁的口径**早就写在代码里**（`check-formats.mjs` 里的
 * `Math.round(bytes / 1024)`、`gzipSync(..., { level: 9 })`）。
 *
 * > **量法本身是代码，就该复用而不是重写。**
 * > 同一个量算两遍，两个结果里必有一个是「我的那套」——
 * > 而我的那套从来没有第二双眼睛。
 *
 * 所以这个命令**不重新实现任何口径**：它 import 门禁用的那个模块，
 * 或者更直接——**它就是门禁的那段逻辑，只是把「有问题」换成「打印出来」**。
 *
 * ⚠️ **必须先有产物**：`verify:formats` 跑完会清掉 `dist`（避免污染后续构建），
 * 所以本命令报「没有 dist」时先跑 `npm run build`。
 *
 * 用法：`npm run measure`（需先 build）
 */
import { readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');

/*
 * ⚠️ **本命令自己构建，不依赖调用者记得先 build。**
 *
 * `verify:formats` 与 `verify:reproducible` 跑完都会清掉 `dist`
 * （避免污染后续构建），所以「先 build 再 measure」这个顺序**极易被破坏**——
 * 中间插一次 verify，dist 就没了，而报错只说「没有 dist」，
 * 看不出是「忘了 build」还是「被谁清了」。
 *
 * 所以：**没有 dist 就自己跑一遍 `npm run build`。**
 * 代价是慢一点，换来的是「这条命令什么时候都能跑对」。
 */
async function hasDist() {
  try {
    await readdir(dist);
    return true;
  } catch {
    return false;
  }
}

if (!(await hasDist())) {
  console.log('没有 dist/，先跑一次 npm run build…\n');
  const { runAstro } = await import('./lib/astro.mjs');
  const { runNodeBin } = await import('./lib/astro.mjs');
  const { cleanBuildState } = await import('./lib/clean.mjs');
  await cleanBuildState(root);
  if ((await runAstro(['build'])) !== 0) {
    console.error('构建失败。');
    process.exit(1);
  }
  // 第二段也必须跑：站内 JS 全部来自 Pagefind 产物，
  // **只跑 astro build 的话 dist 里一个 js 都没有**（本轮为此白加过一条门禁）。
  if ((await runNodeBin('pagefind', ['--site', dist], {})) !== 0) {
    console.error('Pagefind 索引失败——站内 JS 的数字会不对。');
    process.exit(1);
  }
  console.log('');
}

console.log('产物实测（口径与 check-formats.mjs 完全一致）');
console.log('─'.repeat(64));

// ── CSS：与门禁同一段口径 ───────────────────────────────────────────
const astroDir = join(dist, '_astro');
try {
  const cssFiles = (await readdir(astroDir)).filter((f) => f.endsWith('.css')).sort();
  if (cssFiles.length > 0) {
    const buf = await readFile(join(astroDir, cssFiles[0]));
    const gz = gzipSync(buf, { level: 9 });
    console.log(`  CSS 单文件       ${(buf.length / 1024).toFixed(1)} KB / gzip ${(gz.length / 1024).toFixed(1)} KB`);
    console.log(`                   （${buf.length} bytes，gzip level 9，不是 gzip -c）`);
  }
} catch {
  console.log('  CSS             （_astro 里没有 .css）');
}

// ── 字体：一律用字节数，`du -sk` 会按 4 KB 块对齐 ──────────────────
try {
  const fontFiles = (await readdir(astroDir)).filter((f) => f.endsWith('.woff2'));
  let fontBytes = 0;
  for (const f of fontFiles) fontBytes += (await readFile(join(astroDir, f))).length;
  console.log(
    `  字体合计         ${Math.round(fontBytes / 1024)} KB / ${fontFiles.length} 个文件` +
      `（${fontBytes} bytes；不要用 du -sk）`,
  );
} catch {
  console.log('  字体             （_astro 里没有 .woff2）');
}

// ── 页数与产物类型 ─────────────────────────────────────────────────
/** 递归列出 dist 下所有文件。用 Node 遍历而不是 spawn `find`——少一层转义。 */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const all = await walk(dist);
const byExt = (ext) => all.filter((f) => f.endsWith(`.${ext}`));
const totalBytes = async (list) => {
  let sum = 0;
  for (const f of list) sum += (await readFile(f)).length;
  return sum;
};

console.log(`  HTML 页面        ${byExt('html').length}`);
console.log(`  markdown 孪生    ${byExt('md').length}`);

const jsFiles = byExt('js');
console.log(`  JS 文件          ${jsFiles.length}`);
if (jsFiles.length > 0) {
  const jsBytes = await totalBytes(jsFiles);
  console.log(`  JS 未压缩合计    ${Math.round(jsBytes / 1024)} KB`);
  /*
   * ⚠️ **gzip 那一行是 2026-09-24 补的**，而它补的原因是：
   * 文档里流传着三个不同的 gzip 数（93 / 105 / 146 KB），
   * **没有一个是任何命令能产出的**——所以它们只能靠手抄，也就只能漂。
   *
   * > 146 KB 那个尤其糟：README 已经写明「在当前环境**已无法复现**」，
   * > 而 `design-notes.md` 里它还以「实测」的身份活着（已改）。
   *
   * 口径与 CSS / 字体那两行一致：`gzipSync(bytes, { level: 9 })`
   * ——**不是 `gzip -c`**（那个的口径不同，见文件里 CSS 那行的注释）。
   *
   * ⚠️ **它是「全部 js 文件」的合计**，而「访问者真正会加载哪几个」
   * 取决于 `pagefind.js` 内部按需加载哪些 UI 组件——
   * **那要浏览器网络面板才能确认，Node 里测不出来**。
   * 所以 README 里那个更窄的数字（5 个 js / 93 KB）在本命令里**对不上**是正常的，
   * 本行给的是**可复现的上界**。
   */
  let gzipBytes = 0;
  for (const file of jsFiles) {
    gzipBytes += gzipSync(await readFile(file), { level: 9 }).length;
  }
  console.log(`  JS gzip 合计     ${Math.round(gzipBytes / 1024)} KB（全部 ${jsFiles.length} 个，可复现上界）`);
}

console.log('\n  这几个数与 README「实测数据」表里的对应项可以直接比对。');
console.log('  若不一致，改 README 之前**先确认口径**——本命令的口径就是门禁的口径。\n');
