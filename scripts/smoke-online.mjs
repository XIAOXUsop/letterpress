#!/usr/bin/env node
/**
 * 线上烟测：对着**真实部署**验内容协商与内容清单，只查少量稳定出口，不抓全站。
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
import { createHash } from 'node:crypto';

const MARKDOWN_PAGE = '/markdown-for-agents/';
/** 这个页面没有 markdown 孪生文件，用来验证"安全回落到 HTML" */
const HTML_ONLY_PAGE = '/';
/** 静态资源不应被重写 */
const STATIC_ASSET = '/robots.txt';
const CONTENT_MANIFEST = '/content-manifest.json';

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

// ── ⑤ 内容清单必须能驱动一次真实的增量同步 ─────────────────────
console.log(`\n⑤ ${CONTENT_MANIFEST}`);
let manifestResponse;
try {
  manifestResponse = await request(CONTENT_MANIFEST, 'application/json');
} catch (error) {
  console.error(`\n内容清单请求失败：${error.message}`);
  process.exit(1);
}

record(
  manifestResponse.response.status === 200,
  `内容清单返回 200（实际 ${manifestResponse.response.status}）`,
);
record(
  manifestResponse.contentType.includes('application/json'),
  `内容清单返回 application/json（实际 ${manifestResponse.contentType || '无'}）`,
);

let manifest;
try {
  manifest = await manifestResponse.response.json();
  record(true, '内容清单是合法 JSON');
} catch (error) {
  record(false, `内容清单是合法 JSON（${error.message}）`);
}

if (manifest) {
  record(manifest.format === 'letterpress-content-manifest', '内容清单格式名正确');
  record(manifest.version === 1, '内容清单版本为 1');
  const documents = Array.isArray(manifest.documents) ? manifest.documents : [];
  record(documents.length > 0, `内容清单包含文档（实际 ${documents.length} 篇）`);
  record(manifest.documentCount === documents.length, 'documentCount 与真实条目数一致');

  const ids = new Set(documents.map((doc) => doc.id));
  const relationsResolve = documents.every((doc) =>
    [...(doc.relations?.outgoing ?? []), ...(doc.relations?.backlinks ?? [])].every((id) => ids.has(id)),
  );
  record(relationsResolve, '所有链接关系都指向清单内的已知 ID');

  // 只抽一篇，避免烟测变成全站爬虫；目标从清单推导，不写死使用者的内容。
  const sample = documents[0];
  if (sample?.urls?.markdown && sample?.markdown?.sha256) {
    /*
     * 清单里是站点配置的 canonical URL，烟测地址却可能是同一构建的预览域名。
     * 直接请求 canonical 会测到另一个部署。先相对 `site.home` 取出文档路径，
     * 再挂到本次 SITE_ORIGIN 下，才能保证验证的就是当前目标环境。
     */
    const manifestHome = new URL(manifest.site?.home ?? '/', `${origin}/`);
    const canonicalSample = new URL(sample.urls.markdown, manifestHome);
    const homeHref = manifestHome.href.endsWith('/') ? manifestHome.href : `${manifestHome.href}/`;
    const belongsToSite = canonicalSample.href.startsWith(homeHref);
    record(belongsToSite, `抽样孪生文件位于清单声明的站点根下（${sample.id}）`);
    if (belongsToSite) {
      const relative = canonicalSample.href.slice(homeHref.length);
      const sampleUrl = new URL(relative, `${origin}/`);
      try {
        const sampleResponse = await fetch(sampleUrl, {
          headers: { Accept: 'text/markdown' },
          redirect: 'follow',
        });
        const body = Buffer.from(await sampleResponse.arrayBuffer());
        const digest = createHash('sha256').update(body).digest('hex');

        record(sampleResponse.status === 200, `抽样孪生文件返回 200（${sample.id}）`);
        record(
          (sampleResponse.headers.get('content-type') ?? '')
            .toLowerCase()
            .includes('text/markdown'),
          `抽样孪生文件返回 text/markdown（${sample.id}）`,
        );
        record(
          body.byteLength === sample.markdown.bytes,
          `抽样孪生文件字节数与清单一致（${sample.id}）`,
        );
        record(
          digest === sample.markdown.sha256,
          `抽样孪生文件 SHA-256 与清单一致（${sample.id}）`,
        );
      } catch (error) {
        record(false, `无法抓取清单指向的抽样孪生文件（${error.message}）`);
      }
    }
  } else {
    record(false, '清单没有可用于抽样的 markdown 文档');
  }
}

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
console.log('线上烟测通过：内容协商与增量同步清单在真实部署上均可用。');
