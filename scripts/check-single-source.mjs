#!/usr/bin/env node
/**
 * 版本号单一真相门禁：**`CONTENT_MANIFEST_VERSION` 不得被复制到别处。**
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 2026-09-24 实测一个**真 bug**，而不是理论风险：
 *
 * | 位置 | 当时写着 |
 * |---|---|
 * | `src/lib/content-manifest.ts`（生产端） | `2` |
 * | `scripts/lib/content-sync.mjs`（同步器） | **`1`** |
 * | `scripts/lib/content-sync.test.mjs`（测试固件） | **`1`** |
 * | `scripts/check-formats.mjs`（门禁期望） | `2` |
 *
 * 提交 `2518438` 把生产端升到 2 时，**后两处没跟着改**。
 * 后果：
 *
 *   - 同步器对着**本站自己的**清单必然报「不支持的内容清单格式或版本」；
 *   - 而 **453 条测试全绿**——因为测试固件也写着 1，
 *     **它测的是一个已经不存在的格式**。
 *
 * > 变异验证（把 `MANIFEST_VERSION` 改回 1）：二次同步立刻报
 * > 「不支持的内容清单格式或版本」。修复后是 `unchanged: 11`。
 * > **所以那确实是 bug，不是误报。**
 *
 * > 根因不是「忘了改」，是**同一个事实被写了两遍，而两遍都没有对另一遍的检查**。
 * > 版本号这种「改一处就该处处变」的东西，**写第二遍就等于埋一个未来的静默故障**。
 *
 * ── 判据 ────────────────────────────────────────────────────────────
 *
 * 扫全仓（排除 `src/lib/content-manifest.ts` 本身、`.git`、`node_modules`、`dist`），
 * 找出**硬编码** manifest 版本号的地方。
 *
 * 两种合法写法：
 *   ① `MANIFEST_VERSION = readManifestVersion()` / 从源码文本读 —— **接受**
 *   ② 对比**源码里的那个常量**（`!== CONTENT_MANIFEST_VERSION`）—— **接受**
 *
 * 判据怎么做到不误报，见下面 `looksHardcoded` 的注释。
 *
 * 用法：`npm run check:single-source`
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, extname } from 'node:path';

const ROOT = process.cwd();
const SOURCE = join(ROOT, 'src', 'lib', 'content-manifest.ts');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.astro', '.verify', 'coverage']);

/** 版本号的真值。 */
const TRUTH = (() => {
  const text = readFileSync(SOURCE, 'utf8');
  const n = /CONTENT_MANIFEST_VERSION\s*=\s*(\d+)/.exec(text)?.[1];
  if (!n) {
    console.error('从 src/lib/content-manifest.ts 里读不出 CONTENT_MANIFEST_VERSION');
    process.exit(1);
  }
  return Number(n);
})();

/**
 * 一个片段是不是「硬编码的版本号」。
 *
 * 判据要窄，否则误报：只要出现 `version: 2` 就报，会把
 * `STATE_VERSION = 1`（同步状态文件自己的版本，**与 manifest 无关**）
 * 和 `RECORD_VERSION = 1`（NDJSON 记录的版本）一起误伤——
 * **它们本来就是独立的格式，各自有各自的版本**。
 *
 * 所以只找**明确在讲 manifest** 的上下文：
 *   - `MANIFEST_VERSION = <字面数字>`
 *   - `EXPECTED_MANIFEST_VERSION = <字面数字>`
 *   - `version: <字面数字>` 出现在含 `manifest` 的行上
 *   - 测试固件里的 `version: <字面数字>`（那一行所在的函数叫 `manifest(...)`）
 */
/*
 * 三条形状。⚠️ **前两条与第三条缺一不可**——
 * 第一版只写了前两条，而注释里明明计划了第三条，
 * 于是「测试固件里写死 `version: 1`」抓不到（变异验证时才发现）。
 *
 * > **注释里写了而代码没实现，就是「约束写在注释里」的第四例**
 * > （前三次：迭代 AK 的 JSON-LD `note` 分支、迭代 AL 门禁自己的放行规则、
 * > 本轮的第三条 pattern）。它每次都表现为「看上去覆盖了，实际没有」。
 */
const PATTERNS = [
  { re: /\bMANIFEST_VERSION\s*=\s*(\d+)\b/, label: 'MANIFEST_VERSION' },
  { re: /\bEXPECTED_MANIFEST_VERSION\s*=\s*(\d+)\b/, label: 'EXPECTED_MANIFEST_VERSION' },
  /*
   * 测试固件里的 `version: 1`。这一条**必须限定在 manifest 上下文**：
   * `content.ndjson` 的记录也有 `version:` 字段（`RECORD_VERSION`，独立格式），
   * 一并抓就是误报。
   *
   * 判据：行里出现 `version:` + 数字，**且**该行或其上方 12 行内出现 `manifest`
   * （大小写不敏感）。12 行是「固件里 manifest(...) 函数与它内部的 version 字段的距离」，
   * 实测那份固件相隔 7 行。**这个数是量出来的，不是拍的。**
   */
  {
    re: /\bversion\s*:\s*(\d+)\b/,
    label: 'manifest 的 version 字段',
    needsContext: /manifest/i,
    contextLines: 12,
  },
];

const problems = [];
let scanned = 0;

function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      scan(join(dir, entry.name));
      continue;
    }
    const full = join(dir, entry.name);
    if (full === SOURCE) continue;
    if (!/\.(ts|mjs|js|astro)$/.test(entry.name)) continue;
    /*
     * ⚠️ **不要排除测试文件。**
     *
     * 第一版这里有一行 `if (entry.name === 'content-sync.test.mjs') continue;`，
     * 理由没写——而它恰恰是**最该被扫的那个**：
     * 测试固件里写死 `version: 1` 正是这次故障的另一半
     * （同步器与固件都停在 1，于是 453 条测试全绿却功能是坏的）。
     *
     * > 变异验证时才发现：往固件里注入 `version: 1`，门禁**没有报**。
     * > 排除了该扫的地方，门禁就只剩一半能力——
     * > **而它看上去和完整版一模一样。**
     */
    scanned++;

    const text = readFileSync(full, 'utf8');
    /*
     * 先把**块注释整段抹掉**（用等长空格替换，保持行号不变——不然报错行号会指错地方），
     * 再逐行剥 `//` 之后的内容。
     *
     * ⚠️ 2026-09-24 实测：不剥会**抓到门禁自己的说明文字**——
     * `check-formats.mjs` 那段注释写着「原先这里有
     * `EXPECTED_MANIFEST_VERSION = 2`」，而那正是解释**为什么删掉它**的句子。
     *
     * > **门禁报自己的注释，等于让人忽略它的报告。**
     */
    const code = text.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length)).split('\n');
    code.forEach((line, i) => {
      const rel = relative(ROOT, full).split(sep).join('/');
      // 剥行注释。本仓库的门禁代码里没有 `http://` 这类紧跟判据的字面量，
      // 所以「`//` 之后一律丢掉」够用；要更严就得写真实的词法分析器，那超出本检查的目的。
      const bare = line.replace(/\/\/.*$/, '').trim();
      if (bare === '') return;

      for (const { re, label, needsContext, contextLines } of PATTERNS) {
        const m = re.exec(bare);
        if (!m) continue;
        if (needsContext) {
          // 看上下文窗口里有没有「这是在讲 manifest」的证据
          const from = Math.max(0, i - contextLines);
          const window = code.slice(from, i + 1).join('\n');
          if (!needsContext.test(window)) continue;
        }
        if (bare.includes('readManifestVersion') || bare.includes('MANIFEST_VERSION)')) continue;
        problems.push(
          `${rel}:${i + 1}  ${label} 写死为 ${m[1]}\n` +
            `    版本号的真值在 src/lib/content-manifest.ts（当前 ${TRUTH}）。\n` +
            `    写第二遍的后果**已经发生过**：生产端升到 2 而这里没跟上，\n` +
            `    同步器对着本站自己的清单报错，而 453 条测试全绿——\n` +
            `    因为测试固件也写着旧值，**测的是一个已不存在的格式**。\n` +
            `    改法：从源码读（见 content-sync.mjs 的 readManifestVersion），\n` +
            `    或至少与 CONTENT_MANIFEST_VERSION 直接对比。`,
        );
      }
    });
  }
}

for (const top of ['src', 'scripts']) {
  if (existsSync(join(ROOT, top))) scan(join(ROOT, top));
}

console.log('版本号是否只有一处真值');
console.log('─'.repeat(64));
console.log(`  真值：src/lib/content-manifest.ts 的 CONTENT_MANIFEST_VERSION = ${TRUTH}`);
console.log(`  扫了 ${scanned} 个文件\n`);

/*
 * ⚠️ **扫到 0 个文件时必须红。**
 * 与 `check-portability` 同一条纪律（本轮第四次撞上「空集合通过」）：
 * **「扫了 0 个、没有写死版本号」与「扫了 N 个、没有写死」不是一回事**——
 * 前者只说明什么都没检。
 */
if (scanned === 0) {
  bad('版本号检查扫到 0 个文件——`src` / `scripts` 的路径可能变了，没有检到任何东西');
  console.log('  ✗ 扫到 0 个文件——不能算「没有写死版本号」');
}

if (problems.length > 0) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处把版本号写死了。\n`);
  process.exit(1);
}
console.log('  ✓ 没有任何地方把 manifest 版本号写死\n');

// ── 3. 文档里转述的版本号 ─────────────────────────────────────────
/*
 * ⚠️ **代码与文档是两个都写同一个数字的地方，而代码那侧本检查已经管了。**
 *
 * 2026-09-24 实测：`docs/content-manifest.md` 的「边界」一节写着
 * 「这是版本为 1 的项目格式」——**而实际是 2**（manifest 早就升了）。
 * 那句话就在我新写的「IR 版本号就是 version」那段下面，**自相矛盾**。
 *
 * > 它能活这么久，是因为**没有任何东西核对文档里的版本号**——
 * > 而 `check-single-source` 此前只扫代码。
 * > **加了检查却只覆盖一半，和没加一样。**
 *
 * 判据：文档里出现「版本为 N」且 N ≠ 真值就红。
 *
 * 只检查声称当前版本的文档，不检查历史快照。
 */
const DOCS_WITH_VERSION_CLAIM = [
  'README.md',
  'AGENTS.md',
  'docs/content-manifest.md',
  'docs/content-sync.md',
  'docs/content-export.md',
  'docs/cli.md',
];
console.log('');
console.log('文档里转述的版本号');
console.log('─'.repeat(64));

const docProblems = [];
for (const doc of DOCS_WITH_VERSION_CLAIM) {
  const full = join(ROOT, doc);
  if (!existsSync(full)) continue;
  const text = readFileSync(full, 'utf8');
  for (const m of text.matchAll(/版本为\s*`?(\d+)`?/g)) {
    if (Number(m[1]) !== TRUTH) {
      docProblems.push(
        `${doc} 里写「版本为 ${m[1]}」，而真值是 ${TRUTH}。\n` +
          `    文档里的版本号此前没人核对——2026-09-24 实测到一处「版本为 1」的陈旧说法。`,
      );
    }
  }
}
if (docProblems.length > 0) {
  for (const p of docProblems) console.log(`  ✗ ${p}`);
  problems.push(...docProblems);
} else {
  /*
   * ⚠️ **「扫了 N 份都没问题」与「N 份里一处都没扫到」在输出里原本长得一样。**
   *
   * 2026-09-24 实测：这六份文档里**一处「版本为 N」都没有**——
   * 于是这段判据什么都没检，而它打印的是「6 份文档里转述的版本号与真值一致」。
   *
   * > 判据要问两件事：**被扫到几处？期望几处？**
   * > 「0 处匹配、0 处不符」与「6 处匹配、6 处都对」在结果上无法区分，
   * > 除非**把匹配数一起报出来**。
   */
  const hits = DOCS_WITH_VERSION_CLAIM.reduce(
    (n, doc) => n + [...readFileSync(join(ROOT, doc), 'utf8').matchAll(/版本为\s*`?(\d+)`?/g)].length,
    0,
  );
  if (hits === 0) {
    console.log(
      `  ℹ ${DOCS_WITH_VERSION_CLAIM.length} 份文档里**一处「版本为 N」都没有**——` +
        '这条判据此刻没检到任何东西。\n' +
        '    （2026-09-24 曾有一处「版本为 1」的陈旧说法，已被修正。）',
    );
  } else {
    console.log(`  ✓ ${DOCS_WITH_VERSION_CLAIM.length} 份文档里扫到 ${hits} 处版本声明，都与真值一致`);
  }
}

/*
 * ⚠️ **退出判断必须放在最后。**
 *
 * 2026-09-24 实测踩了：加文档检查时把代码插在**退出判断之前**，
 * 于是 `problems` 里有东西、输出里也打印了 `✗`，而**退出码仍是 0**——
 * 门禁在 `verify:all` 里等于不存在。
 *
 * > 症状极具欺骗性：**「它报了」与「它判了」是两件事**。
 * > 而本轮已经因为同一类错误付过两次代价
 * > （JSON-LD 的 `note` 分支、check-site-agnostic 的放行规则）。
 *
 * 判据本身（`problems` 非空就红）早就在，
 * 缺的只是**把新检查的结果接进那个已经存在的通道**。
 */
if (problems.length > 0) {
  console.log(`\n${problems.length} 处问题。\n`);
  process.exit(1);
}
console.log('\n版本号只有一处真值，且文档转述与它一致。\n');
