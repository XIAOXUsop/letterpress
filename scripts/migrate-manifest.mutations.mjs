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
 * 坏法分七类（①②③④⑤ 是本分支的，⑥⑦ 来自 main）：
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
 * 退出码 0 = 七次都真的报出了精确诊断。
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureWorktree, diffWorktree } from './lib/worktree-assert.mjs';

/** 跑之前的工作区——收尾断言要与它比，而不是与「空」比。 */
const WORKTREE = captureWorktree();

const ROOT = process.cwd();
/*
 * 样本是**进版本库的真实线上 v1**，不是 `.verify/` 里的临时文件——
 * 后者被 gitignore 忽略，这道验证在 CI 上就会读不到输入而**假绿或报错**。
 */
const DIR = join(ROOT, 'knowledge/fixtures');
const SRC = join(DIR, 'manifest-v1.json');
const SCRIPT = join(ROOT, 'scripts/migrate-manifest.mjs');
const TMP = join(ROOT, '.verify/manifest-mutated.json');

/*
 * ⚠️ **2026-09-28 修：这个目录原先靠「别人已经建过」而存在。**
 *
 * `.verify/` 在 `.gitignore` 里，所以**全新 checkout 上它不存在**——
 * `writeFileSync(TMP, …)` 直接 `ENOENT`，第 1 条坏法就红。
 *
 * > 症状极具欺骗性：**本地绿、CI 红**，而且**只在 CI 全新 checkout 上红**。
 * > 而 `full-gates`（`verify:all`）里它绿——因为第 5 步 `verify:testcount`
 * > 刚往 `.verify/` 写过报告，**目录已经在了**。
 * >
 * > 也就是说：**同一批门禁，因为前面的步骤做过什么而结果不同。**
 * > 本地也复现得了：`.verify/` 存在时绿、删掉时红。
 *
 * `mkdirSync(..., { recursive: true })` 在已存在时**不报错**，
 * 所以这行不改变任何已有行为，只是让它不再依赖别人的副作用。
 */
mkdirSync(join(ROOT, '.verify'), { recursive: true });

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
  /*
   * ⚠️ **⑥⑦ 来自 `origin/main`**（那边把这道门禁从五类扩到七类）。
   *
   * 2026-09-28 合并 `main` 时发现两边**都只有一半**：
   * `test` 侧有「`mkdirSync` 建 `.verify/` 目录」那个修复
   * （`main` 侧没有——而那正是「本地绿、CI 全新 checkout 红」的成因），
   * `main` 侧有这两类 schema 边界（`test` 侧没有）。
   *
   * > **冲突的正确解不是「选一边」**——那会丢掉另一边真正做的东西。
   * > **「同一道门禁被两边各自往前推」时，合并才是对的。**
   */
  {
    name: '⑥ markdown.bytes 为负数',
    expect: /documents\/2\/markdown\/bytes.*schema.*>= 0/s,
    why: '不能迁出不符合 schema 的 v2 清单',
    apply: (m) => {
      m.documents[2].markdown.bytes = -1;
    },
  },
  {
    name: '⑦ 缺少站点地址',
    expect: /\/site.*schema.*home/s,
    why: '缺少 site.home 时下游无法定位正文',
    apply: (m) => {
      delete m.site.home;
    },
  },
];

let allGood = true;
console.log('migrate-manifest 的负向验证（诊断是否精确）');
console.log('─'.repeat(64));

/*
 * ⚠️ **`--only <序号>`：只跑第 N 条坏法（1 起）。**
 *
 * 2026-09-28：这道门禁在 Linux CI 上红，而**失败详情读不到**
 * （job 日志要 admin 权限、`::error::` 只在日志里、step 摘要不经 API 暴露）。
 * 唯一匿名可读的是「哪个 step 红了」——所以 CI 上把 5 条坏法拆成
 * 5 个 step，各自 `--only`，**第一个红的 step 名就是答案**。
 *
 * 它同时让本地排查更快：复现单条不必等全部跑完。
 */
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg === -1 ? null : Number(process.argv[onlyArg + 1]);

// 先确认好数据是通的
writeFileSync(TMP, readFileSync(SRC, 'utf8'), 'utf8');
const good = runMigrate();
if (!good.ok) {
  console.log('  ✗ 真实的线上 v1 都迁不过——先修那个，本轮验证没有意义');
  console.log(good.out.slice(0, 500));
  process.exit(1);
}
console.log('  ✓ 真实的线上 v1：可迁移\n');

for (const [i, m] of MUTATIONS.entries()) {
  if (ONLY !== null && i + 1 !== ONLY) continue;
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
/* 收尾断言见 `lib/worktree-assert.mjs` 的文件头——
 * ⚠️ 这一道**把坏数据写进 `knowledge/fixtures/`（已跟踪目录）**，
 * 所以「工作区没变」在这里是真有牙齿的判据，而不是走过场。
 * 而 `rmSync(TMP)` 只删它自己那个临时文件，**别的残留它看不见**。 */
{ const { ok, report } = diffWorktree(WORKTREE);
  if (!ok) { console.log(report); allGood = false; }
  else console.log(report); }
console.log('');

/*
 * ⚠️ **只跑一条时不能说「全部坏法都……」**——
 * 那是本项目反复出现的「结论行比实际判定的多」。
 * `run:verify:migrate` 的默认路径（无 `--only`）才跑全部 7 条，
 * 那时这句话才成立。
 *
 * ⚠️ **而那句「5 条 / 4 条」也曾在这里**（2026-09-28 合并 `main` 时忘了改）——
 * **它跑的是七类、说的是五类，而两个数都不会报错**。
 * **所以这里用 `MUTATIONS.length` 而不是抄一个数。**
 */
const ranCount = ONLY === null ? MUTATIONS.length : 1;
console.log(
  allGood
    ? ONLY === null
      ? `${MUTATIONS.length} 种坏法都报出了能定位到具体条目的诊断`
        + '——「失败时有精确诊断」这句退出条件有证据了。'
      : `第 ${ONLY} 条坏法报出了能定位到具体条目的诊断`
        + `（**只跑了这一条，不代表其余 ${MUTATIONS.length - 1} 条**）。`
    : '有坏法没有被精确诊断拦下。',
);
console.log(`（本次实际判定 ${ranCount} 条）`);
console.log();
process.exit(allGood ? 0 : 1);
