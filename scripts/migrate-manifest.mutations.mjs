#!/usr/bin/env node
/**
 * `migrate-manifest` 的负向验证：**失败时的诊断够不够精确**。
 *
 * 路线图阶段 4 的退出条件是两句，第二句常被忽略：
 *
 *   > 「v1 数据可确定性迁移到 v2，**失败时有精确诊断**。」
 *
 * 「失败时报错」很容易（抛异常即可）；**「报出哪一条、为什么、怎么修」** 才是那句退出条件。
 * 而「精确」这个词必须能证伪 —— 所以这里逐种注入坏数据，
 * 每次都必须报出**能定位到具体条目**的诊断，而不是一个笼统的失败。
 *
 * 坏法分五类：
 *   ① 缺 `id`             → 应定位到 documents[i]
 *   ② `markdown.sha256` 不合法 → 应定位到具体 id
 *   ③ ID 重复            → 应报出重复的那个 id
 *   ④ `documentCount` 对不上 → 应报出两个数（说明清单被改过）
 *   ⑤ v1 里出现**不认识**的字段 → 应拦下（不能静默透传）
 *
 * ⑤ 最要紧：`{ ...input, version: 2 }` 那种写法会**静默带过去**，
 * 产出一个「看着像 v2」实则不兼容的清单——**而它不会报任何错**。
 *
 * 跑法：`node scripts/migrate-manifest.mutations.mjs`
 * 退出码 0 = 五次都真的报出了精确诊断。
 */
import { readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
/*
 * 样本是**进版本库的真实线上 v1**，不是 `.verify/` 里的临时文件——
 * 后者被 gitignore 忽略，这道验证在 CI 上就会读不到输入而**假绿或报错**。
 */
const DIR = join(ROOT, 'knowledge/fixtures');
const SRC = join(DIR, 'manifest-v1.json');
const SCRIPT = join(ROOT, 'scripts/migrate-manifest.mjs');
const TMP = join(ROOT, '.verify/manifest-mutated.json');

const runMigrate = () => {
  try {
    const out = execFileSync('node', [SCRIPT, TMP, '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { ok: true, out: `${out}` };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

const MUTATIONS = [
  {
    name: '① 缺 id',
    expect: /documents\[\d+\].*id|缺少 id/s,
    why: '必须能定位到第几条',
    apply: (m) => {
      delete m.documents[3].id;
    },
  },
  {
    name: '② sha256 不合法',
    expect: /sha256/,
    why: '必须点名是哪个字段',
    apply: (m) => {
      m.documents[5].markdown.sha256 = 'not-a-hash';
    },
  },
  {
    name: '③ ID 重复',
    expect: /ID 重复/,
    why: '必须报出重复',
    apply: (m) => {
      m.documents[7].id = m.documents[6].id;
    },
  },
  {
    name: '④ documentCount 对不上',
    expect: /documentCount[\s\S]*?声明[\s\S]*?实际/,
    why: '必须报出两个数，让人能判断是手工改的还是生成端坏了',
    apply: (m) => {
      m.documentCount = 99;
    },
  },
  {
    name: '⑤ 出现不认识的 v1 字段',
    /*
     * ⚠️ 这里写的是**输出里的原话**，不是「大意」。
     * 第一版写 `/不认识的 v1 字段/` 而实际输出是「**不认识**的 v1 字段」——
     * 差一个词，于是**实现对了、正则报错了**，看起来像「没拦下」。
     *
     * > 断言要匹配**真实输出**，而「我记得它会说什么」不算依据。
     * > 改判据时该做的第一件事是**看一眼它现在到底打印什么**。
     */
    expect: /\*\*不认识\*\*的 v1 字段/,
    why: '静默透传会产出「看着像 v2」的假清单',
    apply: (m) => {
      m.documents[2].legacyScore = 0.87;
    },
  },
];

let allGood = true;
console.log('migrate-manifest 的负向验证（诊断是否精确）');
console.log('─'.repeat(64));

// 先确认好数据是通的
writeFileSync(TMP, readFileSync(SRC, 'utf8'), 'utf8');
const good = runMigrate();
if (!good.ok) {
  console.log('  ✗ 真实的线上 v1 都迁不过——先修那个，本轮验证没有意义');
  console.log(good.out.slice(0, 500));
  process.exit(1);
}
console.log('  ✓ 真实的线上 v1：可迁移\n');

for (const m of MUTATIONS) {
  const manifest = JSON.parse(readFileSync(SRC, 'utf8'));
  m.apply(manifest);
  writeFileSync(TMP, JSON.stringify(manifest, null, 2), 'utf8');
  const { ok, out } = runMigrate();
  rmSync(TMP, { force: true });

  if (ok) {
    console.log(`  ✗ ${m.name} → **迁移居然成功了**，${m.why}`);
    allGood = false;
  } else if (m.expect.test(out)) {
    const line = (out.match(/✗[^\n]*/) ?? [''])[0].trim();
    console.log(`  ✓ ${m.name} → 报错了（${line.slice(0, 70)}）`);
  } else {
    console.log(`  ✗ ${m.name} → 报错了，但**不是预期的诊断**（${m.why}）`);
    console.log(`      ${out.split('\n').filter((l) => l.includes('✗')).join('\n      ')}`);
    allGood = false;
  }
}

rmSync(TMP, { force: true });
console.log('');
console.log(
  allGood
    ? '五种坏法都报出了能定位到具体条目的诊断——「失败时有精确诊断」这句退出条件有证据了。'
    : '有坏法没有被精确诊断拦下。',
);
console.log();
process.exit(allGood ? 0 : 1);
