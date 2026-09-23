#!/usr/bin/env node
/**
 * 搜索可用性检查：页面语言、索引覆盖，以及它们之间的一致性。
 *
 * ── 这个脚本为什么长这样（一段踩坑记录）────────────────────────────
 *
 * 最初它是一份"固定查询集"，在 Node 里加载 dist 的 pagefind.js 逐条断言结果条数。
 * 它跑得很绿，但它测的**不是访问者会遇到的行为**——因为 Pagefind 按页面的
 * `<html lang>` 选择分词器，而 Node 里没有 document，lang 是缺省的：
 *
 *   查询          Node（无 lang）   真实页面（lang="zh-CN"）
 *   中文排版       1 条              6 条，首条正是那篇文章
 *   内容协商       1 条              7 条
 *   设计令牌       1 条              4 条
 *
 * 于是它"发现"了一个不存在的问题（正文里写着「中文排版」的文章搜不到），
 * 并据此加了一段查询降级逻辑；那段逻辑在真实页面上一辈子不会触发。
 * 是浏览器里的实测把它拆穿的。
 *
 * 结论：**要在 Node 里复现浏览器的搜索行为，就得连浏览器环境一起造**
 * （`document`、`location`、Worker 探测……补一个漏一个，补出来的还是不真）。
 * 所以这个脚本不再假装能查，它只断言那些在磁盘上就能确凿判断的事——
 * 其中最重要的一条，恰恰是这次踩坑的根因：**lang 不能丢**。
 *
 * ── 真实页面上的实测基线（2026-09-18，chromium + lang="zh-CN"）──────
 *
 *   排版        7 条   /wiki/cjk-typography/
 *   中文排版     6 条   /cjk-web-typography/     ← 首条就是要找的那篇
 *   网页排版     3 条   /cjk-web-typography/
 *   内容协商     7 条   /wiki/content-negotiation/
 *   设计令牌     4 条   /wiki/design-tokens/
 *   静态站搜索    2 条   /static-site-search/
 *   Pagefind   1 条   /static-site-search/
 *   不存在的词    0 条
 *
 * 用法：`npm run build && npm run verify:search`
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = join(process.cwd(), 'dist');
const problems = [];

if (!existsSync(DIST)) {
  console.log('\n搜索可用性');
  console.log('─'.repeat(64));
  console.log('  ✗ 找不到 dist/ —— 这个检查打在构建产物上，先跑 npm run build');
  process.exit(1);
}

/** 递归列出 dist 下的所有 .html */
async function htmlFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await htmlFiles(full)));
    else if (entry.name.endsWith('.html')) found.push(full);
  }
  return found;
}

/**
 * 递归列出**文件**（不含目录），返回相对 `dir` 的路径，用 `/` 分隔。
 *
 * 别退化成 `readdir` 一层：`dist/pagefind/` 下的 `index/` 与 `fragment/`
 * 就是索引本体，漏掉它们量出来的体积会少一个数量级，而表面上看不出少了什么。
 */
async function walkFiles(dir, prefix = '') {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await walkFiles(join(dir, entry.name), rel)));
    else found.push(rel);
  }
  return found;
}

/** `pagefind.zh-cn_xxx.pf_meta` / entry.json 里的语言键：zh-CN → zh-cn */
const normalizeLang = (lang) => lang.toLowerCase().replace('_', '-');

console.log('\n搜索可用性');
console.log('─'.repeat(64));

// ── 1. 每个页面都要声明语言 ─────────────────────────────────────────
//
// 这不只是无障碍与断行的事：**它同时决定了搜索怎么分词**。
// lang 一旦丢失，Pagefind 会退回不切分中文的模式，
// 搜「中文排版」从 6 条掉到 1 条——用户再也找不到那篇文章，
// 而构建、测试、lint 全都不会出声。这是本项目最提防的那类失败。
const pages = await htmlFiles(DIST);
const langs = new Map();
const missingLang = [];

for (const file of pages) {
  const html = await readFile(file, 'utf-8');
  const match = html.match(/<html[^>]*\slang="([^"]*)"/);
  if (!match || match[1].trim() === '') {
    missingLang.push(file.slice(DIST.length + 1).replace(/\\/g, '/'));
    continue;
  }
  const lang = match[1].trim();
  langs.set(lang, (langs.get(lang) ?? 0) + 1);
}

if (missingLang.length > 0) {
  console.log(`  ✗ ${missingLang.length}/${pages.length} 个页面没有 <html lang>`);
  console.log(`      例：${missingLang.slice(0, 3).join('、')}`);
  problems.push(`${missingLang.length} 个页面缺少 <html lang>（会让搜索退回不切分中文的模式）：`
    + missingLang.slice(0, 3).join('、') + (missingLang.length > 3 ? ' 等' : ''));
}

if (langs.size === 0) {
  // 上面已经报过了
} else if (langs.size === 1 && missingLang.length === 0) {
  const [lang, count] = [...langs.entries()][0];
  console.log(`  ✓ ${count} 个页面都声明了 lang="${lang}"`);

  /*
   * ── 一致 ≠ 正确 ────────────────────────────────────────────────────
   *
   * 上面那条只保证**全站一致**。实测（2026-09-24）把 `<html lang>`
   * 从 `zh-CN` 改成 `xx-YY`——一个根本不存在的语言——
   * 这个检查仍然三项全绿：页面一致、索引语言一致、覆盖完整。
   *
   * 而后果恰恰是本项目最提防的那件事：Pagefind 按 lang 选分词器，
   * `xx-YY` 选不出中文分词器，**搜「中文排版」会退化**，
   * 页面还在、构建还绿、测试全过——只是用户再也搜不到那篇文章。
   *
   * 所以这里要比对**配置里声明的那个** lang。
   * 读 `src/config.ts` 的文本而不是 import：那是 `.ts` 且内部有 `.js` 后缀
   * import，裸 Node 加载不了（见 check-portability.mjs 里那个约束）。
   */
  const configText = await readFile(join(process.cwd(), 'src', 'config.ts'), 'utf8').catch(
    () => null,
  );
  const declared = configText?.match(/\blang:\s*'([^']+)'/)?.[1];
  if (!declared) {
    problems.push(
      '从 src/config.ts 里读不出 site.lang——' +
        '**门禁失去了「一致但错」的唯一防线**，先查配置文件的写法。',
    );
  } else if (normalizeLang(lang) !== normalizeLang(declared)) {
    problems.push(
      `页面声明的 lang 是 "${lang}"，而 src/config.ts 里 site.lang 是 "${declared}"。` +
        `**一致不等于正确**——Pagefind 按 lang 选分词器，` +
        `一个不存在的语言标签会让中文分词静默失效：` +
        `页面还在、构建还绿、测试全过，只是用户再也搜不到那篇文章。`,
    );
  } else {
    console.log(`  ✓ 页面 lang 与 site.lang 一致（${declared}）`);
  }
} else if (langs.size > 1) {
  console.log(`  ✗ 页面语言不一致：${[...langs].map(([l, n]) => `${l}×${n}`).join('、')}`);
  problems.push('页面语言不一致——索引会按语言分片，中英混排的站需要显式处理');
}

// ── 2. 索引语言要与页面语言对得上 ───────────────────────────────────
//
// Pagefind 按 lang 建索引。两边对不上时，搜索会去加载一个根本不存在的语言索引，
// 表现是"搜什么都搜不到"——而构建仍然成功。
const entryFile = join(DIST, 'pagefind', 'pagefind-entry.json');
let entry;
try {
  entry = JSON.parse(await readFile(entryFile, 'utf-8'));
} catch {
  console.log('  ✗ 找不到 dist/pagefind/pagefind-entry.json —— 先跑 npm run build');
  problems.push('搜索索引不存在');
}

if (entry) {
  const indexed = Object.keys(entry.languages ?? {});
  const declared = [...langs.keys()].map(normalizeLang);
  const missing = declared.filter((l) => !indexed.includes(l));
  if (missing.length === 0) {
    console.log(`  ✓ 索引语言与页面语言一致：${indexed.join('、')}`);
  } else {
    console.log(`  ✗ 页面声明了 ${declared.join('、')}，索引里只有 ${indexed.join('、')}`);
    problems.push(`索引缺少页面声明的语言：${missing.join('、')}`);
  }

  // ── 3. 该进索引的页面一个都不能少 ─────────────────────────────────
  //
  // ⚠️ **这里的断言必须从别处独立推导"应被索引的页面集"，否则它会恒真。**
  //
  // 索引范围由 data-pagefind-body 决定。原先这条是拿
  // `total`（Pagefind 报的已索引页数）与 `marked`（HTML 里数 data-pagefind-body）
  // 相比——**两者来自同一个属性**：漏标时两边等量下降，相等照样成立。
  //
  // 实测（2026-09-22）：把知识库模板里的 `data-pagefind-body` 去掉、干净重建后，
  // 6 个 wiki 条目整类退出索引（11 → 5），而这条打印的是
  // 「✓ 索引覆盖 5 个页面，与标记了 data-pagefind-body 的页面数一致」并**通过**。
  // 它要防的正是这件事，却量不出这件事——注释里那句「漏标的页面不会报错，
  // 它只是从此搜不到」说的就是它自己。
  //
  // 现在改成从**内容清单**取：清单是构建期按内容层生成的（文章 + 知识条目），
  // 与"HTML 上有没有那个属性"没有关系。两边对不上才是真信号。
  const manifestFile = join(DIST, 'content-manifest.json');
  let expected = null;
  try {
    const manifest = JSON.parse(await readFile(manifestFile, 'utf-8'));
    const home = manifest.site?.home ?? '';
    expected = (manifest.documents ?? []).map((doc) => {
      const url = doc.urls?.html ?? '';
      const rel = home && url.startsWith(home) ? url.slice(home.length) : url;
      return { id: doc.id, path: rel.endsWith('/') ? `${rel}index.html` : rel };
    });
  } catch {
    console.log('  ✗ 读不到 dist/content-manifest.json —— 没有它就无法独立推出"该进索引的页面集"');
    problems.push('内容清单不存在，索引覆盖面无法独立核对（读不到 ≠ 通过）');
  }

  const counts = Object.values(entry.languages ?? {}).map((l) => l.page_count ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);

  if (expected) {
    // ① 逐个内容页确认它真的标了 —— 这才能抓住"整类页面漏标"
    const unmarked = [];
    for (const doc of expected) {
      const file = join(DIST, doc.path);
      if (!existsSync(file)) {
        unmarked.push(`${doc.id}（产物里没有 ${doc.path}）`);
        continue;
      }
      const html = await readFile(file, 'utf-8');
      if (!html.includes('data-pagefind-body')) {
        unmarked.push(`${doc.id}（${doc.path} 没有 data-pagefind-body）`);
      }
    }

    // ② 再要求索引页数与内容条目数一致（清单有 11 条，索引就该收 11 页）
    if (unmarked.length === 0 && total === expected.length) {
      console.log(`  ✓ 内容清单里的 ${expected.length} 个条目全部进了索引，且都标了 data-pagefind-body`);
    } else if (unmarked.length > 0) {
      console.log(`  ✗ ${unmarked.length}/${expected.length} 个内容页没进索引：`);
      for (const u of unmarked.slice(0, 5)) console.log(`      ${u}`);
      problems.push(`${unmarked.length} 个内容页没有 data-pagefind-body，会静默退出搜索：`
        + unmarked.slice(0, 3).join('、') + (unmarked.length > 3 ? ' 等' : ''));
    } else {
      console.log(`  ✗ 索引收了 ${total} 个页面，而内容清单里有 ${expected.length} 个条目`);
      problems.push(`索引页数（${total}）与内容清单条目数（${expected.length}）对不上`);
    }
  }
}

// ── 4. JS 体积：文档写着「文章页 0 个 JS 文件」，这里把它钉住 ──────────
//
// 这一节的由来（2026-09-22）：`docs/compare.md` 那一行原先写作
// 「外部 JS | **0 个文件** | 少量 + Pagefind | Swup + Svelte | 少量 + Fuse.js」。
// 那句话**不算错**——「外部」= 第三方域名，确实是 0——**但读起来会得出错误结论**：
// 对照列里那三家列的都是**自己站内的脚本**，同一行两端口径不同，
// 读出来的就是「本项目不加载 JS，它们加载」。而实测搜索页要取 183 KB（gzip）。
//
// 而且这件事**用 `<script src>` 是扫不出来的**：Pagefind 由内联加载器 + 动态
// `import()` 拉取，全站任何一个 HTML 里的 `src=` 计数都是 0。
// 换句话说，一个只会数 `src=` 的检查**永远给不出这个数**——
// 这已经不是「检查没写」，是「用错了尺子」。
//
// 所以这里分三条钉，每条对应文档里一句可以被验证的话：
//   a. 全站 `<script src>` 为 0（无论外链还是站内脚本文件）——「外链 JS 0 个」
//   b. 恰好一个页面（搜索页）内联加载 `pagefind/pagefind.js`——「只有搜索页加载」
//   c. 那个 loader 要取的脚本与 wasm 在产物里真的存在
//      （取不到时 loader 自己 `catch` 掉，搜索**静默失效**，正是本项目最防的那类）

const scriptSrcRe = /<script[^>]*\ssrc\s*=\s*["']([^"']*)["']/gi;
const pagesWithSrc = [];
const externalSrc = [];
let searchPages = [];

for (const file of pages) {
  const rel = file.slice(DIST.length + 1).replace(/\\/g, '/');
  const html = await readFile(file, 'utf-8');
  const srcs = [...html.matchAll(scriptSrcRe)].map((m) => m[1]);
  if (srcs.length > 0) pagesWithSrc.push(`${rel}（${srcs.join('、')}）`);
  for (const src of srcs) {
    if (/^(https?:)?\/\//i.test(src)) externalSrc.push(`${rel} → ${src}`);
  }
  if (html.includes('pagefind/pagefind.js')) searchPages.push({ rel, html });
}

if (pagesWithSrc.length === 0) {
  console.log('  ✓ 全站无 `<script src>`：外链 0 个，站内脚本文件 0 个');
} else if (externalSrc.length > 0) {
  console.log(`  ✗ ${externalSrc.length} 处脚本指向站外域名：`);
  for (const e of externalSrc.slice(0, 3)) console.log(`      ${e}`);
  problems.push(`出现外链 JS（文档与徽章承诺全站 0 个）：${externalSrc[0]}`);
} else {
  console.log(`  ✗ ${pagesWithSrc.length} 个页面用 <script src> 引了脚本文件：`);
  for (const p of pagesWithSrc.slice(0, 3)) console.log(`      ${p}`);
  problems.push(`文章页不再是「0 个 JS 文件」（${pagesWithSrc.length} 个页面引了脚本文件）：`
    + pagesWithSrc[0] + '——若这是有意为之，README 与 docs/compare.md 的数字要一起改');
}

if (searchPages.length === 1) {
  console.log(`  ✓ 只有 ${searchPages[0].rel} 内联加载 Pagefind（其余页面不搜索就不下载）`);

  const PF = join(DIST, 'pagefind');
  const produced = existsSync(PF) ? await walkFiles(PF) : [];
  const sizes = new Map();
  for (const rel of produced) {
    const buf = await readFile(join(PF, rel));
    sizes.set(rel, { raw: buf.length, gz: gzipSync(buf, { level: 9 }).length });
  }
  const missing = ['pagefind.js', 'pagefind-worker.js', 'pagefind-entry.json']
    .filter((f) => !existsSync(join(PF, f)));
  const hasIndex = produced.some((f) => f.startsWith('wasm.') || f.endsWith('.pf_meta'));

  // Pagefind 的运行时会请求哪些文件——**按它的文件命名约定分类，不是 grep 出来的**。
  // 为什么不能 grep：索引分片名里的 hash 是运行时拼的（`pagefind.${hash}.pf_meta`），
  // 静态搜文件名一个都搜不到；而反过来，那三套没用上的 UI 包**搜也搜不到**，
  // 因为它们同样没有出现在任何已加载文件的正文里——同一个方法给出两种错。
  const isRuntime = (rel) => rel === 'pagefind.js' || rel === 'pagefind-worker.js'
    || rel === 'pagefind-entry.json' || rel.startsWith('wasm.')
    || rel.endsWith('.pf_meta') || rel.startsWith('index/') || rel.startsWith('fragment/');
  const isShard = (rel) => rel.startsWith('index/') || rel.startsWith('fragment/');

  if (missing.length === 0 && hasIndex) {
    // 体积只打印不硬断言：Pagefind 升级会让它变，那是正常的。
    // 但**数字必须量对**——文档里写死的数是会被读的人当真的。
    //
    // 这里踩过两次，都记在这：
    //   ① 只 `readdir` 顶层 → 漏掉 `index/` 与 `fragment/` 两个子目录，**整个索引没算**
    //   ② 把顶层文件全算成"要下载的" → 多算了三套本站根本不用的 UI 包
    //      （`pagefind-ui.js` 120 KB、`pagefind-component-ui.js` 175 KB、
    //       `pagefind-modular-ui.js` 14 KB）。实测确认过：`pagefind.js` 正文里
    //       只出现 `pagefind-entry.json` 与 `pagefind-worker.js`，三个 UI 包名一个都没有。
    // 两次都是"看着挺对"的数。所以现在按运行时文件集分类，并把**从不请求的那部分**
    // 也单独报出来——它不该混进访问者的下载量里。
    const sum = (list) => list.reduce((a, rel) => a + sizes.get(rel).raw, 0);
    const sumGz = (list) => list.reduce((a, rel) => a + sizes.get(rel).gz, 0);
    const used = produced.filter(isRuntime);
    const shards = used.filter(isShard);
    const unused = produced.filter((rel) => !isRuntime(rel));
    const html = searchPages[0].html;
    const inline = [...html.matchAll(/<script((?![^>]*\ssrc=)[^>]*)>([\s\S]*?)<\/script>/g)]
      .filter((m) => !m[1].includes('ld+json'))
      .reduce((n, m) => n + Buffer.byteLength(m[2]), 0);

    console.log('  ✓ 搜索页要加载的 Pagefind 入口、worker、索引与分词器都在产物里');
    console.log(`      搜索页内联 ${(inline / 1024).toFixed(2)} KB`);
    console.log(`      搜索页用到的 Pagefind（${used.length} 个文件）`
      + ` ${(sum(used) / 1024).toFixed(0)} KB → gzip ${(sumGz(used) / 1024).toFixed(0)} KB`);
    console.log(`        其中索引分片 index/ + fragment/ 共 ${shards.length} 个：`
      + `${(sum(shards) / 1024).toFixed(0)} KB（按语言与查询取，不是一次性下完）`);
    if (unused.length > 0) {
      console.log(`      · 产物里另有 ${unused.length} 个 Pagefind 自带 UI 包本站**从不请求**：`
        + `${(sum(unused) / 1024).toFixed(0)} KB（只增加产物体积，不进任何访问者的带宽）`);
    }
  } else {
    const lack = missing.length > 0 ? missing : ['索引或分词器（wasm.*.pagefind / *.pf_meta）'];
    console.log(`  ✗ 搜索页的内联加载器会去取 dist/pagefind/ 下的文件，但产物里缺：${lack.join('、')}`);
    console.log('      loader 取不到时会自己 catch 掉，搜索**静默失效**——构建与页面都不报错');
    problems.push('dist/pagefind/ 缺少搜索页要加载的文件，搜索会静默失效');
  }
} else if (searchPages.length === 0) {
  console.log('  ✗ 没有任何页面加载 Pagefind —— 搜索页的 loader 不见了');
  problems.push('找不到加载 Pagefind 的页面，搜索入口失效');
} else {
  console.log(`  ✗ ${searchPages.length} 个页面都在加载 Pagefind：`
    + searchPages.map((p) => p.rel).join('、'));
  problems.push(`${searchPages.length} 个页面加载了 Pagefind——文档说的是「只在搜索页加载」`);
}

console.log('\n' + '─'.repeat(64));
if (problems.length === 0) {
  console.log('搜索可用性检查通过。\n');
} else {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log('');
}
process.exitCode = problems.length === 0 ? 0 : 1;
