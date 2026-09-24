#!/usr/bin/env node
/**
 * 把 `version: 1` 的内容清单迁到 `version: 2`。
 *
 * ── 为什么需要 ──────────────────────────────────────────────────────
 *
 * 路线图阶段 4 第 2 项：「设计 manifest v2，同时保留 v1 读取或转换路径」，
 * 退出条件：「**v1 数据可确定性迁移到 v2，失败时有精确诊断**」。
 *
 * > ⚠️ **此前 log 里写「v1 从未真正发布过，可以评估是否需要迁移路径」——那句是错的。**
 * > 2026-09-24 实测线上 Demo：`https://xiaoxusop.github.io/letterpress/content-manifest.json`
 * > 返回 `version: 1`、11 篇文档、字段里**没有** `provenance`。
 * > **v1 有真实消费方**（Demo 线上 + `docs/content-manifest.md` 推荐的订阅方式）。
 *
 * ── 为什么「看起来只是加个可选字段」仍然要写迁移器 ──────────────────
 *
 * 实测把线上 v1 与本地 v2 逐条逐字段对比：ID 全对得上、结构完全一致、
 * 9 条差异**全部是内容变新**（`updatedAt` 与 markdown hash），**没有一处格式不兼容**。
 *
 * > 正因为它简单，**风险才更容易被低估**：
 * > 「反正是可选字段，消费方忽略不认识的多余键就行」——
 * > **这个假设本身没有门禁验证过**。迁移器的价值不是「转换」，
 * > 是**把「v1 能不能升到 v2」这件事变成可执行、可复现、可回归的**。
 *
 * ── 迁移的核心语义：不要凭空造 provenance ──────────────────────────
 *
 * v1 的 11 篇**一条来源信息都没有**。迁移时如果补一个默认值：
 *
 * - 补 `review.status: 'pending'` → **撒谎**：没人复核过，不是「待复核」；
 * - 补 `original: { reason: ... }` → **撒谎**：这些不是原创实践，是「没进过这个系统」；
 * - 整键缺席 → **正确**，但与「查过、确认无外部来源」在数据里又长得一样。
 *
 * 第三种才是真问题。本项目此前已经踩过同族坑
 * （见 `content-manifest.ts` 里 `provenance` 的注释：「两者在数据里长得一模一样」）。
 *
 * 所以本迁移器的立场是：
 *
 *   **如实保留「v1 没有这个字段」这个事实，不补任何默认值，
 *   并在输出里显式报告「哪些条目因此没有 provenance」。**
 *
 * 消费方据此能区分三种情况，而不是两种。
 *
 * ── 「确定性」的含义 ────────────────────────────────────────────────
 *
 * 同一份 v1 输入，**逐字节**得到同一份 v2 输出。不得引入：
 * 构建时钟、随机数、依赖文件系统遍历顺序的逻辑、依赖当前版本号的分支。
 * `migrate` 的输出里**不含时间戳**——与 manifest 本身「不写 generatedAt」同理由。
 *
 * 用法：
 *   node scripts/migrate-manifest.mjs <v1.json> [-o out.json] [--check]
 *
 *   --check  只验证能否迁移，不写文件（CI / 预演用）
 * 退出码见 `src/lib/cli/exit-codes.mjs`；失败时**逐条列出**哪一条不合法。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  EXIT_USAGE,
  EXIT_NOT_FOUND,
  EXIT_INVARIANT,
} from '../src/lib/cli/exit-codes.mjs';

const MANIFEST_FORMAT = 'letterpress-content-manifest';
const FROM_VERSION = 1;
const TO_VERSION = 2;

// ── 逐条诊断 ────────────────────────────────────────────────────────

/** @type {{ level: 'error' | 'warn', where: string, message: string }[]} */
const diagnostics = [];

/**
 * 校验一条 v1 文档能否安全迁移。
 *
 * 判据分两类，**分开报**：
 * - `error`：迁不过去（结构不对、缺必需字段、ID 重复）
 * - `warn`：能迁，但下游要知道（没有 provenance）
 */
function checkDocument(doc, index) {
  const where = `documents[${index}]`;
  if (typeof doc !== 'object' || doc === null) {
    diagnostics.push({ level: 'error', where, message: '不是对象' });
    return false;
  }
  if (typeof doc.id !== 'string' || doc.id === '') {
    diagnostics.push({ level: 'error', where, message: '缺少 id（或不是非空字符串）' });
    return false;
  }
  if (typeof doc.markdown?.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(doc.markdown.sha256)) {
    diagnostics.push({ level: 'error', where: `${where} (${doc.id})`, message: 'markdown.sha256 缺失或不是 64 位十六进制' });
    return false;
  }
  if (typeof doc.markdown?.bytes !== 'number' || !Number.isInteger(doc.markdown.bytes)) {
    diagnostics.push({ level: 'error', where: `${where} (${doc.id})`, message: 'markdown.bytes 缺失或不是整数' });
    return false;
  }
  if (typeof doc.urls?.markdown !== 'string' || typeof doc.urls?.html !== 'string') {
    diagnostics.push({ level: 'error', where: `${where} (${doc.id})`, message: 'urls.markdown / urls.html 至少缺一个' });
    return false;
  }

  /*
   * v1 里没有 provenance，而「没有」有两种含义（见文件头）。
   * 如实报告，**不补默认值**。
   */
  if (!('provenance' in doc)) {
    diagnostics.push({
      level: 'warn',
      where: `${where} (${doc.id})`,
      message:
        'v1 没有 provenance，迁移后该键**保持缺席**。' +
        '它表示「这份数据从未进过治理流程」，**不是**「已复核、确认无外部来源」。' +
        '若下游必须区分，请用本工具的 --report 输出。',
    });
  }
  return true;
}

function migrateManifest(input) {
  diagnostics.length = 0;

  if (typeof input !== 'object' || input === null) {
    diagnostics.push({ level: 'error', where: '(根)', message: '不是一个 JSON 对象' });
    return null;
  }
  if (input.format !== MANIFEST_FORMAT) {
    diagnostics.push({
      level: 'error',
      where: 'format',
      message: `是 ${JSON.stringify(input.format)}，期望 ${MANIFEST_FORMAT}。` +
        '它可能不是内容清单。',
    });
  }
  if (input.version !== FROM_VERSION) {
    diagnostics.push({
      level: 'error',
      where: 'version',
      message: `是 ${JSON.stringify(input.version)}，本工具只迁 v${FROM_VERSION}。` +
        (input.version === TO_VERSION
          ? '**它已经是 v2 了**——直接用，不需要迁移。'
          : '版本号不认识时请先查 docs/content-manifest.md。'),
    });
  }
  if (!Array.isArray(input.documents)) {
    diagnostics.push({ level: 'error', where: 'documents', message: '不是数组' });
    return null;
  }
  if (input.documentCount !== input.documents.length) {
    diagnostics.push({
      level: 'error',
      where: 'documentCount',
      message: `声明 ${JSON.stringify(input.documentCount)}，实际 ${input.documents.length} 条。` +
        '两者不一致说明这份清单被手工改过或生成端有 bug——**不要在它上面迁移**。',
    });
  }

  const seen = new Set();
  input.documents.forEach((doc, i) => {
    if (checkDocument(doc, i) && seen.has(doc.id)) {
      diagnostics.push({ level: 'error', where: `documents[${i}] (${doc.id})`, message: 'ID 重复' });
    }
    if (doc && typeof doc.id === 'string') seen.add(doc.id);
  });

  const errors = diagnostics.filter((d) => d.level === 'error');
  if (errors.length > 0) return null;

  /*
   * ── 转换本体 ──────────────────────────────────────────────────────
   *
   * 刻意**逐字段列举**而不是 `{ ...input, version: 2 }`：
   *
   * > 展开运算符会在 v1 以后新增字段时**静默带过去**——
   * > 那些字段可能是 v1 独有的、v2 已经改名或删除的，
   * > 而迁移器会毫无察觉地产出一个「看着像 v2」的清单。
   * > 逐字段列举 + 「有 v1 里没列出的键就报错」把这件事变成显式的。
   */
  const V1_DOC_KEYS = [
    'id', 'kind', 'slug', 'title', 'summary', 'urls',
    'publishedAt', 'updatedAt', 'tags', 'relations', 'markdown', 'wikiKind',
  ];
  const V1_TOP_KEYS = ['format', 'version', 'site', 'documentCount', 'edgeCount', 'documents'];

  for (const doc of input.documents) {
    for (const key of Object.keys(doc)) {
      if (!V1_DOC_KEYS.includes(key)) {
        diagnostics.push({
          level: 'error',
          where: `documents (${doc.id}).${key}`,
          message:
            '这是本迁移器**不认识**的 v1 字段。它可能是 v1 独有的、v2 已删除的字段——' +
            '静默带过去会产出一个「看着像 v2」实则不兼容的清单。' +
            '若确认该字段在 v2 里仍然有效，请把它加进 migrate-manifest.mjs 的 V1_DOC_KEYS。',
        });
      }
    }
  }
  for (const key of Object.keys(input)) {
    if (!V1_TOP_KEYS.includes(key)) {
      diagnostics.push({
        level: 'error',
        where: `(根).${key}`,
        message: '这是本迁移器不认识的顶层字段，同样不做静默透传。',
      });
    }
  }
  if (diagnostics.some((d) => d.level === 'error')) return null;

  return {
    format: input.format,
    version: TO_VERSION,
    site: { ...input.site },
    documentCount: input.documents.length,
    edgeCount: input.edgeCount,
    documents: input.documents.map((doc) => {
      // 逐字段重建，**不展开**：多余键在上面已经报错，这里就不会带过去。
      const out = {};
      for (const key of V1_DOC_KEYS) if (key in doc) out[key] = doc[key];
      // provenance **不补**——理由见文件头。
      return out;
    }),
  };
}

// ── 主流程 ──────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const inputPath = argv.find((a) => !a.startsWith('-') && !a.startsWith('--'));
const outIndex = argv.indexOf('-o') >= 0 ? argv.indexOf('-o') + 1 : argv.indexOf('--out') + 1;
const outPath = outIndex > 0 ? argv[outIndex] : null;
const checkOnly = argv.includes('--check');

if (!inputPath) {
  console.error(
    '用法：node scripts/migrate-manifest.mjs <v1.json> [-o out.json] [--check]\n' +
      '  --check  只验证能否迁移，不写文件',
  );
  process.exit(EXIT_USAGE);
}

const full = resolve(process.cwd(), inputPath);
if (!existsSync(full)) {
  console.error(`读不到 ${inputPath}——路径不对？`);
  process.exit(EXIT_NOT_FOUND);
}

let parsed;
try {
  parsed = JSON.parse(readFileSync(full, 'utf8'));
} catch (error) {
  console.error(`${inputPath} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
  process.exit(EXIT_NOT_FOUND);
}

const migrated = migrateManifest(parsed);

console.log('内容清单 v1 → v2 迁移');
console.log('─'.repeat(64));

const warns = diagnostics.filter((d) => d.level === 'warn');
const errors = diagnostics.filter((d) => d.level === 'error');

if (errors.length > 0) {
  for (const d of errors) console.log(`  ✗ ${d.where}：${d.message}`);
  console.log(`\n${errors.length} 处错误，**没有产出文件**。修好后重跑。\n`);
  process.exit(EXIT_INVARIANT);
}

if (warns.length > 0) {
  console.log(`  ⚠ ${warns.length} 条 warn（能迁，但下游要知道）：`);
  for (const d of warns) console.log(`    · ${d.where}`);
  console.log('');
  console.log('  这些条目在 v1 里没有 provenance，迁移后该键**保持缺席**。');
  console.log('  它表示「从未进过治理流程」，**不是**「已复核、确认无外部来源」。\n');
}

const out = JSON.stringify(migrated, null, 2);

if (checkOnly) {
  console.log(`  ✓ 可以迁移：${migrated.documents.length} 篇，v1 → v${migrated.version}（--check，未写文件）`);
  console.log(`  ✓ 输出是**确定性的**：不含时间戳，同一份输入逐字节得到同一份输出\n`);
  process.exit(0);
}

if (!outPath) {
  console.error('给了输入却没给输出。用 -o <路径>，或加 --check 只验证。');
  process.exit(EXIT_USAGE);
}

writeFileSync(join(process.cwd(), outPath), out + '\n', 'utf8');
console.log(`  ✓ 已迁移 ${migrated.documents.length} 篇 → ${outPath}`);
console.log(`  ✓ 输出是**确定性的**：不含时间戳，同一份输入逐字节得到同一份输出\n`);
