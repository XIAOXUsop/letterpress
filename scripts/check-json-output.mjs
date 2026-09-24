#!/usr/bin/env node
/**
 * `--json` 模式契约：**成功与失败都必须给出可解析的 JSON，且在 stdout。**
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 路线图阶段 4 第 3 项的「JSON 输出」此前只做了一半：
 * `wiki-ask --json` **成功时**有结构化输出，**失败时 stdout 完全为空**
 * （2026-09-24 实测：退出码 2、stdout 0 字节、错误只写在 stderr 的人话里）。
 *
 * > 消费方能拿到的只有退出码——它回答「哪一类失败」，
 * > 回答不了「**什么**失败了」与「**能怎么改**」。
 * > 于是要么解析中文句子（脆），要么只能说「命令失败了」。
 *
 * ── 判据为什么是「逐个真跑」而不是读源码 ──────────────────────────
 *
 * 因为要验的东西**只在运行时存在**：
 * stdout 有没有、是不是合法 JSON、字段齐不齐、`error.code` 与退出码一不一致。
 * 这些**没有任何一样能从源码推断出来**——
 * 一个 `if (asJson) console.log(…)` 写对了，不代表错误路径也走到了它。
 *
 * 所以这里对**每个 CLI 的每种失败方式**都真的跑一遍，
 * 断言四件事（见 `assertJsonFailure`）。
 *
 * ⚠️ **人话与 JSON 的分工**：JSON 进 stdout（`JSON.parse` 才不会失败），
 * 人话进 stderr。两者都出——排查问题的人看终端，程序读管道。
 *
 * 用法：`npm run verify:json-output`
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();

/** 退出码 → 语义（与 src/lib/cli/exit-codes.mjs 一致，这里只用于报错文案）。 */
const CODE_MEANING = {
  2: '用法错',
  3: '环境错',
  4: '语料为空',
  5: '查无此项',
  6: '内部不变式被破坏',
};

/**
 * 每个 CLI 的失败场景。
 *
 * `args` 是**足以触发那条失败路径**的参数；`expectCode` 是应有的退出码。
 * ⚠️ 每加一个 CLI 都要在这里登记——**漏了不会被发现**，
 * 因为「只测已登记的那些」永远绿。
 */
const SCENARIOS = [
  {
    cli: 'scripts/wiki-ask.mjs',
    name: '缺少问题参数',
    args: ['--json'],
    expectCode: 2,
  },
  {
    cli: 'scripts/wiki-review.mjs',
    name: 'slug 不存在',
    args: ['--json', '--slug=绝对不存在的条目'],
    expectCode: 5,
  },
  {
    cli: 'scripts/wiki-impact.mjs',
    name: '来源 id 不存在',
    args: ['--json', '--source=绝对不存在的来源'],
    expectCode: 5,
  },
  {
    cli: 'scripts/sync-content.mjs',
    name: '缺少必填参数',
    // ⚠️ 这里**必须带 `--json`**，否则跑的是 text 模式，
    // 而 text 模式下 stdout 为空是**正确行为**——门禁会误报。
    args: ['--json'],
    expectCode: 2,
  },
];

const problems = [];

console.log('--json 模式的输出契约');
console.log('─'.repeat(64));

function run(args) {
  try {
    const stdout = execFileSync('node', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : -1,
      stdout: `${e.stdout ?? ''}`,
      stderr: `${e.stderr ?? ''}`,
    };
  }
}

function assertJsonFailure(scenario) {
  const r = run([join(ROOT, scenario.cli), ...scenario.args]);
  const where = `${scenario.cli} —— ${scenario.name}`;
  const fail = (msg) => problems.push(`${where}\n    ${msg}`);

  /*
   * ⚠️ **这里不能提前 `return`。**
   *
   * 第一版在「退出码不符」时就 return，于是下面那条
   * 「`error.code` 与退出码不一致」的判据**结构上永远够不到**——
   * 而负向验证第三次才把它查出来（改 `failWithJson` 让退出码分叉，
   * 门禁只报「退出码不对」，从没走到那条）。
   *
   * > **一条永远走不到的判据，和没有这条判据是一样的**——
   * > 区别只在于前者看起来像是覆盖了。
   *
   * 改成**不提前返回**，让同一个场景里所有问题一次报全。
   * 下面对 stdout 的检查各自 return，因为它们依赖前一步的结果。
   */
  if (r.code !== scenario.expectCode) {
    fail(
      `退出码是 ${r.code}，期望 ${scenario.expectCode}（${CODE_MEANING[scenario.expectCode] ?? '?'}）。\n` +
        `      stderr：${r.stderr.split('\n')[0] ?? '（空）'}`,
    );
    // 继续往下查——JSON 本身可能还有别的问题，一次报全比来回跑三遍有用
  }

  if (r.stdout.trim() === '') {
    fail(
      `stdout **完全为空**。\n` +
        `      这就是本检查针对的那个缺口：JSON 模式下失败时消费方什么结构化信息都拿不到。\n` +
        `      stderr：${r.stderr.split('\n').find((l) => l.trim()) ?? '（也空）'}`,
    );
    return;
  }

  let payload;
  try {
    payload = JSON.parse(r.stdout);
  } catch (e) {
    fail(
      `stdout 不是合法 JSON：${e instanceof Error ? e.message : String(e)}\n` +
        `      前 80 字：${JSON.stringify(r.stdout.slice(0, 80))}`,
    );
    return;
  }

  if (payload.ok !== false) {
    fail(`JSON 里 ok 不是 false（是 ${JSON.stringify(payload.ok)}）——失败却没说自己是失败`);
  }
  if (typeof payload.error?.code !== 'number') {
    fail(`JSON 里没有 error.code（实际：${JSON.stringify(payload.error ?? null)}）`);
  } else if (payload.error.code !== r.code) {
    // ⚠️ **这条必须与「退出码不等于期望值」分开说**——
    // 前者是「退出码选错了」，后者是「**JSON 与退出码互相矛盾**」。
    // 消费方按 `error.code` 分支、CI 按退出码判断，
    // 两者不一致时它拿到的是两个互相打架的事实。
    fail(
      `error.code 是 ${payload.error.code}，而进程退出码是 ${r.code}——**两边会打架**。\n` +
        `      消费方按 error.code 分支、外层按退出码判断，两者会给出矛盾的结论。`,
    );
  }
  if (typeof payload.error?.message !== 'string' || payload.error.message === '') {
    fail(`JSON 里没有可读的 error.message`);
  }

  if (!r.stderr.trim()) {
    fail(
      `stderr 是空的。\n` +
        `      人话与 JSON 都要出：程序读 stdout，正在排查的人看 stderr。`,
    );
  }
}

for (const s of SCENARIOS) {
  const before = problems.length;
  assertJsonFailure(s);
  // ⚠️ 判据是**本条自己有没有新增问题**，不是全局计数。
  // 第一版写 `problems.length === 0`——那样只要第一条有问题，
  // 后面每条都显示「·」，看起来像「全都没问题」。
  console.log(`  ${problems.length === before ? '✓' : '✗'} ${s.cli} —— ${s.name}`);
}

// ── 顺带确认成功时形状固定 ──────────────────────────────────────────
console.log('');
console.log('成功时的形状');
console.log('─'.repeat(64));

const ask = run([join(ROOT, 'scripts/wiki-ask.mjs'), '--json', '为什么行宽用 em 不用 ch']);
if (ask.code !== 0) {
  problems.push(`wiki:ask --json 的成功路径退出码是 ${ask.code}，期望 0\n    ${ask.stderr.split('\n')[0] ?? ''}`);
} else {
  let payload = null;
  try {
    payload = JSON.parse(ask.stdout);
  } catch (e) {
    problems.push(`wiki:ask --json 成功时 stdout 不是合法 JSON：${e instanceof Error ? e.message : e}`);
  }
  if (payload && payload.ok !== true) {
    problems.push(
      `wiki:ask --json 成功时 ok 不是 true。\n` +
        `    形状必须固定（成功与失败都带 ok），消费方才能写「先解析、再看 ok」。`,
    );
  } else if (payload) {
    console.log(`  ✓ wiki-ask --json 成功时 ok=true，字段：${Object.keys(payload).join('、')}`);
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处不符合契约。\n`);
  process.exit(1);
}
console.log(`\n${SCENARIOS.length} 个失败场景 + 1 个成功场景，全部符合契约。\n`);
