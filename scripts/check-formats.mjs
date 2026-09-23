#!/usr/bin/env node
/**
 * 内容发布探针：格式支持、草稿隔离与系统路由隔离都打在真实构建上。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────
 *
 * 这个检查是**踩坑之后补的**：`@astrojs/mdx` 装在 `package.json` 里、
 * `content.config.ts` 的 glob 也匹配 mdx、README 写着
 * 「Markdown / **MDX**」——**但 `astro.config.mjs` 里从没注册过 `mdx()`**。
 *
 * 后果是：放进一个 `.mdx` 文件，构建成功、退出码 0，而文章在产物里
 * **根本不存在**、首页也不列。**不报错、不失败，只是消失**——
 * 而这恰恰是这个项目反复强调的头号敌人。
 *
 * 所以断言必须是：**真的放一个 `.mdx` 进去，构建，看它有没有变成页面**。
 * 读配置不够——配置可以是对的而接线是断的，这次就是。
 *
 * 用法：`npm run verify:formats`
 */

import { runAstro } from './lib/astro.mjs';
import { cleanBuildState } from './lib/clean.mjs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const probeDir = join(root, 'src', 'content', 'posts');

/** 探针文件。slug 带前缀，避免与真实内容撞名。 */
const PROBES = [
  {
    file: 'zprobe-markdown-format.md',
    label: 'Markdown',
    body: '---\ntitle: 格式探针 Markdown\nsummary: 验证 .md 能产出页面。\ndate: 2026-01-01\ntags: [zprobe-format-feed]\n---\n\n正文。\n',
    expect: 'zprobe-markdown-format/index.html',
  },
  {
    file: 'zprobe-mdx-format.mdx',
    label: 'MDX',
    body: '---\ntitle: 格式探针 MDX\nsummary: 验证 .mdx 能产出页面。\ndate: 2026-01-01\ntags: [zprobe-format-feed]\n---\n\n# 标题\n\n正文，含一个表达式：{1 + 1}\n',
    expect: 'zprobe-mdx-format/index.html',
  },
];

/**
 * 负向探针：它必须被内容层读取，但绝不能出现在任何发布出口。
 * 只检查「某个页面不存在」不够——草稿曾经同时泄漏到页面、孪生文件、OG、
 * 列表、RSS、sitemap 与 llms 文件，而构建仍然是绿色的。
 */
const DRAFT_PROBE = {
  file: 'zprobe-draft-must-not-ship.md',
  slug: 'zprobe-draft-must-not-ship',
  marker: 'DRAFT_PROBE_MUST_NOT_SHIP',
  body: '---\ntitle: DRAFT_PROBE_MUST_NOT_SHIP\nsummary: 这条内容只用于验证草稿隔离。\ndate: 2026-01-01\ntags: [zprobe-private-tag]\ndraft: true\n---\n\nDRAFT_PROBE_MUST_NOT_SHIP\n',
};

/**
 * 负向探针：Astro 原生只警告并跳过冲突文章，退出码仍是 0。
 * lint 必须把它升级为构建失败，否则 HTML 与其他发布出口会互相矛盾。
 */
const RESERVED_ROUTE_PROBE = {
  file: 'zprobe-reserved-route.md',
  body: '---\ntitle: 保留路由探针\nsummary: 验证系统路由不会被文章占用。\ndate: 2026-01-01\nslug: about\n---\n\nRESERVED_ROUTE_PROBE\n',
};

console.log('\n内容发布探针');
console.log('─'.repeat(64));

const problems = [];

try {
  // 放探针
  await mkdir(probeDir, { recursive: true });
  for (const probe of PROBES) {
    await writeFile(join(probeDir, probe.file), probe.body, 'utf8');
  }
  await writeFile(join(probeDir, DRAFT_PROBE.file), DRAFT_PROBE.body, 'utf8');
  console.log(`\n放入 ${PROBES.length} 个格式探针和 1 个草稿隔离探针，构建…`);

  // 干净的构建：不要被上一次的产物骗到
  await cleanBuildState(root);

  const code = await runAstro(['build']);
  if (code !== 0) {
    problems.push(`探索构建失败（退出码 ${code}）`);
  }

  // 逐个检查是否真的产出了页面
  for (const probe of PROBES) {
    let found = true;
    try {
      await readFile(join(dist, probe.expect));
    } catch {
      found = false;
    }

    if (found) {
      console.log(`  ✓ ${probe.label} 产出了页面`);
    } else {
      problems.push(
        `${probe.label} 声明支持但没有产出页面（期望 /${probe.expect}）——` +
          `构建成功、退出码 0，内容凭空消失`,
      );
      console.log(`  ✗ ${probe.label} 没有产出页面`);
    }
  }

  // 新增机器可读出口后，格式支持与草稿隔离也必须覆盖它。
  // 否则页面是对的，增量同步清单却可能漏掉 MDX 或泄漏草稿。
  try {
    const manifest = JSON.parse(await readFile(join(dist, 'content-manifest.json'), 'utf8'));
    const ids = new Set(manifest.documents.map((doc) => doc.id));
    for (const probe of PROBES) {
      const slug = probe.file.replace(/\.(?:md|mdx)$/, '');
      if (ids.has(`post:${slug}`)) {
        console.log(`  ✓ ${probe.label} 进入了内容清单`);
      } else {
        problems.push(`${probe.label} 页面存在，但内容清单漏掉了 post:${slug}`);
      }
    }
    if (ids.has(`post:${DRAFT_PROBE.slug}`)) {
      problems.push(`草稿泄漏到内容清单：post:${DRAFT_PROBE.slug}`);
    } else {
      console.log('  ✓ 草稿没有进入内容清单');
    }

    /*
     * ── 字体体积 ──────────────────────────────────────────────────────
     *
     * ⚠️ **口径陷阱**：`du -sk` 按 4 KB 块算，得出 104；
     * 而实际字节是 102164 = **99.8 KB**（README 写 100 KB 是对的）。
     * **两个数都是「实测」，但只有一个对。** 所以这里一律用字节数。
     *
     * 字体是**不需要 gzip 预压缩**的资源（已经是 woff2），
     * 所以直接加总字节即可。
     */
    const astroDir = join(dist, '_astro');
    const fontFiles = (await readdir(astroDir)).filter((f) => f.endsWith('.woff2'));
    if (fontFiles.length > 0) {
      let fontBytes = 0;
      for (const f of fontFiles) fontBytes += (await readFile(join(astroDir, f))).length;
      const readmeText = await readFile(join(process.cwd(), 'README.md'), 'utf8');
      const claimed = /字体 \| \*\*([\d.]+) KB/.exec(readmeText)?.[1];
      const actual = Math.round(fontBytes / 1024);
      if (claimed !== String(actual)) {
        problems.push(
          `README 写字体 ${claimed} KB，实际 ${actual} KB（${fontBytes} bytes）。` +
            `⚠️ 口径：一律用字节数。\`du -sk\` 按 4 KB 块对齐，` +
            `对同一批文件可能给出不同的 KB 数（有时凑巧相同、有时差几 KB）——` +
            `两个数都是「实测」，但只有一个对。`,
        );
      } else {
        console.log(`  ✓ README 里的字体体积与产物一致（${actual} KB / ${fontFiles.length} 个文件）`);
      }
    }

    /*
     * ── README 里的实测数字，必须等于产物里的实测值 ────────────────────
     *
     * 2026-09-24 实测抓到的漂移：README 写「CSS 单文件 23.7 KB / gzip 5.1 KB」，
     * 而**内容改动之后实际是 24.1 KB / 5.1 KB**——
     * gzip 那个还准，原始体积漂了，**而没有任何门禁发现**。
     *
     * 已被门禁守着的只有三类（测试条数、契约条数、token 节省率）。
     * 体积、页数这些**同样会随内容漂**，只是没人比对。
     *
     * 口径写在这里是为了让下一个人不必重新推：
     * - 体积按 **KB = bytes / 1024**，一位小数；
     * - CSS 取 `dist/_astro/*.css` 的**第一个**（本项目只有一个）；
     * - gzip 用 `zlib.gzipSync(buf, { level: 9 })`——
     *   **不是** `gzip -c`（默认级别 6，数字会差几个字节）。
     */
    const { gzipSync } = await import('node:zlib');
    const cssDir = join(dist, '_astro');
    const cssFiles = (await readdir(cssDir)).filter((f) => f.endsWith('.css')).sort();
    if (cssFiles.length > 0) {
      /*
       * ⚠️ **`_astro` 里只该有本站的 CSS。**
       * Pagefind 也会产 CSS（`pagefind-ui.css` 等），但它们在 `dist/pagefind/`。
       * 一旦哪天它把 CSS 也写进 `_astro`，`sort()[0]` 可能取到 Pagefind 的
       * 那份——**而门禁照样会绿**（只要两个数字碰巧接近）。
       * 所以这里断言「只有一份」，把那个前提钉住，而不是靠它成立。
       */
      if (cssFiles.length > 1) {
        problems.push(
          `dist/_astro/ 里有 ${cssFiles.length} 个 CSS：${cssFiles.join('、')}。` +
            `本检查只认**本站那一份**——若 Pagefind 的 CSS 也进了这个目录，` +
            `按文件名排序取第一个会取错，而门禁仍可能绿。`,
        );
      }
      const cssBytes = (await readFile(join(cssDir, cssFiles[0]))).length;
      const cssGzip = gzipSync(await readFile(join(cssDir, cssFiles[0])), { level: 9 }).length;
      const readme = await readFile(join(process.cwd(), 'README.md'), 'utf8');
      const claimedRaw = /CSS \| 单文件 \*\*([\d.]+) KB/.exec(readme)?.[1];
      const claimedGzip = /gzip ([\d.]+) KB/.exec(readme)?.[1];
      const actualRaw = (cssBytes / 1024).toFixed(1);
      const actualGzip = (cssGzip / 1024).toFixed(1);
      if (claimedRaw !== actualRaw) {
        problems.push(
          `README 写 CSS 单文件 ${claimedRaw} KB，实际 ${actualRaw} KB` +
            `（${cssBytes} bytes）。**内容改动会让它漂，而漂了没人提醒。**`,
        );
      }
      if (claimedGzip !== actualGzip) {
        problems.push(`README 写 CSS gzip ${claimedGzip} KB，实际 ${actualGzip} KB`);
      }
      if (claimedRaw === actualRaw && claimedGzip === actualGzip) {
        console.log(`  ✓ README 里的 CSS 体积与产物一致（${actualRaw} KB / gzip ${actualGzip} KB）`);
      }
    }

    /*
     * ⚠️ **站内 JS 体积刻意不在这里查。**
     *
     * 我先加了这条，然后实测发现它**永远量到 0**：
     * 本脚本第 84 行只跑 `runAstro(['build'])`，**不跑 `pagefind`**，
     * 而站内 JS 全部来自 Pagefind 产物——所以门禁自己的构建产物里
     * `dist` 连 `_astro` 之外都没有 js。
     *
     * > **一条量不到东西的门禁，比没有门禁更坏**：
     * > 它绿着，而它绿的原因与它声称要守的东西无关。
     * > 本轮已经吃过一次同族亏（迭代 R 的元检查），
     * > 那次是自己写的，这次是自己刚加的。
     *
     * 所以它放在 `npm run measure` 里——**那个命令跑在完整 `npm run build`
     * 之后**，口径与本文件一致（同一个 `Math.round(bytes / 1024)`）。
     */

    /*
     * 来源与复核状态必须真的在产物里。
     *
     * 2026-09-24 加的字段，单测已经覆盖了 `buildContentManifest`——
     * 但**单测过不等于产物里有**：中间还有一层「manifest 怎么被生成、
     * 怎么被序列化」。这一条量的是**最终那个 JSON 文件**。
     *
     * 为什么值得单独断言：`stale` 内容不得在机器接口里被当成新鲜内容，
     * 而 manifest 正是订阅者判断「这篇能不能信」的唯一依据。
     * 字段一旦从产物里消失，订阅者不会报错——它只会安静地少一个判断依据。
     */
    /*
     * 清单版本号必须与**文档里声明的期望版本**一致。
     *
     * ⚠️ 这里**不能**直接 import `content-manifest.ts` 来比常量：
     * 那个文件内部用 `.js` 后缀 import（TS 惯例，bundler 能解析），
     * 而这些脚本是**裸 Node** 跑的，解析不了——实测报
     * `Cannot find module '.../wiki/graph.js'`。
     * 仓库里其它脚本能 import 源码，是因为它们 import 的模块内部没有 `.js` 引用。
     *
     * 所以期望值写在下面这个常量里。
     *
     * **单向检查是不够的**：只查「产物 == 期望值」，那么源码升了、
     * 期望值忘了改，产物与期望值仍然相等，**契约照样绿**——
     * 而产物里的版本已经和源码声明的对不上了。
     * 所以下面**同时**从源码文本里读出常量，两个数一起比。
     * （读文本而不是 import，正是为了绕开上面那个 `.js` 解析问题。）
     */
    const EXPECTED_MANIFEST_VERSION = 2;
    const declared = await readFile(
      join(dist, '..', 'src', 'lib', 'content-manifest.ts'),
      'utf8',
    ).then((t) => /CONTENT_MANIFEST_VERSION\s*=\s*(\d+)/.exec(t)?.[1]);
    if (!declared) {
      problems.push('从 src/lib/content-manifest.ts 里读不出 CONTENT_MANIFEST_VERSION');
    } else if (Number(declared) !== EXPECTED_MANIFEST_VERSION) {
      problems.push(
        `源码里的 CONTENT_MANIFEST_VERSION 是 ${declared}，` +
          `而本检查期望 ${EXPECTED_MANIFEST_VERSION}。` +
          `改了字段形状要**同时**改两处：常量与这个期望值。`,
      );
    }
    if (manifest.version !== EXPECTED_MANIFEST_VERSION) {
      problems.push(
        `产物里的 manifest version 是 ${manifest.version}，` +
          `期望 ${EXPECTED_MANIFEST_VERSION}。` +
          `**改了字段形状就要升版本**——同一份 version 对应两种形状，` +
          `正是版本号要防的事。（同时确认 src/lib/content-manifest.ts 里的 ` +
          `CONTENT_MANIFEST_VERSION 也改了）`,
      );
    } else {
      console.log(`  ✓ 清单版本号符合预期（v${manifest.version}）`);
    }

    const withProvenance = manifest.documents.filter((doc) => doc.provenance);
    const reviewedOnes = withProvenance.filter((doc) => doc.provenance.review?.status === 'reviewed');
    const sourcedOnes = withProvenance.filter((doc) => (doc.provenance.sources ?? []).length > 0);
    if (withProvenance.length > 0 && reviewedOnes.length === 0) {
      problems.push('内容清单里有 provenance，却没有任何一条带 review 状态——字段多半是空的');
    }
    if (withProvenance.length > 0 && sourcedOnes.length === 0) {
      problems.push('内容清单里有 provenance，却没有任何一条带 sources——同上');
    }
    if (withProvenance.length > 0) {
      console.log(
        `  ✓ 来源与复核状态进入了内容清单（${withProvenance.length} 篇有 provenance，` +
          `${sourcedOnes.length} 篇带来源，${reviewedOnes.length} 篇带复核状态）`,
      );
    } else {
      problems.push(
        '内容清单里一篇 provenance 都没有——本站有登记来源的页面，' +
          '这说明 provenance 没有进入产物（单测过不代表产物里有）',
      );
    }
  } catch (error) {
    problems.push(
      `内容清单不存在或无法解析：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 首次全量导出必须与增量清单覆盖同一批内容；否则接入方式不同，看到的站点也不同。
  try {
    const lines = (await readFile(join(dist, 'content.ndjson'), 'utf8'))
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const byId = new Map(lines.map((record) => [record.id, record]));
    const markdown = byId.get('post:zprobe-markdown-format');
    const mdx = byId.get('post:zprobe-mdx-format');
    const draft = byId.get(`post:${DRAFT_PROBE.slug}`);
    if (
      markdown?.content?.text.includes('格式探针 Markdown') &&
      mdx?.content?.text.includes('格式探针 MDX') &&
      !draft
    ) {
      console.log('  ✓ 全量导出收录 Markdown / MDX 正文且排除草稿');
    } else {
      problems.push('全量导出没有正确覆盖 Markdown、MDX 与草稿隔离');
    }
  } catch (error) {
    problems.push(
      `全量内容导出不存在或无法解析：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 两种受支持格式共用一个标签，真实构建必须把它们都放进同一份全文订阅。
  try {
    const tagFeed = await readFile(join(dist, 'tags', 'zprobe-format-feed', 'rss.xml'), 'utf8');
    const includesMarkdown = tagFeed.includes('<title>格式探针 Markdown</title>');
    const includesMdx = tagFeed.includes('<title>格式探针 MDX</title>');
    const fullItems = tagFeed.match(/<content:encoded>/g)?.length ?? 0;
    if (includesMarkdown && includesMdx && fullItems === 2) {
      console.log('  ✓ 标签 RSS 同时支持 Markdown、MDX 与全文输出');
    } else {
      problems.push('标签 RSS 没有完整收录 Markdown、MDX 两种格式的全文');
    }
  } catch (error) {
    problems.push(
      `格式探针的标签 RSS 不存在或无法读取：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const forbiddenOutputs = [
    join(dist, DRAFT_PROBE.slug, 'index.html'),
    join(dist, `${DRAFT_PROBE.slug}.md`),
    join(dist, 'og', `${DRAFT_PROBE.slug}.png`),
  ];
  const leakedFiles = [];
  for (const full of forbiddenOutputs) {
    try {
      await readFile(full);
      leakedFiles.push(full.slice(dist.length + 1));
    } catch {
      // 正确：没有生成草稿产物
    }
  }

  /*
   * ── 全产物扫描：**不按扩展名白名单跳过** ──────────────────────────────
   *
   * 这里原先写的是 `if (!/\.(html|md|txt|xml|json|ndjson)$/.test(rel)) continue`——
   * 一个**白名单**。它当时是对的，但它的失败方式是无声的：
   * 将来多一个出口（换扩展名、加一种导出格式），泄漏检查会**静默地不覆盖它**，
   * 而扫描照样打印"草稿没有进入任何文本出口"。
   *
   * 改成扫**全部**文件，按 UTF-8 尝试解码；解不出来的（真二进制）跳过，
   * 但**把跳过数报出来**——范围可见，而不是"看起来全覆盖"。
   *
   * 二进制产物（Pagefind 的压缩索引、字体、图片）确实搜不出明文标记，
   * 这是方法的边界，不是保证。所以这里只声称"文本产物无泄漏"；
   * 索引那一侧由另一条性质兜住：**索引只能收录实际生成的页面**，
   * 而草稿页面根本没生成（上面 `forbiddenOutputs` 已断言）。
   */
  let scanned = 0;
  let skippedBinary = 0;
  for (const relative of await readdir(dist, { recursive: true })) {
    const full = join(dist, relative);
    let bytes;
    try {
      bytes = await readFile(full);
    } catch {
      continue; // 目录
    }
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      skippedBinary++;
      continue;
    }
    scanned++;
    if (text.includes(DRAFT_PROBE.marker)) leakedFiles.push(relative);
  }

  if (leakedFiles.length === 0) {
    console.log(
      `  ✓ 草稿没有进入页面、孪生文件、OG 或任何文本出口` +
        `（扫描 ${scanned} 个文本产物，跳过 ${skippedBinary} 个二进制）`,
    );
  } else {
    const unique = [...new Set(leakedFiles)];
    problems.push(`草稿泄漏到 ${unique.join('、')}`);
    console.log(`  ✗ 草稿泄漏到 ${unique.join('、')}`);
  }

  try {
    await readFile(join(dist, 'tags', 'zprobe-private-tag', 'rss.xml'));
    problems.push('只被草稿使用的标签仍生成了公开 RSS');
  } catch {
    console.log('  ✓ 只被草稿使用的标签不会生成 RSS');
  }

  // 前面的正向构建已通过，所以这一次唯一新增变量就是冲突文章。
  await writeFile(join(probeDir, RESERVED_ROUTE_PROBE.file), RESERVED_ROUTE_PROBE.body, 'utf8');
  await cleanBuildState(root);
  console.log('\n放入占用 /about/ 的文章，确认构建会明确失败…');
  const reservedCode = await runAstro(['build']);
  if (reservedCode === 0) {
    problems.push('文章占用系统路由时构建仍然成功——HTML 会被静默跳过');
    console.log('  ✗ 系统路由冲突没有阻断构建');
  } else {
    console.log('  ✓ 系统路由冲突会阻断构建');
  }
} finally {
  // 无论如何都要清掉探针，别把它们留在仓库里
  for (const probe of PROBES) {
    await rm(join(probeDir, probe.file), { force: true });
  }
  await rm(join(probeDir, DRAFT_PROBE.file), { force: true });
  await rm(join(probeDir, RESERVED_ROUTE_PROBE.file), { force: true });
  await cleanBuildState(root);
  console.log('\n探针已清理（内容层缓存与产物也一并清掉，避免污染后续构建）');
}

console.log('\n' + '─'.repeat(64));
if (problems.length === 0) {
  console.log('内容发布探针通过。\n');
} else {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log('');
}
process.exitCode = problems.length === 0 ? 0 : 1;
