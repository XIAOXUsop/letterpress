#!/usr/bin/env node
/**
 * `content.ndjson` 里每条记录的 `content.text` 必须与产物里那份 `.md` **逐字节一致**。
 *
 * ── 为什么单独一条 ──────────────────────────────────────────────────
 *
 * `docs/content-export.md` 对消费端有一句承诺：
 *
 * > 每条正文与真实 `.md` 文件逐字节一致，字节数和 SHA-256 同时匹配。
 *
 * 而**没有任何门禁核它**（2026-09-29 实测）：
 *
 * | 检查 | 它核什么 |
 * |---|---|
 * | `check-manifest-schema` | manifest 的 JSON Schema、三处 version、README 的几个数字 |
 * | `check-base` | NDJSON 里每条记录**链接前缀**对不对（子路径部署） |
 * | —— | **正文本身对不对，没人核** |
 *
 * 而这一条恰恰是消费端最依赖的：**RAG 管线拿到的就是这段 text**。
 * 若它和 `.md` 不一致（差一个换行、差一次 trim、编码不同），
 * 下游按 `sha256` 校验就会失败——而**失败在下游，不在构建**。
 *
 * ── 判据三条，缺一不可 ──────────────────────────────────────────────
 *
 *   ① `content.text` 与对应 `.md` **逐字节**相同；
 *   ② `content.bytes` = 那个文本的 UTF-8 字节数；
 *   ③ `content.sha256` = 那个文本的 SHA-256。
 *
 * ②③ 是**自洽性**（记录自己说的对不对），① 是**与产物的一致性**。
 * 只有 ②③ 的话，一份「所有记录的 hash 都算对了、但正文整体是旧的」
 * 能通过——而那正是最难发现的一种坏法。
 *
 * ⚠️ **`bytes` 不能用 `text.length` 验**：JavaScript 的字符串长度是
 * UTF-16 码元数，中文会算错。文档里专门写了这一句——见 `content-export.md` 末尾。
 *
 * 用法：`npm run verify:ndjson`（需要 dist；没有会自己 build）
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const NDJSON = join(DIST, 'content.ndjson');

if (!existsSync(NDJSON)) {
  console.log('\ncontent.ndjson 正文一致性');
  console.log('─'.repeat(64));
  console.log('  没有 dist/content.ndjson —— 先跑 npm run build。');
  process.exit(1);
}

const problems = [];
const bytes = new Uint8Array(readFileSync(NDJSON));
if (bytes.length === 0) {
  console.error('  ✗ content.ndjson 是空的——这一步什么都没量。');
  process.exit(1);
}

// `content.ndjson` 用 UTF-8 写；**按 UTF-8 解码整份再切行**，
// 不能按字节切（多字节字符会被截断）。
const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const lines = raw.split('\n').filter((l) => l.trim() !== '');
if (lines.length === 0) {
  console.error('  ✗ content.ndjson 一行都没有——这一步什么都没量。');
  process.exit(1);
}

/**
 * 记录的 `.md` 产物路径：从 `urls.markdown` 取，它是权威的那一份。
 *
 * ⚠️ **必须去掉 `site.home` 那一段前缀。** 产物里的 URL 是
 * `https://host/letterpress/cjk-web-typography.md`（**含部署子路径**），
 * 而 `dist/` 下的文件在**根**——不去掉的话每条都落空。
 * 这与 `check-search.mjs` 从 `content-manifest.json` 推「应被索引的页面集」
 * 时做的是同一件事（那里也减掉 `site.home`）。
 */
function mdPathOf(record, home) {
  const url = record.urls?.markdown ?? '';
  if (!url) return null;
  // 去掉协议与主机
  let rel = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '');
  // 去掉站点根（可能带部署子路径，如 `letterpress/`）
  const prefix = String(home ?? '')
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/^\/+/, '');
  if (prefix && rel.startsWith(prefix)) rel = rel.slice(prefix.length);
  return join(DIST, decodeURIComponent(rel.replace(/^\/+/, '')));
}

// 站点根在每条记录里都有（），先取一次
let home = null;
for (const l of lines) { try { home = JSON.parse(l).site?.home ?? home; break; } catch { /* 那行不合法，下面会报 */ } }

let checked = 0;
let skipped = 0;

for (const line of lines) {
  let record;
  try {
    record = JSON.parse(line);
  } catch (error) {
    problems.push(`有一行不是合法 JSON：${error instanceof Error ? error.message : error}`);
    continue;
  }

  const content = record.content;
  if (!content || typeof content.text !== 'string') {
    problems.push(`${record.id ?? '（无 id）'}：没有 content.text 字段`);
    continue;
  }

  // ① 逐字节比对
  const mdPath = mdPathOf(record, home);
  if (!mdPath || !existsSync(mdPath)) {
    skipped++;
    continue;
  }
  const onDisk = readFileSync(mdPath);           // Buffer，**按字节**
  const fromRecord = Buffer.from(content.text, 'utf8');
  checked++;

  if (!onDisk.equals(fromRecord)) {
    const a = onDisk.length;
    const b = fromRecord.length;
    problems.push(
      `${record.id}：content.text 与 ${mdPath.slice(DIST.length + 1).replace(/\\/g, '/')} ` +
        `**不是逐字节一致**（磁盘 ${a} 字节 / 记录 ${b} 字节）。\n` +
        `    消费端按 sha256 校验会失败——**而失败在下游，不在构建**。`,
    );
  }

  // ② bytes 必须是 **UTF-8 字节数**，不是字符串长度
  const utf8Len = Buffer.byteLength(content.text, 'utf8');
  if (content.bytes !== utf8Len) {
    problems.push(
      `${record.id}：content.bytes 是 ${content.bytes}，而 text 的 UTF-8 字节数是 ${utf8Len}。\n` +
        `    \`text.length\` 是 UTF-16 码元数，**中文会算错**——` +
        '文档末尾专门写过这一句。',
    );
  }

  // ③ sha256 必须对得上
  const digest = createHash('sha256').update(Buffer.from(content.text, 'utf8')).digest('hex');
  if (content.sha256 !== digest) {
    problems.push(
      `${record.id}：content.sha256 是 ${String(content.sha256).slice(0, 16)}…，` +
        `而实测是 ${digest.slice(0, 16)}…`,
    );
  }
}

console.log('\ncontent.ndjson 正文一致性');
console.log('─'.repeat(64));
console.log(
  `  ${lines.length} 条记录，逐条核了 ${checked} 条的正文` +
    `${skipped > 0 ? `（另有 ${skipped} 条找不到对应的 .md 产物，**未核**）` : ''}`,
);

/*
 * ⚠️ **一条都没核到就必须失败**——与其它检查同一条原则。
 * 若 `.md` 产物的路径规则改了，`mdPathOf` 会全部落空，
 * 而那时输出是「0 条核了」+ ✓——**一个空转的检查看起来最正常**。
 */
if (checked === 0) {
  console.log(`  ✗ 一条正文都没核到——${skipped} 条全找不到 .md 产物。`);
  console.log('    这说明 `urls.md` 的路径规则变了，**本检查已空转**——不能报通过。');
  process.exit(1);
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处不一致。\n`);
  process.exit(1);
}
console.log('  ✓ 每一条 content.text 都与它的 .md 逐字节一致，bytes 与 sha256 同时匹配\n');
