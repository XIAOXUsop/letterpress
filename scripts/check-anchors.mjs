#!/usr/bin/env node
/**
 * 锚点契约：HTML 里每一个**站内链接的片段**都必须真的存在。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────
 *
 * 2026-09-22 实测：`lint` 对 `[[target#missing-heading]]` **不报任何错**——
 * 它只检查目标**页面**存不存在，从不看 `#` 后面那段。
 * 于是「这条结论见第 3.2 节」这种引用可以指向一个不存在的小节，
 * 构建通过、测试全绿、读者点过去才发现落在了页面顶部。
 *
 * 知识层越多、跨页引用越多，这条越要命：它的坏法不是报错，是**静默跳错位置**。
 *
 * ── 为什么在产物上查，而不是在源码上再解析一遍 ──────────────────────
 *
 * 源码里没有"小节 ID"这个东西——它是 `rehype-heading-links` 在渲染期用
 * `github-slugger` 生成的，而且**重复标题会带 `-1` 后缀**，
 * 中文、行内代码、图片 alt 都参与计算。
 *
 * 想从源码推出这个集合，就得把那一整套逻辑再实现一遍——那是**第三套解析器**，
 * 而"两套解析体系会漂"正是这个项目正在修的问题。所以这里直接查渲染结果：
 * 拿产物的 `id` 集合去对产物的 `href`，两边都是同一份真相。
 *
 * 同理，**不只用正则抓 h2/h3**：`id` 也可能来自显式写法、来自 MDX 产物、
 * 或者来自将来新加的组件。把整份 HTML 里**所有** `id` 都收进来才对得上。
 * 代码块里的 `id="..."` 会被转义成 `&quot;`，所以不会误收。
 *
 * 用法：
 *   node scripts/check-anchors.mjs [dist 目录] [--base=/letterpress]
 *
 * 退出码：0 = 全部可解析；1 = 有指向不存在片段的链接。
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const args = process.argv.slice(2);
const baseArg = args.find((a) => a.startsWith('--base='))?.slice('--base='.length) ?? '/';
const distArg = args.find((a) => !a.startsWith('--')) ?? 'dist';
const dist = distArg.replace(/\/+$/, '');
// 归一化成 `/` 或 `/仓库名`，与页面里的前缀一致
const base = ('/' + baseArg.replace(/^\/+|\/+$/g, '')).replace(/^\/$/, '');

if (!existsSync(dist)) {
  console.error(`\n找不到产物目录 ${dist}——先跑 npm run build。`);
  process.exit(1);
}

/** 收集产物里所有 HTML 文件，返回「站点路径 → 文件路径」。 */
function collectPages(dir, out = new Map()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // _astro 是静态资源，里面没有可链接的页面
      if (entry.name === '_astro' || entry.name === 'og') continue;
      collectPages(full, out);
    } else if (entry.name.endsWith('.html')) {
      const rel = relative(dist, full).split(sep).join('/');
      // index.html → /dir/；404.html → /404.html
      const route = rel === 'index.html' ? '/' : rel.replace(/(^|\/)index\.html$/, '$1');
      out.set(base + '/' + route.replace(/^\//, ''), full);
    }
  }
  return out;
}

/**
 * 产物里所有文件的**相对路径集合**，用来判断"这个链接指向的东西存不存在"。
 *
 * 不能只收 `.html`：`/slug.md` 孪生、`/robots.txt`、`/rss.xml` 都是合法目标。
 * 第一版只收了 HTML，于是 76 个正当链接被误报成死链。
 */
function collectAllFiles(dir, out = new Set()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectAllFiles(full, out);
    else out.add(relative(dist, full).split(sep).join('/'));
  }
  return out;
}

/**
 * 一个站内路径在产物里存不存在。
 *
 * 两种命中方式：**直接是文件**（`/a.md`、`/robots.txt`），
 * 或**是目录**（`/tags/中文/` → `tags/中文/index.html`）。
 *
 * 路径先按百分号解码——HTML 里的中文标签链接是编码过的
 * （`/tags/%E6%8E%92%E7%89%88/`），而磁盘上是原文。
 */
function existsInDist(pathname) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    /* 非法编码：按原样试 */
  }
  const rel = decoded.replace(/^\/+|\/+$/g, '');
  if (rel === '') return allFiles.has('index.html');
  if (allFiles.has(rel)) return true;
  return allFiles.has(`${rel}/index.html`);
}

const pages = collectPages(dist);
const allFiles = collectAllFiles(dist);
if (pages.size === 0) {
  console.error(`\n${dist} 里一个 HTML 都没有——这一步什么都没检查，不能报通过。`);
  process.exit(1);
}

/** 全部 id。不用 DOM：这里要的是"HTML 里出现过哪些 id"，正则足够且不引依赖。 */
function idsOf(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

const ids = new Map();
for (const [route, file] of pages) ids.set(route, idsOf(readFileSync(file, 'utf8')));

const problems = [];
let checkedAnchors = 0;
let checkedLinks = 0;
let checkedPages = 0;

for (const [route, file] of pages) {
  const html = readFileSync(file, 'utf8');
  checkedPages++;

  for (const m of html.matchAll(/\shref="([^"]+)"/g)) {
    const href = m[1];
    // 只看站内：跳过外链、邮件、协议相对
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) continue;
    // 跳过下载类与静态资源
    if (/\.(?:png|jpe?g|svg|ico|xml|txt|json|ndjson|css|js|webmanifest)$/i.test(href)) continue;

    const hash = href.indexOf('#');
    const frag = hash === -1 ? '' : href.slice(hash + 1);
    const pathPart = hash === -1 ? href : href.slice(0, hash);

    /*
     * ── 这一条此前**完全没有** ────────────────────────────────────────
     *
     * 全站没有任何检查断言过「HTML 里的站内链接都指向存在的页面」。
     * 这不是理论风险：这个项目**故意**有两套解析（`graph.ts` 走 Astro
     * 内容层、`remark-wikilink.ts` 走 fs 扫描），两边一旦对 URL 有分歧，
     * HTML 里就会出现死链，而**链接图会说自己一切正常**。
     *
     * 所以这条检查同时是那个分歧的**探测器**：两套解析算出的 URL
     * 只要对不上，这里就红。
     */
    if (pathPart !== '' && pathPart !== '/') {
      const normalized = pathPart.replace(/^\.\//, '');
      // 先去掉部署前缀，再问产物里有没有
      const withoutBase = base !== '' && normalized.startsWith(base + '/')
        ? normalized.slice(base.length)
        : normalized;
      if (!existsInDist(withoutBase)) {
        problems.push(`${route} → ${href}：产物里没有 ${normalized} 对应的文件`);
        continue;
      }
      checkedLinks++;
    }

    if (frag === '') continue; // 不带片段的链接到此为止
    const targetRouteForAnchor = hash === 0 ? route : base + '/' + pathPart.replace(/^\/+/, '');

    // 片段是百分号编码的（中文标题会走 encodeURIComponent）
    let decoded = frag;
    try {
      decoded = decodeURIComponent(frag);
    } catch {
      /* 非法编码：按原样比对，下面的检查自然会报出来 */
    }

    const targetIds = ids.get(targetRouteForAnchor);
    if (targetIds === undefined) {
      problems.push(`${route} → ${href}：目标页面 ${targetRouteForAnchor} 不在产物里`);
      continue;
    }

    checkedAnchors++;
    if (!targetIds.has(decoded)) {
      problems.push(
        `${route} → ${href}：${targetRouteForAnchor} 里没有 id="${decoded}" 的元素` +
          `（该页共 ${targetIds.size} 个 id）`,
      );
    }
  }
}

console.log('\n站内链接与锚点契约');
console.log('─'.repeat(64));
console.log(
  `  · 检查了 ${checkedPages} 个页面、${checkedLinks} 个站内链接、` +
    `${checkedAnchors} 个带片段的锚点`,
);

if (checkedLinks === 0 || checkedAnchors === 0) {
  // 与其它检查同一条原则：**量到 0 个不等于通过**
  console.error(
    `  ✗ 站内链接 ${checkedLinks} 个、锚点 ${checkedAnchors} 个——` +
      `任一类为 0 就说明这一步什么都没验证，不能报通过`,
  );
  process.exit(1);
}

if (problems.length > 0) {
  console.error(`\n  ✗ ${problems.length} 个站内链接无法解析：`);
  for (const p of problems.slice(0, 20)) console.error(`      ${p}`);
  if (problems.length > 20) console.error(`      …还有 ${problems.length - 20} 个`);
  console.error(
    '\n  死链会让读者撞 404；锚点错位会让他落在页面顶部而不知道走错了。' +
      '\n  修链接，或补上那个 id。',
  );
  process.exit(1);
}

console.log('  ✓ 所有站内链接指向存在的页面，所有锚点都存在');
