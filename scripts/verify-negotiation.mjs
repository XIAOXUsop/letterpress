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
import { readFile, stat } from 'node:fs/promises';
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

    // 去掉代码块——里面的方括号**本就该**保持原样
    const prose = html.replace(/<code[^>]*>[\s\S]*?<\/code>/g, '').replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, '');

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
  const { readdir } = await import('node:fs/promises');
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
