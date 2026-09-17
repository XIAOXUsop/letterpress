#!/usr/bin/env node
/**
 * 线上烟测：对着**真实部署**验内容协商，只查一两个稳定 URL，不抓全站。
 *
 * ── 为什么必须跑线上，而不是本地起个服务器 ──────────────────────────
 *
 * 内容协商的成败**全在托管平台**：边缘函数有没有被部署、响应头有没有被平台改写、
 * CDN 有没有把 `Vary: Accept` 吃掉——这些在本地 `npm run dev` 或
 * `node scripts/verify-negotiation.mjs` 里一个都测不到，它们的响应头是自己写的。
 *
 * 所以这个脚本**没有**"线上不可用就退回本地"的开关：那会让一次部署事故
 * 表现为一次绿色的烟测，而它恰恰是唯一能发现部署事故的东西。
 * 没有配置线上地址时它直接失败退出，并把这件事说清楚。
 *
 * 用法：
 *   SITE_ORIGIN=https://your-demo.example node scripts/smoke-online.mjs
 *   npm run verify:online -- --origin=https://your-demo.example
 */

const MARKDOWN_PAGE = '/markdown-for-agents/';
/** 这个页面没有 markdown 孪生文件，用来验证"安全回落到 HTML" */
const HTML_ONLY_PAGE = '/';
/** 静态资源不应被重写 */
const STATIC_ASSET = '/robots.txt';

const args = process.argv.slice(2);
const originArg = args.find((a) => a.startsWith('--origin='))?.slice('--origin='.length);
const origin = (originArg ?? process.env.SITE_ORIGIN ?? '').trim().replace(/\/+$/, '');

if (!origin) {
  console.error('\n未配置线上地址，无法进行线上烟测。');
  console.error('  用法：SITE_ORIGIN=https://your-demo.example node scripts/smoke-online.mjs');
  console.error('\n**本脚本不会回退到本地服务器。** 内容协商的成败在托管平台，');
  console.error('本地服务器的响应头是自己写的，测出来的"通过"没有任何意义。');
  console.error('部署说明见 docs/deploy.md。');
  process.exit(2);
}

const problems = [];
const notes = [];

function record(ok, message) {
  if (ok) {
    console.log(`  ✓ ${message}`);
  } else {
    console.log(`  ✗ ${message}`);
    problems.push(message);
  }
}

async function request(path, accept) {
  const url = `${origin}${path}`;
  const response = await fetch(url, { headers: { Accept: accept }, redirect: 'follow' });
  return { url, response, contentType: (response.headers.get('content-type') ?? '').toLowerCase() };
}

console.log(`\n线上烟测（${origin}）`);
console.log('─'.repeat(64));

// ── ① 同一个页面，两种 Accept ──────────────────────────────────
console.log(`\n① ${MARKDOWN_PAGE}`);
let html;
let markdown;
try {
  html = await request(MARKDOWN_PAGE, 'text/html');
  markdown = await request(MARKDOWN_PAGE, 'text/markdown');
} catch (error) {
  console.error(`\n请求失败：${error.message}`);
  console.error('部署是否还在？还是地址写错了？烟测不会替你猜——它就在这里失败。');
  process.exit(1);
}

record(html.response.status === 200, `Accept: text/html 返回 200（实际 ${html.response.status}）`);
record(html.contentType.includes('text/html'), `返回 text/html（实际 ${html.contentType || '无'}）`);
record(markdown.response.status === 200, `Accept: text/markdown 返回 200（实际 ${markdown.response.status}）`);
record(
  markdown.contentType.includes('text/markdown'),
  `返回 text/markdown（实际 ${markdown.contentType || '无'}）`,
);
record(
  html.contentType !== markdown.contentType,
  '两种 Accept 拿到了**不同**的 Content-Type（相同就说明协商没生效）',
);
record(
  (html.response.headers.get('vary') ?? '').toLowerCase().includes('accept'),
  `HTML 响应带 Vary: Accept（实际 ${html.response.headers.get('vary') ?? '无'}）`,
);
record(
  (markdown.response.headers.get('vary') ?? '').toLowerCase().includes('accept'),
  `Markdown 响应带 Vary: Accept（实际 ${markdown.response.headers.get('vary') ?? '无'}）`,
);

// ── ② Markdown 侧的可发现性 ────────────────────────────────────
console.log('\n② Markdown 响应的可发现性');
const contentLocation = markdown.response.headers.get('content-location');
const link = markdown.response.headers.get('link') ?? '';
record(!!contentLocation, `带 Content-Location（实际 ${contentLocation ?? '无'}）`);
record(/rel="?alternate"?/i.test(link), `Link 带 rel="alternate"（实际 ${link || '无'}）`);

// ── ③ 没有孪生 markdown 的页面必须安全回落到 HTML ──────────────
console.log(`\n③ ${HTML_ONLY_PAGE}（没有 markdown 孪生）`);
const fallback = await request(HTML_ONLY_PAGE, 'text/markdown');
record(fallback.response.status === 200, `返回 200（实际 ${fallback.response.status}）`);
record(
  fallback.contentType.includes('text/html'),
  `回落到 text/html 而不是 404 或空响应（实际 ${fallback.contentType || '无'}）`,
);

// ── ④ 静态资源不被重写 ─────────────────────────────────────────
console.log(`\n④ ${STATIC_ASSET}`);
const asset = await request(STATIC_ASSET, 'text/markdown');
record(asset.response.status === 200, `返回 200（实际 ${asset.response.status}）`);
record(
  !asset.contentType.includes('text/markdown'),
  `静态资源没有被改写成 markdown（实际 ${asset.contentType || '无'}）`,
);

// ── 汇总 ───────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(64));
if (notes.length) {
  console.log(notes.join('\n'));
}
if (problems.length) {
  console.error(`线上烟测失败：${problems.length} 项不通过。`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}
console.log('线上烟测通过：内容协商在真实部署上生效。');
