#!/usr/bin/env node
/**
 * 端到端验证：对着**真实构建产物**跑内容协商。
 *
 * ── 为什么需要这个脚本，单测不够吗 ──────────────────────────────────
 *
 * 单测用的是内存里造的假站点。它验证了逻辑，但验证不了三件事：
 *
 * 1. **产物里真的有 .md 文件**——路由配错了单测照样全绿
 * 2. **真实页面的 token 差距有多大**——这决定了整件事值不值得做
 * 3. **拿真实的 agent 请求头打真实产物**会得到什么
 *
 * 这个项目所有的主张都建立在这三件事上，所以必须有能跑出数字的验证。
 *
 * 用法：
 *   npm run build && npm run verify
 */

import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { negotiate } from '../src/lib/negotiate/edge.ts';
import { estimateTokens } from '../src/lib/negotiate/accept.ts';

const DIST = join(process.cwd(), 'dist');
const PORT = 8791;

/** 七个 agent 的真实 Accept 头（2026-02 实测）。 */
const AGENTS = [
  ['Claude Code', 'text/markdown, text/html, */*', true],
  ['Cursor', 'text/markdown,text/html;q=0.9,application/xhtml+xml;q=0.8,*/*;q=0.5', true],
  ['OpenCode', 'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1', true],
  ['OpenAI Codex', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', false],
  ['GitHub Copilot', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', false],
  ['Gemini CLI', '*/*', false],
  ['Windsurf', '*/*', false],
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/** 把 pathname 映射到 dist 下的实际文件。 */
async function resolveFile(pathname) {
  const candidates = [
    pathname,
    join(pathname, 'index.html'),
    `${pathname}.html`,
  ];

  for (const candidate of candidates) {
    const full = join(DIST, candidate);
    // 防目录穿越
    if (!full.startsWith(DIST)) continue;
    try {
      const info = await stat(full);
      if (info.isFile()) return full;
    } catch {
      // 继续试下一个候选
    }
  }
  return null;
}

async function serveFile(full) {
  const body = await readFile(full);
  const type = MIME[extname(full)] ?? 'application/octet-stream';
  return new Response(body, { status: 200, headers: { 'Content-Type': type } });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const request = new Request(url, { method: req.method, headers: req.headers });

  const negotiated = await negotiate(request, {
    pathname: url.pathname,
    fetchAsset: async (pathname) => {
      const full = await resolveFile(pathname);
      return full ? serveFile(full) : null;
    },
  });

  const response = negotiated ?? (await (async () => {
    const full = await resolveFile(url.pathname);
    if (!full) {
      const notFound = await resolveFile('/404.html');
      return notFound
        ? new Response(await readFile(notFound), {
            status: 404,
            headers: { 'Content-Type': MIME['.html'] },
          })
        : new Response('Not found', { status: 404 });
    }
    return serveFile(full);
  })());

  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});

await new Promise((resolve) => server.listen(PORT, resolve));

const base = `http://localhost:${PORT}`;
let failures = 0;

function check(ok, label, detail = '') {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n内容协商端到端验证（对着 dist/ 真实产物）');
console.log('─'.repeat(64));

// ── 1. 产物里确实有 .md 文件 ────────────────────────────────────────
console.log('\n[1] 孪生文件存在性');
const mdPages = ['/markdown-for-agents.md', '/how-this-works.md', '/wiki/content-negotiation.md'];
for (const page of mdPages) {
  const full = await resolveFile(page);
  check(full !== null, `${page} 存在于产物中`);
}

// ── 1b. `[[wiki-link]]` 真的被渲染成了链接 ─────────────────────────
/**
 * 这一节是**补上来的**，因为踩过一次。
 *
 * 当时 145 项单元测试全绿、构建成功、lint 通过——而所有 `[[wiki-link]]`
 * 都原样留在正文里显示方括号。原因有两层，两层都是静默的：
 *
 * 1. Astro 7 把 `markdown.remarkPlugins` 换成了 `markdown.processor`，
 *    老写法被接受但不执行，只发一条弃用警告
 * 2. 内容层会缓存渲染结果，改了处理器配置不删 `.astro/` 就不生效
 *
 * 单元测试测的是纯函数，测不到「插件到底有没有接进管线」。
 * 所以这条断言必须打在**构建产物**上。
 */
console.log('\n[1b] wiki 链接渲染契约');
{
  const checks = [
    ['/markdown-for-agents/', ['/wiki/content-negotiation/']],
    ['/how-this-works/', ['/wiki/cjk-typography/', '/wiki/content-negotiation/', '/wiki/design-tokens/']],
  ];

  for (const [page, expectedLinks] of checks) {
    const res = await fetch(`${base}${page}`, { headers: { Accept: 'text/html' } });
    const html = await res.text();

    /*
     * 去掉三类内容再看：
     *   - 代码块与行内代码：里面的方括号本就该保持原样
     *   - 目录：它的文字来自**标题**，而标题里可能正当地包含
     *     `[[方括号]]` 这个字面量（讲语法的文章就是这样）。
     *     实测 `how-this-works` 的标题「用 `[[方括号]]` 连起来」
     *     会让这条检查误报。
     */
    const prose = html
      .replace(/<code[^>]*>[\s\S]*?<\/code>/g, '')
      .replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, '')
      .replace(/<nav class="toc"[\s\S]*?<\/nav>/g, '');

    const leftover = prose.match(/\[\[[^\]]{0,30}\]\]/g) ?? [];
    check(leftover.length === 0, `${page} 正文无未解析的方括号`, `残留：${leftover.slice(0, 3).join(' ')}`);

    for (const link of expectedLinks) {
      check(html.includes(`href="${link}"`), `${page} 解析出 ${link}`);
    }
  }
}

// ── 1c. 字体真的进了产物 ───────────────────────────────────────────
/**
 * 又一条补上来的契约，理由和 1b 相同。
 *
 * `src/styles/fonts.css` 写好了 `@font-face`，但没人 import 它——
 * 整个文件不进构建，三个字体一个都不会下载。而字体栈写成
 * `'Archivo', -apple-system, ...` 时，找不到就静默用下一个，
 * **页面上没有任何异常**，只是排版的「声音」悄悄变成了系统默认字体。
 *
 * 这类问题的共同点是：**失败的形态是「看起来还行」，不是「报错」**。
 * 所以必须打在产物上。
 */
console.log('\n[1c] 字体加载契约');
{
  const astroDir = join(DIST, '_astro');

  let files = [];
  try {
    files = await readdir(astroDir);
  } catch {
    /* 目录不存在则下面逐条报错 */
  }

  const woff2 = files.filter((f) => f.endsWith('.woff2'));
  check(woff2.length >= 3, `产物含 3 个字体文件（实际 ${woff2.length} 个）`);

  const totalKb = (
    await Promise.all(
      woff2.map(async (f) => (await stat(join(astroDir, f))).size),
    )
  ).reduce((a, b) => a + b, 0) / 1024;
  // 超过 200KB 就说明误把整个字体族打进去了（应该只有拉丁子集）
  check(totalKb < 200, `字体总量 ${totalKb.toFixed(0)} KB（应 < 200 KB，只含拉丁子集）`);

  const cssFiles = files.filter((f) => f.endsWith('.css'));
  const css = (await Promise.all(cssFiles.map((f) => readFile(join(astroDir, f), 'utf8')))).join('');
  const faceCount = (css.match(/@font-face/g) ?? []).length;
  check(faceCount >= 3, `CSS 含 ${faceCount} 条 @font-face`);

  for (const family of ['Archivo', 'Public Sans', 'JetBrains Mono']) {
    check(css.includes(family), `${family} 已声明`);
  }

  /**
   * 字体栈的顺序：**拉丁字体必须排在中文系统字体之前**。
   *
   * 反了的话英文也会用中文字体渲染——而中文字体里的拉丁字母是等宽的
   * （为与汉字对齐），排版很难看。这条错了不会有任何报错，
   * 只会让所有英文看起来怪怪的。
   *
   * 注意产物里写的是 `--font-display:` 这样的自定义属性，不是 `font-family:`，
   * 所以不能按属性名去找。
   */
  for (const [name, latin] of [
    ['display', 'Archivo'],
    ['body', 'Public Sans'],
    ['mono', 'JetBrains Mono'],
  ]) {
    const decl = css.match(new RegExp(`--font-${name}:\\s*([^;}]+)`))?.[1] ?? '';
    const idxLatin = decl.indexOf(latin);
    const idxCjk = decl.indexOf('PingFang');

    check(
      decl !== '' && idxLatin !== -1 && idxCjk !== -1 && idxLatin < idxCjk,
      `--font-${name} 中 ${latin} 排在 PingFang SC 之前`,
      decl === '' ? '未找到该令牌' : `${latin}@${idxLatin} PingFang@${idxCjk}`,
    );
  }
}

// ── 1d. 源码卫生 ───────────────────────────────────────────────────
/**
 * 源码里不该出现字面 NUL 字节。
 *
 * 这条是踩坑补上的：`lint.ts` 里一个复合键的分隔符不知怎么变成了**裸的
 * NUL 字节**（U+0000）而不是转义序列 `\u0000`。它在运行时行为完全正确，
 * 编辑器里也看不出来——但 diff 会把它当二进制、某些工具会截断文件、
 * 而且用文本编辑器搜索永远搜不到。
 *
 * 项目里唯一该出现 NUL 的地方是**运行时构造的字符串**，不是源文件本身。
 */
console.log('\n[1d] 源码卫生');
{
  const roots = ['src', 'scripts', 'functions', 'netlify'];
  let bad = 0;
  let scanned = 0;

  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // 该目录不存在（比如没用到某个平台），跳过是合理的
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(ts|astro|css|mjs|js|json|md)$/.test(entry.name)) {
        scanned++;
        const buf = await readFile(full);
        if (buf.includes(0)) {
          bad++;
          console.log(`  ✗ ${full} 含裸 NUL 字节`);
        }
      }
    }
  };

  for (const root of roots) await walk(join(process.cwd(), root));

  /*
   * **扫到 0 个文件必须判失败。**
   *
   * 这条检查曾经「通过」过——因为 `readdir` 在另一个代码块里导入，
   * 作用域不在这里，调用抛 ReferenceError 被 catch 吞掉，
   * 于是它扫了 0 个文件然后报告「无裸 NUL 字节」。
   *
   * **一个没有真正检查任何东西、却报告通过的检查，比没有检查更糟**——
   * 它会让人相信某件事已经被验证过了。所以这里把「扫描量」也纳入断言。
   */
  check(scanned > 20, `扫描 ${scanned} 个源文件`, '扫描量太少，检查可能没真正执行');
  check(bad === 0, `无裸 NUL 字节`, `${bad} 个文件有问题`);
}

// ── 2. 七个 agent 的真实请求头 ──────────────────────────────────────
console.log('\n[2] 七个 agent 的真实 Accept 头');
for (const [name, accept, expectMarkdown] of AGENTS) {
  const res = await fetch(`${base}/markdown-for-agents/`, { headers: { Accept: accept } });
  const type = res.headers.get('content-type') ?? '';
  const gotMarkdown = type.includes('markdown');

  check(
    gotMarkdown === expectMarkdown,
    `${name.padEnd(16)} → ${gotMarkdown ? 'markdown' : 'HTML'}`,
    `期望 ${expectMarkdown ? 'markdown' : 'HTML'}，实际 ${type}`,
  );
}

// ── 3. 响应头契约 ───────────────────────────────────────────────────
console.log('\n[3] 响应头契约');
{
  const res = await fetch(`${base}/markdown-for-agents/`, {
    headers: { Accept: 'text/markdown' },
  });
  check(res.headers.get('vary') === 'Accept', 'Vary: Accept（否则 CDN 会把 markdown 发给浏览器）');
  check(
    (res.headers.get('content-type') ?? '').includes('charset=utf-8'),
    'Content-Type 带 charset（否则中文会乱码）',
  );
  check(Number.isInteger(Number(res.headers.get('x-markdown-tokens'))), 'x-markdown-tokens 已提供');
}

// ── 4. 失败必须静默回落 ─────────────────────────────────────────────
console.log('\n[4] 降级行为');
{
  const res = await fetch(`${base}/no-such-page/`, { headers: { Accept: 'text/markdown' } });
  check(res.status === 404, `不存在的页面返回 404 而不是 500（实际 ${res.status}）`);
}
{
  // 没有 .md 孪生文件的路径（比如 404 页），要回落而不是崩
  const res = await fetch(`${base}/this-page-has-no-twin/`, {
    headers: { Accept: 'text/markdown' },
  });
  check(res.status < 500, `没有孪生文件时回落（实际 ${res.status}）`);
}
{
  const res = await fetch(`${base}/_astro/`, { headers: { Accept: 'text/markdown' } });
  check(!(res.headers.get('content-type') ?? '').includes('markdown'), '静态资源不被协商改写');
}

// ── 6. SEO / 分享 / 无障碍契约 ──────────────────────────────────────
/**
 * 这一节来自一次外部对抗性审查。审查发现的问题当时都修了，
 * 但**修完之后我用一行 shell 命令去核对，得到的结论是错的**——
 * `grep -c` 数的是行数而压缩 CSS 只有一行，于是「有 10 处」被我读成了 0。
 *
 * 教训是：**一次性的核对命令既不可靠也不留痕**。审查发现的每一项
 * 都应该变成这里的一条断言，之后每次构建都被重新验证。
 */
console.log('\n[4b] SEO / 分享 / 无障碍契约');
{
  const read = async (rel) => {
    try {
      return await readFile(join(DIST, rel), 'utf8');
    } catch {
      return null;
    }
  };

  // ── 6a. 分享图与社交卡片 ──────────────────────────────────────
  const ogFiles = (await readdir(join(DIST, 'og')).catch(() => [])).filter((f) => f.endsWith('.png'));
  check(ogFiles.length >= 3, `分享图已生成（${ogFiles.length} 张）`);

  const siteOg = await stat(join(DIST, 'og.png')).catch(() => null);
  check(siteOg !== null && siteOg.size > 1000, '站点默认分享图存在且非空');

  /**
   * PNG 的头 8 字节必须是标准签名——光看文件存在不够，
   * 编码器写错时产出的仍是「一个文件」，只是任何平台都打不开。
   */
  const ogBytes = await readFile(join(DIST, 'og.png'));
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  check(ogBytes.subarray(0, 8).equals(PNG_SIG), '分享图是合法的 PNG（签名正确）');

  // ── 6b. JSON-LD ───────────────────────────────────────────────
  const article = await read('markdown-for-agents/index.html');
  check(article !== null && article.includes('application/ld+json'), '文章页含 JSON-LD');
  check(article !== null && article.includes('"BlogPosting"'), 'JSON-LD 含 BlogPosting');
  check(article !== null && article.includes('"dateModified"'), 'JSON-LD 含 dateModified');

  /**
   * **绝不能让 localhost 进产物。**
   *
   * 构建期 `Astro.url.origin` 是 localhost，拿它当站点地址的回退值，
   * 会把结构化数据里的 url 全部写成 `http://localhost:4321` ——
   * 线上页面自称是 localhost，搜索引擎直接判为无效。
   *
   * RSS 例外：它需要一个绝对地址才能生成，而零配置必须能构建成功，
   * 那里的 localhost 是**刻意的兜底**且有构建警告。
   */
  const htmlFiles = [];
  const collectHtml = async (dir) => {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await collectHtml(full);
      else if (e.name.endsWith('.html')) htmlFiles.push(full);
    }
  };
  await collectHtml(DIST);

  let leaked = 0;
  for (const f of htmlFiles) {
    if ((await readFile(f, 'utf8')).includes('localhost:4321')) leaked++;
  }
  check(leaked === 0, `HTML 产物中无 localhost 泄漏`, `${leaked} 个文件含 localhost`);

  // ── 6c. article 元标签 ────────────────────────────────────────
  check(article !== null && article.includes('article:published_time'), '含 article:published_time');

  /**
   * `article:modified_time` 只有在 frontmatter 里写了 `updated` 时才输出——
   * 「有就输出、没有就不编」是刻意的，凭空写一个修改时间会误导搜索引擎。
   *
   * 所以要验证这条接线，得用一篇**真的标了 `updated`** 的文章
   * （示例内容里是 `cjk-web-typography`）。
   */
  const revised = await read('cjk-web-typography/index.html');
  check(
    revised !== null && revised.includes('article:modified_time'),
    '标了 updated 的文章输出 article:modified_time',
  );

  // ── 6d. robots 与 favicon ─────────────────────────────────────
  const robots = await read('robots.txt');
  check(robots !== null && robots.includes('User-agent'), 'robots.txt 存在且格式正确');

  const home = await read('index.html');
  check(home !== null && home.includes('rel="icon"'), 'favicon 被显式引用');

  // ── 6e. 暗色代码块（曾经的白底 bug）───────────────────────────
  const astroDir = join(DIST, '_astro');
  const cssName = (await readdir(astroDir).catch(() => [])).find((f) => f.endsWith('.css'));
  const css = cssName ? await readFile(join(astroDir, cssName), 'utf8') : '';

  /**
   * Shiki 双主题只在 `<pre>` 上输出 `--shiki-dark-bg` 自定义属性，
   * **不会自己应用**。少了映射它的 CSS，暗色页面里就是白底代码块。
   *
   * 注意这里用 `includes` 而不是 `grep -c`——压缩后的 CSS 只有一行，
   * 数行数永远得到 1。我自己在这上面栽过一次。
   */
  check(css.includes('shiki-dark-bg'), 'CSS 含暗色代码块的映射规则');
  check(css.includes('prefers-color-scheme'), 'CSS 含 prefers-color-scheme 分支');
  check(
    article !== null && article.includes('--shiki-dark-bg'),
    '代码块带有暗色主题的自定义属性',
  );

  // ── 6f. 导航与结构 ────────────────────────────────────────────
  for (const [label, rel] of [
    ['搜索页', 'search/index.html'],
    ['归档页', 'archive/index.html'],
    ['分页文章页', 'posts/index.html'],
    ['标签索引', 'tags/index.html'],
  ]) {
    check((await read(rel)) !== null, `${label}存在`);
  }
}

// ── 4c. 页面结构：同一区块不得渲染两遍 ──────────────────────────────
/**
 * 这条是**踩坑之后补的**，而且它暴露了整套检查的一个盲区。
 *
 * 当时为了把「被这些页面引用」排除出搜索索引，给它套了一层
 * `<div data-pagefind-ignore>`——**却忘了删掉原来那一份**。
 * 于是每篇有反向链接的文章页，那块内容连印两遍，中间隔约 80px 空白。
 *
 * **56 条断言全部通过。** 因为它们检查的都是「某元素存在吗」
 * 「文字对不对」「href 对不对」——**没有任何一条问「它出现了几次」**。
 * 一个元素出现两次，前面所有问题都会给出「正常」的答案。
 */
console.log('\n[4c] 页面结构：区块不得重复');
{
  // 每个页面里，这些「一页只该有一处」的区块出现次数
  const singletons = [
    ['被这些页面引用', /被这些页面引用/g],
    ['这一条指向', /这一条指向/g],
    ['markdown 版本提示', /class="md-available"/g],
    ['文章头', /class="post-header"/g],
  ];

  const pages = [
    '/markdown-for-agents/',
    '/cjk-web-typography/',
    '/how-this-works/',
    '/wiki/content-negotiation/',
    '/wiki/letterpress/',
  ];

  for (const page of pages) {
    const res = await fetch(`${base}${page}`, { headers: { Accept: 'text/html' } });
    const html = await res.text();

    for (const [label, pattern] of singletons) {
      const n = (html.match(pattern) ?? []).length;
      // 0 是允许的（这一页可能本来就没有这块），但 ≥2 一定是渲染重复
      check(n <= 1, `${page} 的「${label}」不重复`, `出现 ${n} 次`);
    }
  }
}

// ── 5. 实测收益 ─────────────────────────────────────────────────────
console.log('\n[5] 实测收益（同一页面的 HTML vs markdown）');
console.log(
  `  ${'页面'.padEnd(24)} ${'HTML token'.padStart(12)} ${'MD token'.padStart(10)} ${'节省'.padStart(8)}`,
);

for (const page of ['/markdown-for-agents/', '/cjk-web-typography/', '/wiki/content-negotiation/']) {
  const html = await fetch(`${base}${page}`, { headers: { Accept: 'text/html' } });
  const htmlText = await html.text();

  const md = await fetch(`${base}${page}`, { headers: { Accept: 'text/markdown' } });
  const mdText = await md.text();

  if (!(md.headers.get('content-type') ?? '').includes('markdown')) {
    console.log(`  ${page.padEnd(24)} （没有 markdown 版本）`);
    continue;
  }

  const t1 = estimateTokens(htmlText);
  const t2 = estimateTokens(mdText);
  const saved = (100 - (t2 / t1) * 100).toFixed(1);

  console.log(
    `  ${page.padEnd(24)} ${String(t1).padStart(12)} ${String(t2).padStart(10)} ${(saved + '%').padStart(8)}`,
  );
}

/**
 * 收尾时先断开保活连接再关服务器。
 *
 * 直接 `process.exit()` 会在还有句柄未关闭时触发 libuv 的断言
 * （Windows 上表现为一行 `Assertion failed: ... UV_HANDLE_CLOSING`），
 * 打印在「全部通过」之后，看起来像崩溃。用 `exitCode` 让进程自然退出即可。
 */
server.closeAllConnections?.();
server.close();

console.log('\n' + '─'.repeat(64));
console.log(failures === 0 ? '全部通过。\n' : `${failures} 项失败。\n`);
process.exitCode = failures === 0 ? 0 : 1;
