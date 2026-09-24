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
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import {
  CONTENT_MANIFEST_VERSION,
} from '../src/lib/content-manifest.ts';
import { CONTENT_EXPORT_VERSION } from '../src/lib/content-export.ts';
import { negotiate } from '../src/lib/negotiate/edge.ts';
import { estimateTokens } from '../src/lib/negotiate/accept.ts';
import { RESERVED_POST_SLUGS } from '../src/lib/wiki/lint.ts';

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
  '.json': 'application/json; charset=utf-8',
  '.ndjson': 'application/x-ndjson; charset=utf-8',
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

/**
 * 断言总数由脚本**自己数**，不接受外部抄写。
 *
 * 缘起：README 里写「76 项契约」而实测是 71——那个 76 是拿「56 + 新增 20」
 * 算出来的，**不是跑出来的**。这类数字一旦靠手抄，就必然会漂，
 * 而且漂了没有任何东西会提醒你。项目里已经因为同一个原因改过好几次
 * README 数字（构建页数、CSS 体积、token 节省）。
 *
 * 所以计数放在这里：`npm run verify` 每次都会打印真实条数，
 * README 照抄即可，抄错了也一眼能看出来。
 */
let assertions = 0;

function check(ok, label, detail = '') {
  assertions++;
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
 * 2. 内容层会缓存渲染结果，改了处理器代码不删 `node_modules/.astro/` 就不生效
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

  /*
   * 保留 slug 清单必须跟真实路由一起长。
   * 只给当前七个值写单测，未来新增 `/projects/` 页面时测试仍会全绿，
   * 文章就能再次占用新路由。这里直接从 `src/pages` 推导根层静态页面。
   */
  const pagesRoot = join(process.cwd(), 'src', 'pages');
  const pageEntries = await readdir(pagesRoot, { withFileTypes: true });
  const staticRootSlugs = [];
  for (const entry of pageEntries) {
    // 普通页面可以是 Astro / Markdown / HTML，也可能是无额外扩展名的 API 路由。
    const rootPage = entry.name.match(/^([^.[\]]+)\.(?:astro|md|mdx|html|ts|js)$/);
    if (entry.isFile() && rootPage) {
      const slug = rootPage[1];
      if (slug !== 'index') staticRootSlugs.push(slug);
      continue;
    }
    if (!entry.isDirectory()) continue;
    try {
      const children = await readdir(join(pagesRoot, entry.name), { withFileTypes: true });
      const ownsRoot = children.some(
        (child) =>
          child.isFile() &&
          (/^index\.(?:astro|md|mdx|html|ts|js)$/.test(child.name) ||
            /^\[\.\.\.[^\]]+\]\.(?:astro|md|mdx|html|ts|js)$/.test(child.name)),
      );
      if (ownsRoot) staticRootSlugs.push(entry.name);
    } catch {
      // 无法读取的命名空间交给最终集合差异报错
    }
  }
  staticRootSlugs.sort();
  check(
    JSON.stringify(staticRootSlugs) === JSON.stringify([...RESERVED_POST_SLUGS].sort()),
    '文章保留 slug 与真实根层静态路由同步',
    `路由=${staticRootSlugs.join(',')} 清单=${[...RESERVED_POST_SLUGS].sort().join(',')}`,
  );
}

// ── 1e. 内容清单真的是可用于增量同步的契约 ─────────────────────────
/**
 * 只验证「JSON 能解析」没有意义。清单最重要的承诺是：它列全了真实孪生文件，
 * hash 对得上文件字节，图关系指向存在的 ID。任一条失真，增量同步都会漏更新。
 */
console.log('\n[1e] Agent 增量同步清单');
{
  const response = await fetch(`${base}/content-manifest.json`);
  check(response.ok, '/content-manifest.json 可访问');
  check(
    (response.headers.get('content-type') ?? '').includes('application/json'),
    '清单 Content-Type 是 application/json',
  );

  let manifest;
  try {
    manifest = await response.json();
    check(true, '清单是合法 JSON');
  } catch (error) {
    check(false, '清单是合法 JSON', error instanceof Error ? error.message : String(error));
    manifest = { documents: [] };
  }

  check(manifest.format === 'letterpress-content-manifest', '格式名明确且不伪装成外部标准');
  check(
    manifest.version === CONTENT_MANIFEST_VERSION,
    `清单版本为 ${CONTENT_MANIFEST_VERSION}`,
  );

  const documents = Array.isArray(manifest.documents) ? manifest.documents : [];
  check(manifest.documentCount === documents.length, 'documentCount 与条目数一致');

  const ids = documents.map((doc) => doc.id);
  check(new Set(ids).size === ids.length, '文档 ID 无重复');
  check(ids.join('\n') === [...ids].sort().join('\n'), '文档按 ID 稳定排序');

  const actualTwins = (await readdir(DIST, { recursive: true }))
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.replace(/\\/g, '/'))
    .sort();
  check(actualTwins.length === documents.length, '清单覆盖全部 markdown 孪生文件');

  const knownIds = new Set(ids);
  let countedEdges = 0;
  for (const doc of documents) {
    const relative = doc.kind === 'wiki' ? `wiki/${doc.slug}.md` : `${doc.slug}.md`;
    let markdown = '';
    try {
      markdown = await readFile(join(DIST, relative), 'utf8');
      check(true, `${doc.id} 的 markdown 文件存在`);
    } catch {
      check(false, `${doc.id} 的 markdown 文件存在`, relative);
    }

    const digest = createHash('sha256').update(markdown, 'utf8').digest('hex');
    check(doc.markdown?.sha256 === digest, `${doc.id} 的 sha256 对应真实文件`);
    check(
      doc.markdown?.bytes === Buffer.byteLength(markdown, 'utf8'),
      `${doc.id} 的 UTF-8 字节数准确`,
    );
    check(doc.urls?.markdown?.endsWith(`/${relative}`), `${doc.id} 指向正确的 .md URL`);

    const relations = [
      ...(doc.relations?.outgoing ?? []),
      ...(doc.relations?.backlinks ?? []),
    ];
    check(relations.every((id) => knownIds.has(id)), `${doc.id} 的图关系全部可解析`);
    countedEdges += doc.relations?.outgoing?.length ?? 0;
  }
  check(manifest.edgeCount === countedEdges, 'edgeCount 与实际出链数一致');
}

// ── 1f. NDJSON 首次全量导出 ────────────────────────────────────────
console.log('\n[1f] Agent / RAG 全量内容导出');
{
  const response = await fetch(`${base}/content.ndjson`);
  check(response.ok, '/content.ndjson 可访问');
  check(
    (response.headers.get('content-type') ?? '').includes('application/x-ndjson'),
    '全量导出 Content-Type 是 application/x-ndjson',
  );

  const body = await response.text();
  const rawLines = body.split('\n');
  const lines = rawLines.filter((line) => line !== '');
  check(body.endsWith('\n') && lines.length > 0, '导出非空且保留 NDJSON 结尾换行');

  const records = [];
  let parseError = '';
  for (const [index, line] of lines.entries()) {
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      parseError = `第 ${index + 1} 行：${error instanceof Error ? error.message : String(error)}`;
      break;
    }
  }
  check(parseError === '', '每一行都是独立、合法的 JSON 对象', parseError);
  check(
    records.every(
      (record) =>
        record.format === 'letterpress-content-record' &&
          record.version === CONTENT_EXPORT_VERSION,
    ),
    '每条记录都声明明确的格式名与版本',
  );

  const manifest = JSON.parse(await readFile(join(DIST, 'content-manifest.json'), 'utf8'));
  const documents = Array.isArray(manifest.documents) ? manifest.documents : [];
  const recordIds = records.map((record) => record.id);
  const manifestIds = documents.map((document) => document.id);
  check(
    JSON.stringify(recordIds) === JSON.stringify(manifestIds),
    '导出记录与 manifest 的 ID、数量和稳定顺序完全一致',
  );

  const byId = new Map(documents.map((document) => [document.id, document]));
  let metadataMismatch = '';
  let contentMismatch = '';
  for (const record of records) {
    const document = byId.get(record.id);
    if (!document) {
      metadataMismatch ||= `${record.id} 不在 manifest`;
      continue;
    }

    const { markdown, ...manifestMetadata } = document;
    const { format, version, site, content, ...recordMetadata } = record;
    if (
      JSON.stringify(recordMetadata) !== JSON.stringify(manifestMetadata) ||
      JSON.stringify(site) !== JSON.stringify(manifest.site) ||
      content?.mediaType !== markdown.mediaType ||
      content?.bytes !== markdown.bytes ||
      content?.sha256 !== markdown.sha256
    ) {
      metadataMismatch ||= record.id;
    }

    const relative = record.kind === 'wiki' ? `wiki/${record.slug}.md` : `${record.slug}.md`;
    const actual = await readFile(join(DIST, relative), 'utf8').catch(() => null);
    const digest =
      typeof content?.text === 'string'
        ? createHash('sha256').update(content.text, 'utf8').digest('hex')
        : '';
    if (
      actual === null ||
      content?.text !== actual ||
      Buffer.byteLength(content?.text ?? '', 'utf8') !== content?.bytes ||
      digest !== content?.sha256
    ) {
      contentMismatch ||= record.id;
    }
  }
  check(metadataMismatch === '', '每条导出的元数据与 manifest 完全一致', metadataMismatch);
  check(
    contentMismatch === '',
    '每条导出的正文与真实 .md 文件逐字节一致，bytes 与 SHA-256 正确',
    contentMismatch,
  );

  const staticHeaders = await readFile(join(DIST, '_headers'), 'utf8').catch(() => '');
  const vercelConfig = await readFile(join(process.cwd(), 'vercel.json'), 'utf8').catch(() => '');
  check(
    staticHeaders.includes('/content.ndjson') &&
      staticHeaders.includes('application/x-ndjson') &&
      vercelConfig.includes('"source": "/content.ndjson"') &&
      vercelConfig.includes('application/x-ndjson'),
    'Cloudflare Pages、Netlify 与 Vercel 都显式配置 NDJSON MIME',
  );
}

// ── 1g. 标题永久链接必须指回真实标题 id ────────────────────────────
/**
 * 单测能证明插件会改一棵假 AST，但证明不了它真的接进 Astro 管线，
 * 也证明不了标题 id 是在插件之前生成的。这里直接检查构建产物。
 */
console.log('\n[1g] 小节永久链接');
{
  const response = await fetch(`${base}/reproducible-builds/`);
  const html = await response.text();
  const headings = [...html.matchAll(/<h([23])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)];

  check(headings.length > 0, '真实文章包含带 id 的二、三级标题');
  check(
    headings.every((heading) => {
      const id = heading[2] ?? '';
      const body = heading[3] ?? '';
      return (
        body.includes('class="heading-anchor"') &&
        body.includes(`href="#${id}"`) &&
        body.includes('data-pagefind-ignore')
      );
    }),
    '每个标题的永久链接都指回自身 id，且不污染搜索索引',
  );
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
  check(
    res.headers.get('content-location') === '/markdown-for-agents.md',
    'Content-Location 指向静态孪生文件',
  );
  const links = res.headers.get('link') ?? '';
  check(
    links.includes('rel="canonical"') && links.includes('rel="alternate"'),
    'Link 可双向发现 HTML / markdown 表示',
  );
}

// ── 4. 失败必须静默回落 ─────────────────────────────────────────────
console.log('\n[4] 降级行为');
{
  const res = await fetch(`${base}/no-such-page/`, { headers: { Accept: 'text/markdown' } });
  check(res.status === 404, `不存在的页面返回 404 而不是 500（实际 ${res.status}）`);
}
{
  /*
   * **存在的** HTML 页、但没有 .md 孪生时，必须回落到 HTML —— 200 + text/html，
   * 而不是 404。`edge.ts` 把这件事说得很重：「没有孪生文件时同样回落，不能返回 404……
   * 回落是正确行为，不是兜底」。
   *
   * ⚠️ 这一条此前是**空的**。它请求的是 `/this-page-has-no-twin/` ——
   * **那个路径根本不存在**，于是拿到 404，而断言写的是 `status < 500`，404 天然满足它。
   * 也就是说它和上面那条「不存在的页面返回 404」测的是同一件事，
   * 而它声称要验的回落行为**一次都没被验过**。
   *
   * 现在用的是站内真实存在的 `/about/`（有 index.html、没有 about.md）：
   * 两条断言都打在真正该看的东西上——**状态码与 Content-Type**。
   */
  const res = await fetch(`${base}/about/`, { headers: { Accept: 'text/markdown' } });
  check(res.status === 200, `没有孪生文件的真实页面返回 200（实际 ${res.status}）`);
  check(
    (res.headers.get('content-type') ?? '').includes('text/html'),
    `没有孪生文件时回落到 HTML（实际 ${res.headers.get('content-type') ?? '无'}）`,
  );
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

  /*
   * 知识库条目也必须有 JSON-LD。
   *
   * 2026-09-24 实测：wiki 路由（`src/pages/wiki/[slug].astro`）**根本没引入
   * `JsonLd`**，于是这一类页面完全没有结构化数据——而文章页有。
   * 搜索引擎与 agent 因此拿不到知识页的结构。
   *
   * 类型用 `Article` 而不是 `TechArticle`：后者的定义**在 2026-09-24 无法核实**
   * （schema.org 页面超时、机器可读端点 404），
   * **写一个没核实过的 `@type` 比用一个确定存在的上位类更糟**——
   * 错误的名字会让搜索引擎静默忽略整块。理由写在组件里。
   */
  const wikiPage = await read('wiki/cjk-typography/index.html');
  check(wikiPage !== null && wikiPage.includes('application/ld+json'), '知识页含 JSON-LD');
  check(wikiPage !== null && wikiPage.includes('"Article"'), '知识页 JSON-LD 含 Article');
  check(wikiPage !== null && wikiPage.includes('"dateModified"'), '知识页 JSON-LD 含 dateModified');
  // 知识页**没有发布时间**（它是持续修订的）——给一个假的 datePublished
  // 会误导「这一篇写了多久」。所以这里反过来断言它**不该有**。
  check(
    wikiPage !== null && !wikiPage.includes('"datePublished"'),
    '知识页 JSON-LD 不含编造的 datePublished',
  );

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

  // ── 6e. 搜索快捷键与 RSS 自描述 ──────────────────────────────
  check(
    home !== null &&
      home.includes('aria-keyshortcuts="/"') &&
      home.includes('data-search-link') &&
      home.includes('location.assign'),
    '搜索入口声明 / 快捷键且实际接入导航脚本',
  );

  const rssXml = await read('rss.xml');
  check(
    rssXml !== null && rssXml.includes('xmlns:atom="http://www.w3.org/2005/Atom"'),
    'RSS 声明 Atom 命名空间',
  );
  check(
    rssXml !== null &&
      /<atom:link\b[^>]*\bhref="[^"]+\/rss\.xml"[^>]*\brel="self"[^>]*\btype="application\/rss\+xml"/.test(
        rssXml,
      ),
    'RSS 输出指向自身的 atom:link',
  );

  // ── 6f. 标签 RSS ──────────────────────────────────────────────
  // 只检查「路由文件存在」不够：页面必须真的暴露订阅入口，每个条目也必须
  // 仍是全文且属于对应标签，否则这只是一个看得见、用不起来的空功能。
  const tagFeedFiles = [];
  const collectTagFeeds = async (dir, rel = 'tags') => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = join(dir, entry.name);
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) await collectTagFeeds(full, childRel);
      else if (entry.name === 'rss.xml') tagFeedFiles.push(childRel);
    }
  };
  await collectTagFeeds(join(DIST, 'tags'));

  check(tagFeedFiles.length > 0, `按标签生成独立 RSS（${tagFeedFiles.length} 份）`);

  let undiscoverable = 0;
  let invalidItems = 0;
  for (const rel of tagFeedFiles) {
    const segments = rel.split('/');
    const tag = segments.at(-2) ?? '';
    const href = `/${segments.map(encodeURIComponent).join('/')}`;
    const page = await read(`${segments.slice(0, -1).join('/')}/index.html`);
    const hrefCount = page?.split(`href="${href}"`).length ?? 0;
    if (hrefCount < 3) undiscoverable++;

    const xml = await read(rel);
    const items = xml?.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    const xmlTag = tag
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
    if (
      items.length === 0 ||
      items.some(
        (item) =>
          !item.includes(`<category>${xmlTag}</category>`) || !item.includes('<content:encoded>'),
      )
    ) {
      invalidItems++;
    }
  }

  check(
    undiscoverable === 0,
    '每个标签页都在 head 与正文暴露对应订阅源',
    `${undiscoverable} 个标签页入口不完整`,
  );
  check(
    invalidItems === 0,
    '标签 RSS 只含对应标签文章且保留全文',
    `${invalidItems} 份订阅内容不完整`,
  );

  // ── 6g. 暗色代码块与打印样式 ──────────────────────────────────
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
  check(css.includes('@media print'), 'CSS 含独立打印模式');
  check(
    css.includes('break-inside:avoid') && css.includes('white-space:pre-wrap'),
    '打印时代码可换行，关键内容块尽量不跨页',
  );

  // ── 6h. 导航与结构 ────────────────────────────────────────────
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
/**
 * ── 从产物里认出「内容页」─────────────────────────────────────────────
 *
 * 文章在一层目录（`/<slug>/`），知识库条目在两层（`/wiki/<slug>/`）。
 * 两者的共同标志是 `post-header`，也正是它们区别于首页 / 归档 / 标签页的地方。
 *
 * **为什么不写死页面路径**：写死的话，使用者换成自己的内容之后，下面的断言
 * 会对着一个 404 页面跑——「匹配数 0」恰好满足「不重复」，于是**静静全部通过**。
 * 这正是本项目反复踩的那个坑：「扫了 0 个文件却报告通过」。
 * 认产物就不会有这个问题，对使用者自己的内容同样成立。
 */
async function discoverContentPages() {
  const found = [];

  async function walk(dir, prefix, depth) {
    if (depth > 2) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const url = `${prefix}${entry.name}/`;
      let html = null;
      try {
        html = await readFile(join(dir, entry.name, 'index.html'), 'utf8');
      } catch {
        // 没有 index.html 的目录（_astro、pagefind 之类）不是页面
      }
      if (html && html.includes('class="post-header"')) found.push({ url, html, depth });
      await walk(join(dir, entry.name), url, depth + 1);
    }
  }

  await walk(DIST, '/', 1);
  return found;
}

const contentPages = await discoverContentPages();

console.log('\n[4c] 页面结构：区块不得重复');
{
  // 每个页面里，这些「一页只该有一处」的区块出现次数
  const singletons = [
    ['被这些页面引用', /被这些页面引用/g],
    ['这一条指向', /这一条指向/g],
    ['markdown 版本提示', /class="md-available"/g],
    ['文章头', /class="post-header"/g],
  ];

  // 认出 0 个页面本身就是故障（构建产物不对），必须报出来而不是空过
  check(contentPages.length > 0, `从产物里认出了内容页（${contentPages.length} 个）`);

  for (const { url, html } of contentPages) {
    for (const [label, pattern] of singletons) {
      const n = (html.match(pattern) ?? []).length;
      // 0 是允许的（这一页可能本来就没有这块），但 ≥2 一定是渲染重复
      check(n <= 1, `${url} 的「${label}」不重复`, `出现 ${n} 次`);
    }
  }

  let brokenMarkdownActions = 0;
  for (const { url, html } of contentPages) {
    const twin = `${url.replace(/\/$/, '')}.md`;
    const hasPublishedTarget = html.includes(`data-markdown-url="${twin}"`);
    const hasLink = html.includes(`href="${twin}"`);
    const buttons = html.match(/<button\b[^>]*\bdata-copy-markdown\b[^>]*>/g) ?? [];
    if (!hasPublishedTarget || !hasLink || buttons.length !== 1) brokenMarkdownActions++;
  }
  check(
    brokenMarkdownActions === 0,
    '每个内容页都能打开并复制对应的真实 markdown 孪生文件',
    `${brokenMarkdownActions} 个内容页的 Markdown 操作未接通`,
  );

  const actionScript = contentPages.some(
    ({ html }) => html.includes('navigator.clipboard') && html.includes('text/markdown'),
  );
  check(actionScript, 'Markdown 复制按钮接入 Clipboard API，并请求 text/markdown');
}

/**
 * ── 4d. 「该出现的，出现了吗」────────────────────────────────────────
 *
 * 这一节是补出来的，因为在此之前**所有断言只问两类问题**：
 * 「这个元素存在吗」「它出现了几次」。没有一条问「本该有的东西还在不在」。
 *
 * 后果是真实发生过的：`src/pages/[slug].astro` 里 `PostNav` 被 import 了，
 * 但渲染调用在某一轮改动中被删掉，而 `prev` / `next` 照算不误。
 * 于是**线上所有文章页都没有「上一篇 / 下一篇」**，README 却宣称了两次——
 * 而构建成功、215 项单测全绿、契约全过、lint 通过。
 *
 * **删掉一个组件不会让任何断言变红**，除非有一条专门守它。
 *
 * 这里守的是「文章页一定有文章导航」这个不变式。不写死页面路径，而是从
 * 产物里认文章页（只有文章页有 `post-header`，且都在一层目录下），
 * 因此对使用者自己的内容同样成立。
 */
console.log('\n[4d] 该出现的出现了吗：文章页必须有上下篇导航');
{
  // 知识库条目也在一层目录下会有 post-header，但它们没有上下篇——
  // 所以只取一层（`/<slug>/`），那才是文章页
  const articles = contentPages.filter((p) => p.depth === 1);

  check(articles.length > 0, `从产物里认出了文章页（${articles.length} 篇）`);

  if (articles.length >= 2) {
    // 只有一篇时没有邻居，导航本就不该出现（组件内部会判空）
    for (const { url, html } of articles) {
      const hasNav = html.includes('class="post-nav"');
      const hasNeighbour = /rel="(?:prev|next)"/.test(html);
      check(
        hasNav && hasNeighbour,
        `${url} 渲染了上一篇 / 下一篇`,
        hasNav ? '有导航但没有邻居链接' : '整块导航缺失',
      );
    }
  } else {
    console.log('  （文章少于 2 篇，无可导航的邻居）');
  }
}

// ── 5. 实测收益 ─────────────────────────────────────────────────────
console.log('\n[5] 实测收益（同一页面的 HTML vs markdown）');
console.log(
  `  ${'页面'.padEnd(24)} ${'HTML token'.padStart(12)} ${'MD token'.padStart(10)} ${'节省'.padStart(8)}`,
);

/** 逐页实测结果，供下面与文档里的数字比对（文档那张表就是这段输出的快照）。 */
const measured = [];

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
  measured.push({ page, t1, t2, saved });

  console.log(
    `  ${page.padEnd(24)} ${String(t1).padStart(12)} ${String(t2).padStart(10)} ${(saved + '%').padStart(8)}`,
  );
}

/**
 * ── 文档一致性：手抄的快照必须等于这里数出来的数 ──────────────────────
 *
 * 脚本上方那段注释写得很清楚——「这类数字一旦靠手抄，就必然会漂，**而且漂了没有
 * 任何东西会提醒你**」。**这句话对下面这几个数字自己也成立**：2026-09-19 实测，
 * README 写 177 项契约而实际 180；`docs/content-negotiation.md` 写着 4728 / 5416 / 3055
 * 而实际 5164 / 5880 / 3458（页面内容变长，节省率从 64.5/66.5/63.5 涨到 67.5/69.1/67.8）。
 * 两处都漂了，都没有出声。
 *
 * 所以把闭环补上：既然数字都在这里，那就顺手比一下。
 */
const readme = await readFile(join(process.cwd(), 'README.md'), 'utf8');

/** 文档里的实测表就是 [5] 段那段输出的快照。 */
const negotiationDoc = await readFile(join(process.cwd(), 'docs', 'content-negotiation.md'), 'utf8');
const docRows = [...negotiationDoc.matchAll(/^\s*(\/\S+\/)\s+(\d+)\s+(\d+)\s+([\d.]+)%\s*$/gm)].map((m) => ({
  page: m[1],
  t1: Number(m[2]),
  t2: Number(m[3]),
  saved: m[4],
}));
check(
  docRows.length === measured.length &&
    docRows.every(
      (row, i) =>
        row.page === measured[i].page &&
        row.t1 === measured[i].t1 &&
        row.t2 === measured[i].t2 &&
        row.saved === measured[i].saved,
    ),
  'docs/content-negotiation.md 的实测表与本次输出一致',
  docRows.length !== measured.length
    ? `文档里 ${docRows.length} 行、实测 ${measured.length} 行`
    : `文档写 ${docRows.map((r) => `${r.t1}/${r.saved}%`).join(' ')}，实测 ${measured.map((r) => `${r.t1}/${r.saved}%`).join(' ')}`,
);

/** README 摘要那行的 `**X% / Y%**` 对应实测的前两页。 */
/*
 * ⚠️ **2026-09-24 修正**：原判据要求 README 里**每一组** `X% / Y%`
 * 都等于本次实测的**估算**节省率。
 *
 * 而 README 现在合法地有两组数：估算（每次构建都重打，门禁该管）
 * 与**真实词表** `o200k_base` 复算（60.8 / 58.0，那不是估算）。
 * 于是加了第二组之后这条判据红了——**而它红得不对**。
 *
 * > **一个判据把两类东西当成一类，就会逼人把真数据删掉。**
 *
 * 现在只取**紧跟在 `**` 之后、且后面不接「真实词表」字样的那组**——
 * 也就是摘要里的估算值。真实词表那组由 `docs/content-negotiation.md`
 * 里的表负责（那张表量的是当次构建的产物，**刻意不进门禁**）。
 */
const estimatedOnly = readme.replace(/用真实词表[^）]*?（估算在 HTML 侧稳定偏低[^）]*?）[。.]?/g, '');
const claimedSavings = (estimatedOnly.match(/\*\*[\d.]+%\s*\/\s*[\d.]+%\*\*/g) ?? []).map((s) =>
  [...s.matchAll(/([\d.]+)%/g)].map((m) => m[1]),
);
const expectedSavings = measured.slice(0, 2).map((r) => r.saved);
check(
  claimedSavings.length > 0 && claimedSavings.every(([a, b]) => a === expectedSavings[0] && b === expectedSavings[1]),
  'README 摘要那行的 token 节省率（估算）与实测一致',
  `README 写 ${claimedSavings.map((p) => p.join('/')).join(' ') || '（没有）'}，实测前两页 ${expectedSavings.join(' / ')}%
` +
    '    **真实词表那组（60.8 / 58.0）刻意不归这条判据管**——它不是估算。',
);

/**
 * README 与 `docs/` 里抄的契约条数，必须等于脚本最终打印的那个数。
 *
 * ── 先说清 `finalTotal` 是怎么来的 ────────────────────────────────
 *
 * `check()` 会**先自增再判定**，也就是说每一条对账检查**自己也算一项契约**。
 * 早先这里写的是 `assertions + 1`，只有一条这样的检查时才成立；再加一条就会错位。
 * 所以改成一次性把后面的检查条数算进去，两条都去比同一个数——比"每条自己 +1"
 * 好读，也不容易在下一次增删时算错。
 *
 * ── 为什么要连 `docs/` 一起查 ──────────────────────────────────────
 *
 * 此前只匹配 README 的两种写法，而 `docs/cli.md` 里也抄了一次。
 * 这个文件的注释里记着更早的两回：契约数 177 → 180、`docs/content-negotiation.md`
 * 里的 4728 / 5416 / 3055 漂过都没出声。前者早就补上了，后者这次一并补。
 */
/*
 * ⚠️ **2026-09-24：我又踩了注释里警告过的那个坑。**
 *
 * 上面那段注释写着「再加一条就会错位」——而我**正好又加了一条**
 * （`docsMentions.length > 0`），`reconciliationChecks` 仍是 2，
 * 于是 `finalTotal` 报 200 而实际是 201，**门禁自己报错了自己的数字**。
 *
 * 两次都是同一类：**一个「后面还有 N 条」的计数靠手写**。
 * 而它一旦与实际不符，报出来的红是**假的**——
 * 我第一反应真的是「我漏改了某处文档」，去改了两处本来正确的地方。
 *
 * 所以改成**不手写**：先跑完那几条，再数。
 * 代价是 `finalTotal` 要在那之后才算得出——而它只被那几条用，所以顺序正好。
 */
/*
 * ⚠️⚠️ **这里试错了两次，而两次的症状都是「门禁报错了自己的数字」。**
 *
 * ① 手写 `reconciliationChecks = 2`：我加了一条对账检查，它仍是 2 → 少算。
 *    ——而这段注释**早就警告过「再加一条就会错位」**，我正好又加了一条。
 * ② 改成「每次调用自增」：第二次比较时 `assertions` **已经包含了第一次对账
 *    自己产生的 check** → 多算（202 而实际 201）。
 *
 * > **「边跑边数」必然自我污染**：被数的那个计数器，
 * > 会在数的过程中因为「数它的那次操作」而增加。
 *
 * 所以：**在跑任何对账之前把「会产生的对账条数」写死成一个常量**，
 * 且那个常量**由下方实际出现的 `check(` 调用数决定**——
 * 我加了新的一条，就必须把它同步。
 *
 * > 这与 `check-single-source` 那个教训同源：**同一个事实写两遍就会漂**。
 * > 差别是这一次「两份」是「一个常量与一串调用」，而我**至少让它错在明处**
 * > （改错时门禁立刻报假红，而不是静默放过）。
 */
const RECONCILIATION_CHECKS = 3; // 下方三处 check：README 一致、docs 非空、docs 一致
const finalTotal = assertions + RECONCILIATION_CHECKS;

const claimed = [
  ...readme.matchAll(/(\d+)\s*end-to-end contracts/g),
  ...readme.matchAll(/端到端契约\s*\|\s*\*\*(\d+)\s*项\*\*/g),
].map((m) => m[1]);
check(
  claimed.length > 0 && claimed.every((n) => Number(n) === finalTotal),
  'README 里抄的契约条数与实际一致',
  `README 写 ${claimed.join(' / ') || '（一处都没有写）'}，实际 ${finalTotal}`,
);

const docsMentions = [];
for (const name of (await readdir('docs')).sort()) {
  if (extname(name) !== '.md') continue;
  const text = await readFile(join('docs', name), 'utf8');
  for (const m of text.matchAll(/(\d+)\s*项契约/g)) {
    docsMentions.push(`${name} 写 ${m[1]}`);
  }
}
/*
 * ⚠️ **「docs 里一处都没提」是一个独立失败，而它原先被当成 `check` 的 detail。**
 *
 * `check(ok, label, detail)` 的第三参是**失败时的详情**——
 * 而这里传的是「若 `docsMentions` 为空就提醒我别让它静默失效」。
 * 于是 `docsMentions` 为空时 `every` **恒真** → `ok = true` →
 * **那句提醒永远不会显示**。
 *
 * > 注释写着「别让它静默失效」，而**它正是那个静默失效**。
 * > 「被测集合是空的」这个盲区，本轮第四次以不同形态出现
 * > （前三次：只认字面数字 / 只查一个方向 / 「若报必是」在 0 条时恒真）。
 *
 * 所以**必须单独判一次**：
 */
check(
  docsMentions.length > 0,
  'docs/ 里至少有一处提到契约条数（否则这条检查覆盖不到任何东西）',
  'docs/ 里一处都没提到「N 项契约」——请确认是措辞变了，还是这条检查本来就该覆盖别的文件',
);
check(
  docsMentions.length > 0 && docsMentions.every((d) => Number(d.split('写 ')[1]) === finalTotal),
  'docs/ 里写到的契约条数与实际一致',
  `${docsMentions.join('；')}，实际 ${finalTotal}`,
);

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
console.log(
  failures === 0
    ? `${assertions} 项契约全部通过。\n`
    : `${assertions} 项契约中 ${failures} 项失败。\n`,
);
process.exitCode = failures === 0 ? 0 : 1;
