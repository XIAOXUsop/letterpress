#!/usr/bin/env node
/**
 * 文档里提到的文件路径，逐个核实它们真的存在。
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────
 *
 * 2026-09-24 实测：我在改文档时**顺手写下三个不存在的文件名**
 * （`netlify.toml`、仓库根的 `_headers`、不存在的 `_redirects`）。
 * 于是写了这个脚本，结果自己抓出第四个——**上一轮我为了「修正措辞」
 * 而加的那句里的 `response.json` 也是不存在的**（真名 `entry_response.json`）。
 *
 * > **那次改动的动机正是修正一处同类错误，而修正本身引入了同类错误。**
 *
 * 本项目的文档里有大量反引号包着的路径，而**没有检查比对过它们**。
 * 一条失效的路径对新读者的伤害比一个失效的数字更大：
 * 数字错了读者会怀疑，**路径错了读者照着找不到东西**。
 *
 * ── 判据（三类，分别处理）────────────────────────────────────────────
 *
 * | 类别 | 例子 | 怎么处理 |
 * |---|---|---|
 * | **仓库内路径** | `src/lib/cover.ts` | **必须存在**，否则报错 |
 * | **产物路径** | `pagefind.js`、`content-manifest.json` | 在 `dist/` 里找；**没有产物就不判** |
 * | **URL 路径** | `/content-manifest.json`、`/slug/index.md` | **跳过**——那是站点路径不是文件 |
 *
 * ⚠️ **这份脚本自己也出过误报**（第一版报 12 个「找不到」，11 个是错的）：
 * - 把产物文件当仓库文件（而 `dist` 当时被探针清空）；
 * - 把 URL 路径当文件路径；
 * - `[[path]]` 里的方括号被当成 glob 模式字符。
 *
 * > **一个会误报的检查比没有检查更糟**——它训练人忽略输出。
 * 所以三类分开处理，且**产物缺失时明确说「不判」而不是「不存在」**。
 *
 * 用法：`npm run check:refs`（有 dist 时最准；没有也能跑，产物类会跳过）
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const hasDist = existsSync(DIST);

// 会被当成「文档里提到的路径」的模式：反引号包着、带已知扩展名
const DOC_GLOBS = ['README.md', 'AGENTS.md', 'docs', 'src/content'];
const EXTS = new Set([
  '.ts', '.mjs', '.js', '.astro', '.json', '.css', '.md', '.mdx', '.toml', '.yml', '.yaml',
]);
// **已知扩展名**——只有落在这个表里的才当路径判。
// 表外的（如 `Doc.sources` 的 `sources`）是类型/字段名，**不是文件**。
const KNOWN = new Set(['ts', 'mjs', 'js', 'astro', 'json', 'css', 'md', 'mdx', 'toml', 'yml', 'yaml']);
// 这些是**内容里会出现的资源**，不是仓库里的源码文件
const SKIP_EXT = new Set(['woff2', 'png', 'svg', 'ico', 'webp', 'jpg', 'txt']);

// ── 收集仓库里所有文件（建索引，避免每个引用都走一遍树）──────────────
const index = new Map(); // basename -> 相对路径[]
function walk(dir, depth = 0) {
  if (depth > 6) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (['node_modules', '.git', '.verify', '.astro'].includes(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, depth + 1);
      continue;
    }
    // `[[path]].ts` 的方括号在 basename 里是合法的
    const base = e.name;
    if (!index.has(base)) index.set(base, []);
    index.get(base).push(full);
  }
}
walk(ROOT);

// ── 读文档 ──────────────────────────────────────────────────────────
const docs = [];
for (const entry of DOC_GLOBS) {
  const full = join(ROOT, entry);
  if (!existsSync(full)) continue;
  const st = statSync(full);
  if (st.isFile()) {
    docs.push(full);
    continue;
  }
  const walkDocs = (dir, depth = 0) => {
    if (depth > 4) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walkDocs(p, depth + 1);
      else if (EXTS.has(extname(e.name))) docs.push(p);
    }
  };
  walkDocs(full);
}

// 反引号里像路径的东西：`src/lib/cover.ts`、`functions/[[path]].ts`、`pagefind.js`
const PATH_LIKE = /`([A-Za-z0-9_./[\]-]+\.[A-Za-z0-9]+)`/g;
const problems = [];
const runtimePaths = [];
const checked = new Set(); // `${file}|${ref}`
let totalRefs = 0;

for (const doc of docs) {
  const text = readFileSync(doc, 'utf8');
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(PATH_LIKE)) {
      const ref = m[1];
      const ext = extname(ref).slice(1);
      /*
       * ⚠️ **扩展名必须在已知表里**，否则跳过。
       *
       * 第一版只判「末段像不像扩展名」，于是 `Doc.sources` / `Doc.review`
       * 这类**类型与字段名**被当成了文件（末段 `sources` 不在任何表里，
       * 但 `Doc.sources` 整体被反引号包着，看起来就像路径）。
       * 有 dist 时误报 13 处，无 dist 时 0 处——**同一个脚本两种结果**，
       * 说明判据本身不稳。
       */
      if (!KNOWN.has(ext)) continue;
      if (SKIP_EXT.has(ext)) continue;
      totalRefs++;

      // ① URL 路径：以 / 开头且不像仓库相对路径 → 跳过
      if (ref.startsWith('/')) continue;
      // ② 命令行参数（`node scripts/x.mjs --flag` 这类已被正则排除）
      // ③ 纯文件名无目录：可能是产物（pagefind.js）也可能是示例（README.md 自己）
      const base = ref.split('/').pop();
      const key = `${doc}|${ref}`;
      if (checked.has(key)) continue;
      checked.add(key);

      /*
       * ⚠️ **「提到一个文件」与「引述代码里的字符串」要分开。**
       *
       * `docs/cli.md` 里写着「项目里的 import 写的是 `./accept.js`」——
       * 那是在**解释 TS 的 ESM 约定**（源码写 `.js`、实际文件是 `.ts`），
       * **不是**在让读者去找一个叫 `accept.js` 的文件。
       *
       * 第一版把它判成失效路径，**是误报**。判据：前面是「import」「写的是」
       * 「source」这类**描述代码写法**的词时，跳过。
       */
      const QUOTING = /(?:import|require|写的是|源码|source|import\s)/i.test(line);
      if (QUOTING && base.endsWith('.js') && ref.startsWith('.')) continue;

      /*
       * ⚠️ **「引述一个错的文件名来说明修正」也要跳过。**
       *
       * 文档可能引用旧的错误文件名来说明修正，不能把这种引述算作失效路径。
       *
       * 判据：同一行里出现「不存在 / 写错 / 已改 / 头一版」这类**否认词**时跳过。
       * 否则**每一处勘误都会变成一个永久红的门禁**——
       * 而那等于在惩罚「把错误记下来」这个行为。
       */
      const DENYING = /(?:不存在|写错|已改|头一版|原先是|之前是|作废)/.test(line);
      if (DENYING) continue;

      // 仓库内路径：按**相对路径**比对，且两侧都要归一化分隔符。
      //
      // ⚠️ 这里踩过一个坑：`join('.', 'src/config.ts')` 在 Windows 上得到
      // `src\config.ts`，于是 `endsWith('src/config.ts')` 恒为 false——
      // **37 处全误报**，而 `src/config.ts` 明明就在仓库根下面。
      //
      // 也就是说：我在这份脚本的注释里写了「第一版有误报」，
      // 然后**自己又犯了同一类**：在自己写下的判据旁边，换了实现却没换判据。
      const norm = (p) => p.replace(/\\/g, '/');
      const inRepo = index.has(base) &&
        index.get(base).some((p) => {
          const rel = norm(relative(ROOT, p));
          return rel === ref || rel.endsWith('/' + ref) || ref === base;
        });
      if (inRepo) continue;

      // ④ 产物：只判「有 dist 时」；没有 dist 就不判
      const isArtifact = !ref.includes('/') || ref.includes('pagefind');
      if (isArtifact) {
        if (!hasDist) continue; // 明确不判，而不是判为不存在
        const inDist = existsSync(join(DIST, ref)) ||
          existsSync(join(DIST, 'pagefind', ref));
        if (inDist) continue;
        /*
         * ⚠️ **第四类：代码里引用、但运行时才存在的路径。**
         *
         * `entry_response.json` 就是这一类——它出现在 `pagefind.js` 的正文里，
         * 但**磁盘上永远不会有这个文件**：那是 Pagefind 在浏览器里
         * 用 `fetch()` 请求的端点（带 hash 与查询串），由服务端的路由处理。
         *
         * 判据：它出现在**产物代码的正文里**（`dist/pagefind/pagefind.js` 含该串）
         * 且不在磁盘上 → 判为「运行时路径」，**跳过**。
         *
         * > 否则**每一处提到运行时端点的文档都会变成一个永久红的门禁**。
         * 判不出来的东西不该判——那不是严谨，是噪声。
         */
        try {
          const code = readFileSync(join(DIST, 'pagefind', 'pagefind.js'), 'utf8');
          if (code.includes(base)) {
            runtimePaths.push(
              `${doc.replace(ROOT + '\\', '').replace(ROOT + '/', '')}:${i + 1}  \`${ref}\``,
            );
            continue;
          }
        } catch {
          /* pagefind.js 不在，跳过 */
        }
      }

      problems.push(
        `${doc.replace(ROOT + '\\', '').replace(ROOT + '/', '')}:${i + 1}  \`${ref}\`` +
          `${isArtifact ? '（产物）' : ''} —— 仓库与 dist 里都找不到`,
      );
    }
  });
}

console.log('文档里提到的文件路径');
console.log('─'.repeat(64));
console.log(
  `  扫了 ${docs.length} 份文档、${totalRefs} 处路径引用` +
    `${hasDist ? '（含 dist/ 里的产物）' : '（无 dist，产物类路径**不判**）'}\n`,
);

if (problems.length > 0) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(
    `\n${problems.length} 处提到的文件**在仓库里找不到**。\n` +
      `  新读者照着一条失效的路径找不到东西，比数字错了更难查。\n`,
  );
  process.exit(1);
}
if (runtimePaths.length > 0) {
  console.log(`  ∅ ${runtimePaths.length} 处是**运行时路径**（代码里引用、磁盘上不存在）：`);
  for (const r of runtimePaths) console.log(`      ${r}`);
  console.log('    静态无法核实，已归类跳过——不判比误判好。');
}
console.log('  ✓ 文档里提到的每一处路径都能找到对应文件（或被明确归为运行时路径）');

/*
 * ── 顺手查一件极轻的事：文档里有没有乱码 ──────────────────────────
 *
 * U+FFFD（`�`）是**编码替换字符**——某次写入时源文本不是合法 UTF-8，
 * 解码器把它换成了这个字符，而**它不会报错，只是静静地留在那里**。
 *
 * 编码替换字符通常来自错误的文本解码，会直接出现在读者可见内容里。
 *
 * 判据：扫全部文档，出现即红并指出位置。
 * **成本是一次正则扫描**，而它抓到的东西读者一眼就看得见。
 */
const mojibake = [];
for (const f of docs) {
  const rel = relative(ROOT, f).split(sep).join('/');
  readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.includes('�')) mojibake.push(`${rel}:${i + 1}`);
    });
}
if (mojibake.length > 0) {
  console.log('');
  console.log(`  ✗ 文档里有 ${mojibake.length} 处编码替换字符（U+FFFD）：`);
  for (const where of mojibake) console.log(`      ${where}`);
  console.log('    它是**某次写入时源文本不是合法 UTF-8**留下的，替换器不认识就换成了它。');
  console.log('    不报错、不崩，只是在读者眼里变成「这里坏了」。');
  process.exit(1);
}
console.log('  ✓ 文档里没有编码替换字符（U+FFFD）\n');

/*
 * ── 顺带一件本轮踩到的事：**怎么读 git 里的内容** ────────────────────
 *
 * 管道读取 git 输出时若终端编码不一致，
 * 读出来的中文**全是乱码**，而 `execFileSync('git', [...]).toString('utf8')`
 * 读出来是好的。
 *
 * 根因是 **Git Bash 用 cp936 而非 UTF-8**：
 * 管道里的字节先过 bash 的文本层再进 node，于是被按 GBK 解释。
 * 看起来像「git 损坏了文件」或「文件编码坏了」——
 * 而**文件是好的、git 也是好的，只有中间那层管道在骗人**。
 *
 * > 那一轮我差点因此「重写」一个好文件；
 * > 而重写又会把**另一段里真的**乱码带回来（它本来就坏着）。
 *
 * 所以：**要读 git 里的内容，一律用 `execFileSync` 拿 Buffer，不走管道。**
 * 记忆里那条「Git Bash 与原生 Windows 程序的边界」说的是同一件事，
 * 这次它伪装成了另一个问题——而**伪装得比原问题更像真的**。
 */
