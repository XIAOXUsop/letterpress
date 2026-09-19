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

import { runAstro } from './lib/astro.mjs';
import { cleanBuildState } from './lib/clean.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** 用这个假 base 构建。选它是因为长度与真实的仓库名接近。 */
const FAKE_BASE = '/letterpress';

const root = process.cwd();
const dist = join(root, 'dist');

console.log(`\n子路径部署检查（SITE_BASE=${FAKE_BASE}）`);
console.log('─'.repeat(64));

// 干净的构建，避免缓存的产物混进来
await cleanBuildState(root);

console.log('\n用假 base 构建…');
// 环境变量在 Node 里传给子进程，不经过任何 shell —— Git Bash 的路径转换
// （把 /letterpress 改成 D:/App/Git/letterpress）碰不到它。
const buildCode = await runAstro(['build'], { env: { SITE_BASE: FAKE_BASE } });

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

    /*
     * 匹配**真实标签上的** `href` / `src` 属性，排除协议相对地址（//example.com）。
     *
     * 正则必须以 `<[^>]*\s` 开头：**不加这个锚点会误报正文里的代码示例**。
     *
     * 实测：知识库里一篇讲「检查本身是坏的」的条目里写了
     * `<code>href="/x"</code>`——它是正文文本，但字面形式与属性完全相同，
     * 于是被判成「缺 base 前缀的链接」，构建检查失败。
     *
     * 对模板来说这是硬伤：**使用者写一篇提到 `href="/foo"` 的文章，
     * 子路径检查就会红**，而失败原因和他的文章毫无关系。
     * 页面上的真链接一定在某个标签内部，所以把匹配限定在标签里。
     */
    for (const m of html.matchAll(/<[^>]*\s(?:href|src)="(\/[^/"][^"]*)"/g)) {
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

/**
 * ── 还要查 JS 块里的运行时路径 ──────────────────────────────────
 *
 * 上面那条只扫 `href` / `src` 属性。**实测漏过一次**：搜索页的
 * `import('/pagefind/pagefind.js')` 写死在脚本里、不走属性，
 * 于是本地一切正常、上线后搜索框永远转圈——而那条扫描报「全部通过」。
 *
 * 教训与项目里反复出现的是同一个：**只检查一类载体，就只守住那一类**。
 */
const scriptProblems = new Map();

async function scanScripts(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanScripts(full);
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;

    const html = await readFile(full, 'utf8');
    const rel = full.slice(dist.length + 1).replace(/\\/g, '/');

    // 只看 <script> 块内部——正文里出现的 "/xxx" 不是路径
    for (const block of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
      for (const m of (block[1] ?? '').matchAll(/["'`]\/([a-z][\w-]*\/[^"'`\s]*)/gi)) {
        const url = `/${m[1]}`;
        // 只认已知的资源目录，避免把数据字符串误判成路径
        if (!/^\/(pagefind|_astro|og|favicon)/.test(url)) continue;
        if (url.startsWith(`${FAKE_BASE}/`)) continue;

        const list = scriptProblems.get(url) ?? [];
        list.push(rel);
        scriptProblems.set(url, list);
      }
    }
  }
}

await scanScripts(dist);

/**
 * ── 查绝对 URL 里的前缀翻倍 ────────────────────────────────────
 *
 * **这条是补上来的，因为上一版检查报「通过」而线上是坏的。**
 *
 * 当时的扫描只匹配 `href="/xxx"` / `src="/xxx"` 这种**相对绝对路径**。
 * 而产物里有另一类地址：`og:image`、RSS 自动发现、sitemap、JSON-LD、
 * llms.txt、rss.xml —— 它们是 `https://` 开头的完整 URL，**根本不进正则**。
 *
 * 于是 `site.url` 与 `SITE_BASE` 各写了一遍子路径、代码把两者相加，
 * 产物里全是 `https://…/letterpress/letterpress/og.png`，
 * 分享图 404、RSS 无法被阅读器发现、llms.txt 整份是死链清单——
 * 而检查报「子路径部署检查通过」。
 *
 * 教训很直白：**检查的覆盖面必须跟着「地址出现在哪些载体里」走**，
 * 而不是跟着「我知道的几种写法」走。
 */
const doubled = new Map();

async function scanDoubled(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanDoubled(full);
      continue;
    }
    // HTML 之外还有 llms.txt / rss.xml / sitemap —— 它们是纯文本产物，
    // 恰恰是最容易漏、也最容易被 agent 与阅读器读到的那几份
    if (!/\.(html|txt|xml|json|ndjson)$/.test(entry.name)) continue;

    const text = await readFile(full, 'utf8');
    const rel = full.slice(dist.length + 1).replace(/\\/g, '/');
    const n = (text.match(new RegExp(`${FAKE_BASE}${FAKE_BASE}`, 'g')) ?? []).length;
    if (n > 0) doubled.set(rel, n);
  }
}

await scanDoubled(dist);

console.log('\n检查绝对 URL 是否前缀翻倍');
if (doubled.size === 0) {
  console.log('  ✓ 没有前缀翻倍');
} else {
  for (const [rel, n] of doubled) problems.set(rel, [`前缀翻倍 ×${n}`]);
  console.log(`  ✗ ${doubled.size} 个产物里有翻倍前缀：`);
  for (const [rel, n] of [...doubled].sort()) {
    console.log(`      ${rel}   ×${n}`);
  }
}

/**
 * ── 查纯文本产物里的链接 ────────────────────────────────────────
 *
 * 这是**第三类载体**了，每一类都是踩过之后才补上的：
 *
 *   一、`href` / `src` 属性      —— 最初的检查只覆盖这类
 *   二、`<script>` 内的路径       —— 搜索脚本的 `import()` 漏网
 *   三、`llms.txt` 这类纯文本     —— 它的 URL 是**拼出来的**，
 *                                  既不进属性也不进脚本
 *
 * llms.txt 的坑还格外隐蔽：`siteOrigin()` 剥掉重复的部署前缀是对的，
 * 但剥完**没把 base 加回来**，于是 8 条链接全部指向域名根。
 * 而它是**给 agent 读的**——一份死链清单比没有这份清单更糟。
 */
const textLinkProblems = [];

for (const name of ['llms.txt', 'llms-full.txt']) {
  let text;
  try {
    text = await readFile(join(dist, name), 'utf8');
  } catch {
    textLinkProblems.push(`${name} 不存在`);
    continue;
  }

  // markdown 链接与裸 URL 都算
  const urls = [
    ...[...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/(?:^|\s)(https?:\/\/\S+)/gm)].map((m) => m[1]),
  ];

  // 给机器看的同步入口也必须是可直接访问的完整地址。只扫描文章链接会漏掉
  // notes 里写死的 `/content.ndjson`，在项目站子路径下它会悄悄指向域名根。
  for (const endpoint of ['content.ndjson', 'content-manifest.json']) {
    const expected = `https://xiaoxusop.github.io${FAKE_BASE}/${endpoint}`;
    if (!urls.includes(expected)) {
      textLinkProblems.push(`${name}: 缺少带 base 的机器入口 ${expected}`);
    }
  }

  for (const url of urls) {
    if (!url.startsWith('http')) continue;
    const path = new URL(url).pathname;

    // 站点自己的地址（含 base）应当且仅应当出现一次 base
    if (url.includes(`${FAKE_BASE}${FAKE_BASE}`)) {
      textLinkProblems.push(`${name}: 前缀翻倍 ${url}`);
    } else if (url.includes('xiaoxusop.github.io') && !path.startsWith(`${FAKE_BASE}/`)) {
      textLinkProblems.push(`${name}: 缺 base 前缀 ${url}`);
    }
  }
}

console.log('\n检查纯文本产物里的链接');
if (textLinkProblems.length === 0) {
  console.log('  ✓ llms.txt / llms-full.txt 里的链接前缀正确');
} else {
  for (const p of textLinkProblems) problems.set(p, ['纯文本产物']);
  console.log(`  ✗ ${textLinkProblems.length} 处问题：`);
  for (const p of textLinkProblems.slice(0, 8)) console.log(`      ${p}`);
}

// RSS 的 self-link 是 XML 属性，不属于 HTML / llms / JSON 三类扫描。
// 现在除了全站源还有每个标签的源，必须递归检查，不能只守住根目录那一份。
console.log('\n检查所有 RSS self-link');
const rssFiles = [];
async function collectRss(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collectRss(full);
    else if (entry.name === 'rss.xml') rssFiles.push(full);
  }
}

try {
  await collectRss(dist);
  if (rssFiles.length === 0) throw new Error('没有生成任何 rss.xml');

  let rssProblems = 0;
  for (const full of rssFiles) {
    const rel = full.slice(dist.length + 1).replace(/\\/g, '/');
    const rss = await readFile(full, 'utf8');
    const match = /<atom:link\b[^>]*\bhref="([^"]+)"[^>]*\brel="self"/.exec(rss);
    if (!match?.[1]) {
      problems.set(`${rel} 缺少 atom:link rel="self"`, ['RSS']);
      rssProblems++;
      continue;
    }

    const pathname = decodeURIComponent(new URL(match[1]).pathname);
    const expected = `${FAKE_BASE}/${rel}`;
    if (pathname !== expected) {
      problems.set(`${rel} self-link 路径错误：${pathname}`, ['RSS']);
      rssProblems++;
    }
  }

  if (rssProblems === 0) {
    console.log(`  ✓ ${rssFiles.length} 份 RSS 都带且只带一次 base 前缀`);
  } else {
    console.log(`  ✗ ${rssProblems} 份 RSS 的 self-link 错误`);
  }
} catch (error) {
  const problem = `RSS 不存在或无法读取：${error instanceof Error ? error.message : String(error)}`;
  problems.set(problem, ['RSS']);
  console.log(`  ✗ ${problem}`);
}

// JSON 内容清单里的 URL 同样必须带且只带一次 base；它不是 HTML 属性，
// 也不属于 llms.txt，少这一层就会成为第四个扫描盲区。
console.log('\n检查内容清单里的链接');
try {
  const manifest = JSON.parse(await readFile(join(dist, 'content-manifest.json'), 'utf8'));
  const manifestProblems = [];
  const urls = [manifest.site?.home, ...manifest.documents.flatMap((doc) => Object.values(doc.urls ?? {}))];
  for (const value of urls) {
    if (typeof value !== 'string') {
      manifestProblems.push('存在非字符串 URL');
      continue;
    }
    const pathname = value.startsWith('http') ? new URL(value).pathname : value;
    if (!pathname.startsWith(`${FAKE_BASE}/`)) manifestProblems.push(`缺 base 前缀 ${value}`);
    if (pathname.includes(`${FAKE_BASE}${FAKE_BASE}`)) manifestProblems.push(`前缀翻倍 ${value}`);
  }

  if (manifestProblems.length === 0) {
    console.log('  ✓ content-manifest.json 里的链接前缀正确');
  } else {
    for (const problem of manifestProblems) problems.set(problem, ['内容清单']);
    for (const problem of manifestProblems.slice(0, 8)) console.log(`  ✗ ${problem}`);
  }
} catch (error) {
  const problem = `内容清单不存在或无法解析：${error instanceof Error ? error.message : String(error)}`;
  problems.set(problem, ['内容清单']);
  console.log(`  ✗ ${problem}`);
}

// NDJSON 每一行都是 JSON，但扩展名与 manifest 不同，必须单独验证其中全部 URL。
console.log('\n检查全量内容导出里的链接');
try {
  const body = await readFile(join(dist, 'content.ndjson'), 'utf8');
  const records = body
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const exportProblems = [];
  for (const record of records) {
    const urls = [record.site?.home, ...Object.values(record.urls ?? {})];
    for (const value of urls) {
      if (typeof value !== 'string') {
        exportProblems.push(`${record.id ?? '未知记录'} 存在非字符串 URL`);
        continue;
      }
      const pathname = value.startsWith('http') ? new URL(value).pathname : value;
      if (!pathname.startsWith(`${FAKE_BASE}/`)) exportProblems.push(`缺 base 前缀 ${value}`);
      if (pathname.includes(`${FAKE_BASE}${FAKE_BASE}`)) exportProblems.push(`前缀翻倍 ${value}`);
    }
  }

  if (records.length > 0 && exportProblems.length === 0) {
    console.log(`  ✓ content.ndjson 的 ${records.length} 条记录链接前缀正确`);
  } else {
    if (records.length === 0) exportProblems.push('content.ndjson 没有记录');
    for (const problem of exportProblems) problems.set(problem, ['全量内容导出']);
    for (const problem of exportProblems.slice(0, 8)) console.log(`  ✗ ${problem}`);
  }
} catch (error) {
  const problem = `全量内容导出不存在或无法解析：${error instanceof Error ? error.message : String(error)}`;
  problems.set(problem, ['全量内容导出']);
  console.log(`  ✗ ${problem}`);
}

console.log('\n检查脚本里的资源路径是否带 base 前缀');
if (scriptProblems.size === 0) {
  console.log('  ✓ 脚本里的资源路径都带 base 前缀');
} else {
  for (const [url, files] of scriptProblems) problems.set(url, files);
  console.log(`  ✗ ${scriptProblems.size} 处没带前缀：`);
  for (const [url, files] of [...scriptProblems].sort()) {
    console.log(`      ${url}   （${files.length} 个页面，例如 ${files[0]}）`);
  }
}

console.log('\n检查绝对路径是否都带 base 前缀');
if (problems.size === 0) {
  console.log('  ✓ 全部链接都带 base 前缀');
} else {
  console.log(`  ✗ ${problems.size} 种路径没带前缀：`);
  for (const [url, files] of [...problems].sort()) {
    console.log(`      ${url}   （出现在 ${files.length} 个页面，例如 ${files[0]}）`);
  }
}

// 链接地址正确不代表导航状态正确：pathname 含 base，而配置项不含。
console.log('\n检查子路径下的当前导航状态');
for (const [page, label] of [
  ['posts/index.html', '文章'],
  ['wiki/index.html', '知识库'],
  ['search/index.html', '搜索'],
]) {
  try {
    const html = await readFile(join(dist, page), 'utf8');
    const current = /<a\b[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/.exec(html)?.[1];
    if (current === label) {
      console.log(`  ✓ ${label}页正确标记当前导航`);
    } else {
      const problem = `${label}页当前导航错误（实际 ${current ?? '无'}）`;
      problems.set(problem, [page]);
      console.log(`  ✗ ${problem}`);
    }
  } catch {
    const problem = `${label}页不存在，无法检查当前导航`;
    problems.set(problem, [page]);
    console.log(`  ✗ ${problem}`);
  }
}

// ── 顺带确认产物结构没被 base 弄坏 ──────────────────────────────
const required = [
  'index.html',
  'posts/index.html',
  'wiki/index.html',
  'content-manifest.json',
  'og.png',
  'robots.txt',
];
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
