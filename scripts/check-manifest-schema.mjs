#!/usr/bin/env node
/**
 * 内容清单的 **JSON Schema** 门禁。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────
 *
 * 路线图阶段 4 退出条件之一是「schema、CLI 和输出契约都有**兼容性测试**」。
 * 2026-09-24 核对时发现：**那一条只做了一半**——
 * CLI 错误码与输出契约都有检查，而 **schema 一份都没有**。
 *
 * 后果不是「少个文件」：
 *
 *   - 消费方只能靠**读文档**判断字段形状，而文档与产物漂了没人发现；
 *   - 「`version` 字段那一行写着版本为 1」这类陈旧说法能活很久
 *     （2026-09-24 实测到一处，就在「边界」那一节里）。
 *
 * 而且**不能往 manifest 里加 `$schema` 字段**指路：
 * 那会改产物形状，按本项目的判据**就该升版本**——
 * 为了一份指路而升版本是本末倒置。
 *
 * ── 三条判据 ────────────────────────────────────────────────────────
 *
 * ① **产物符合 schema**（不是「schema 存在」，是「它描述的东西真的合规」）
 * ② **schema 的 `version` 约束与产物、与源码常量一致**（三处不能各说各话）
 * ③ **docs 里有指路**（消费方找得到它）
 *
 * ⚠️ **本检查不引入 JSON Schema 校验库**——
 * 理由与迁移器不引依赖同源：本项目主张「零依赖、离线可跑」，
 * 而一份 schema 的核心用途是**给人与工具读的规格**，
 * 不是在 CI 里当验证器。① 用手写的不变量实现——
 * **它比通用校验器更能表达「这个项目在意什么」**
 * （例如「documentCount 必须等于 documents.length」）。
 *
 * 用法：`npm run check:manifest-schema`
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCHEMA = join(ROOT, 'public', 'content-manifest.schema.json');
const MANIFEST = join(ROOT, 'dist', 'content-manifest.json');
const SOURCE = join(ROOT, 'src', 'lib', 'content-manifest.ts');
const DOC = join(ROOT, 'docs', 'content-manifest.md');
const README = join(ROOT, 'README.md');

const problems = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => problems.push(msg);

console.log('内容清单的 JSON Schema');
console.log('─'.repeat(64));

// ── 前置：文件都在吗 ────────────────────────────────────────────────
if (!existsSync(SCHEMA)) {
  console.error('  ✗ public/content-manifest.schema.json 不存在');
  process.exit(1);
}
if (!existsSync(MANIFEST)) {
  console.error('  ✗ dist/content-manifest.json 不存在——先 npm run build');
  console.error('      **没有产物就说「产物符合 schema」是空话**。');
  process.exit(1);
}
ok('schema 与产物都在');

const schema = JSON.parse(readFileSync(SCHEMA, 'utf8'));
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

// ── ① 产物符合 schema 里声明的不变量 ────────────────────────────────
const declared = schema.properties.version;
if (!declared) {
  bad('schema 的 properties.version 不存在');
} else if (declared.const !== undefined) {
  if (manifest.version !== declared.const) {
    bad(`schema 说 version 是 ${declared.const}，而产物是 ${manifest.version}`);
  }
} else if (typeof declared.minimum !== 'number' || manifest.version < declared.minimum) {
  bad(`schema 的 version 约束没盖住产物的 ${manifest.version}`);
} else {
  ok(`schema 的 version 约束盖住了产物的 ${manifest.version}`);
}

if (schema.properties.format?.const !== manifest.format) {
  bad(`schema 的 format 约束是 ${schema.properties.format?.const}，产物是 ${manifest.format}`);
} else {
  ok(`format 标识一致（${manifest.format}）`);
}

if (manifest.documentCount !== manifest.documents.length) {
  bad(`documentCount（${manifest.documentCount}）≠ documents.length（${manifest.documents.length}）`);
} else {
  ok(`documentCount 与实际条数一致（${manifest.documentCount}）`);
}

// 文档的必需字段：与 schema 的 required 一致，且每条都真的满足
const docRequired = schema.$defs?.document?.required ?? [];
const missing = new Map();
for (const doc of manifest.documents) {
  for (const field of docRequired) {
    if (!(field in doc)) {
      if (!missing.has(field)) missing.set(field, []);
      missing.get(field).push(doc.id);
    }
  }
}
if (missing.size > 0) {
  for (const [field, ids] of missing) {
    bad(`产物里有 ${ids.length} 条文档缺 required 字段「${field}」（例：${ids[0]}）`);
  }
} else {
  ok(`${manifest.documents.length} 条文档都带齐 schema 的 ${docRequired.length} 个必需字段`);
}

/*
 * `additionalProperties: false` 是这份 schema 最值钱的一条——
 * 它让「悄悄加字段」变成一次显式的决定。
 * 所以必须核：**产物里没有 schema 未声明的字段**。
 */
const docProps = new Set(Object.keys(schema.$defs?.document?.properties ?? {}));
const topProps = new Set(Object.keys(schema.properties ?? {}));
const unknownTop = Object.keys(manifest).filter((k) => !topProps.has(k));
if (unknownTop.length > 0) {
  bad(`产物顶层有 schema 未声明的字段：${unknownTop.join('、')}\n    （schema 声明了 additionalProperties: false——加字段就该升版本并更新 schema）`);
} else {
  ok('产物顶层没有 schema 未声明的字段');
}
const unknownDoc = [
  ...new Set(manifest.documents.flatMap((d) => Object.keys(d).filter((k) => !docProps.has(k)))),
];
if (unknownDoc.length > 0) {
  bad(`产物文档里有 schema 未声明的字段：${unknownDoc.join('、')}`);
} else {
  ok('产物文档里没有 schema 未声明的字段');
}

/*
 * ⚠️ **反方向同样要查，而第一版漏了。**
 *
 * 变异验证实测：给 schema 的 `properties` 加一个 `generator: { type: string }`
 * ——**门禁全绿**。因为它只查了「产物里有没有 schema 未声明的字段」，
 * 没查「schema 声明的字段在产物里有没有」。
 *
 * > 契约是**双向**的：
 * > 「多出来的」破坏兼容（旧消费方会看到不认识的键），
 * > 「缺掉的」**同样破坏**（消费方按 schema 读一个不存在的字段，拿到 undefined）。
 *
 * 后者更隐蔽：它不会让旧代码崩，只让**按 schema 生成的代码**静默拿到 undefined。
 */
const missingTop = [...topProps].filter((k) => !(k in manifest));
if (missingTop.length > 0) {
  for (const k of missingTop) {
    const isRequired = (schema.required ?? []).includes(k);
    bad(
      `schema 声明了顶层字段「${k}」，而产物里没有。\n` +
        (isRequired
          ? '    它还在 required 里——**产物不符合自己的 schema**。\n'
          : '    它不是 required，但声明了却没产出，schema 与产物已经对不上。\n') +
        '    契约是**双向**的：多出来的与缺掉的都会破坏消费方。',
    );
  }
} else {
  ok('schema 声明的顶层字段产物里都有');
}

// provenance 的三种含义
const withProv = manifest.documents.filter((d) => 'provenance' in d);
const emptyProv = withProv.filter((d) => Object.keys(d.provenance ?? {}).length === 0);
if (emptyProv.length > 0) {
  bad(
    `有 ${emptyProv.length} 条文档的 provenance 是**空对象**。\n` +
      `    空对象读起来像「查过了，没有」，而缺席是「没标」——**这两种含义不能混**。`,
  );
} else {
  ok(`${withProv.length} 条文档的 provenance 都不是空对象`);
}

/*
 * ── 文档里转述的「N 篇有 provenance」必须与产物一致 ────────────────
 *
 * `docs/content-manifest.md` 里写着「本仓库的 v2 里 8 篇有 `provenance`、3 篇没有」。
 * 那个数**会随内容增删而漂**，而本仓库反复记着同一件事：
 * **文档里的实测数字没人守着，就一定会漂**（契约条数、单测条数、
 * 「几道门禁」都漂过）。
 *
 * > 那 3 篇不是缺陷，是**诚实的结果**——
 * > 「没有来源也没有复核状态」如实写出来，而不是补一个 `pending` 假装填过。
 * > 正因如此它值得被核对：**它是治理覆盖率的直接读数。**
 */
const withoutProv = manifest.documents.length - withProv.length;
if (existsSync(DOC)) {
  const docText = readFileSync(DOC, 'utf8');
  const claimed = /(\d+)\s*篇有\s*`?provenance`?[、，]\s*(\d+)\s*篇没有/.exec(docText);
  if (claimed) {
    const saidWith = Number(claimed[1]);
    const saidWithout = Number(claimed[2]);
    if (saidWith !== withProv.length || saidWithout !== withoutProv) {
      bad(
        `文档里写「${saidWith} 篇有 provenance、${saidWithout} 篇没有」，` +
          `而产物是 ${withProv.length} / ${withoutProv}。\n` +
          '    那是**治理覆盖率的直接读数**——它漂了没人知道，直到有人拿它当依据。',
      );
    } else {
      ok(`文档转述的 provenance 覆盖数与产物一致（${withProv.length} / ${withoutProv}）`);
    }
  }
}

/*
 * ── 站内 JS 的三个数：README 写的是不是产物里的 ──────────────────────
 *
 * ⚠️ **2026-09-24 才补上，而它们的漂移已经造成过一次实际损失**：
 * `docs/design-notes.md` 写「实测 gzip 146 KB」，
 * 而 README 写「那个数在当前环境已无法复现」——
 * **同一份仓库里一个声称实测、一个声称作废**。
 *
 * 根因是 `check-formats.mjs` **刻意不查站内 JS**（它只跑 `astro build`、
 * 不跑 pagefind，所以量到 0）——理由成立，**但结论是「那三个数只能手抄」**。
 *
 * > 而**手抄的数一定会漂**。这不是「可能」，是已经发生过的事实。
 *
 * 本检查**自己跑 `npm run build`**（含 pagefind），所以能核。
 * 口径与 `npm run measure` 完全一致：`Math.round(bytes / 1024)`、
 * `gzipSync(bytes, { level: 9 })`。
 *
 * ⚠️ **只核「全部 js 文件」那个口径**（6 个 / 未压缩 / gzip 上界）。
 * README 另有一个更窄的数（「访问者真正会加载 5 个、gzip 93 KB」）——
 * **那要浏览器网络面板才能确认**，Node 里量不出来
 * （`pagefind.js` 内部按需加载哪些 UI 组件取决于页面配置）。
 * **所以那个数不核**，并在 README 里写明它与这里的上界不是一回事。
 */
const PAGEFIND_DIR = join(ROOT, 'dist', 'pagefind');
if (existsSync(PAGEFIND_DIR)) {
  const { readdirSync: rd } = await import('node:fs');
  const { gzipSync: gz } = await import('node:zlib');
  const jsFiles = rd(PAGEFIND_DIR).filter((f) => f.endsWith('.js'));
  let raw = 0;
  let gzipped = 0;
  for (const f of jsFiles) {
    const bytes = readFileSync(join(PAGEFIND_DIR, f));
    raw += bytes.length;
    gzipped += gz(bytes, { level: 9 }).length;
  }
  const kbRaw = Math.round(raw / 1024);
  const kbGz = Math.round(gzipped / 1024);

  if (existsSync(README)) {
    const readme = readFileSync(README, 'utf8');
    // README 的站内 JS 行里，「6 个 js」与「431 KB」必须与产物一致
    const saysCount = new RegExp(`\\*\\*${jsFiles.length}\\s*个\\s*js\\*\\*`).test(readme);
    if (!saysCount) {
      bad(
        `产物里有 ${jsFiles.length} 个站内 js，而 README 的「站内 JS」一行没写这个数。
` +
          `    **它是手抄的**——而手抄的数已经漂过一次（146 KB）。`,
      );
    } else {
      ok(`README 的「${jsFiles.length} 个 js」与产物一致`);
    }
    if (readme.includes(`${kbRaw} KB`)) {
      ok(`README 的「${kbRaw} KB」（未压缩合计）与产物一致`);
    } else {
      bad(
        `README 的「站内 JS」一行没有 ${kbRaw} KB 这个数（产物实测 ${raw} bytes）。
` +
          `    用 \`npm run measure\` 核对——**它的口径就是门禁的口径**。`,
      );
    }
  }
  console.log(`  ℹ 站内 JS：${jsFiles.length} 个 / 未压缩 ${kbRaw} KB / gzip ${kbGz} KB（可复现上界）`);
} else {
  bad('dist/pagefind 不存在——本检查的 build 应当已跑过 pagefind');
}

const stale = manifest.documents.filter((d) => d.provenance?.review?.status === 'stale');
console.log('');
console.log(`  ℹ 产物里有 ${stale.length} 条 stale——那是「已不可信但仍在出口里」的文档。`);
console.log('    消费方应当**拒绝把它当新鲜证据**（schema 的 review.status 描述里写了这一点）。');

// ── ② schema 的 version 与源码常量一致（三处不能各说各话） ─────────
const declaredInSource = /CONTENT_MANIFEST_VERSION\s*=\s*(\d+)/.exec(readFileSync(SOURCE, 'utf8'))?.[1];
if (!declaredInSource) {
  bad('从 src/lib/content-manifest.ts 里读不出 CONTENT_MANIFEST_VERSION');
} else if (Number(declaredInSource) !== manifest.version) {
  bad(
    `源码声明 ${declaredInSource}、产物是 ${manifest.version}、schema 约束是 ${declared.minimum}。\n` +
      `    **三个数必须一致**——它们各自都能独立改，而只有两处改了就没人发现。`,
  );
} else {
  ok(`源码常量、产物、schema 三处的 version 一致（${manifest.version}）`);
}

// ── ③ 文档指路（消费方找得到它） ──────────────────────────────────
if (!existsSync(DOC)) {
  bad('docs/content-manifest.md 不存在');
} else {
  const doc = readFileSync(DOC, 'utf8');
  if (!doc.includes('content-manifest.schema.json')) {
    bad(
      `docs/content-manifest.md 里**没有提到** content-manifest.schema.json。\n` +
        `    schema 躺在 public/ 里没人知道，等于没有。\n` +
        `    消费方是照文档找字段的——文档不指路，schema 就白写。`,
    );
  } else {
    ok('文档指路了');
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处问题。\n`);
  process.exit(1);
}
console.log('\n产物符合 schema；源码 / 产物 / schema 三处 version 一致；文档指路；provenance 覆盖数与站内 JS 的数都与产物一致。\n');
