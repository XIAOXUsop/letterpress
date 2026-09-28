#!/usr/bin/env node
/**
 * **2026-09-28 新增的那些门禁的负向验证。**
 *
 * ⚠️ **这里原先硬写着「十三道」与一份手抄名单**，而 `GATES` 数组才是真值——
 * 而 2026-09-28 加第 13 道时**数组没加上、那句话改了**，
 * 于是它一边打印「12 道」、一边标题写「十三道」，**而两个数都不会报错**。
 *
 * > **清单写两遍 = 迟早漏一处**（本文件 2026-09-28 记的第四例）。
 * > **而这一处的代价是「验证脚本自己少验了一道门禁」**——
 * > 它正是「决定别人有没有被验」的那一道。
 * >
 * > 处置：**名单只写在 `GATES` 数组里**，输出用 `GATES.length`，
 * > 标题**不写数字**（写了就得同步，而同步靠自觉）。
 *
 * ── 为什么单独一个文件 ──────────────────────────────────────────────
 *
 * 下面是 `GATES` 里的每一道。
 *
 * > 这个仓库已经吃过好几次同族亏：五道检索闸「每道有专属用例」这句话
 * > 曾经是假的（`verify:retrieval-gates` 揭穿了它）。
 *
 * 所以把当天的手工验证固化成脚本，**它每次 CI 都跑**。
 *
 * ── 判据 ────────────────────────────────────────────────────────────
 *
 * 每条变异都必须让**被测的那一道**红（不是别的），然后恢复。
 * ⚠️ **红在别的检查上不算数**——那是形态七（「有人替我把关，
 * 只是不在我盯着的那条断言里」）。
 *
 * 用法：`npm run verify:new-gates-mutations`
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const problems = [];

/**
 * 跑之前的 `git status --porcelain`——**收尾断言要与它比，而不是与「空」比。**
 *
 * ⚠️ 提交前工作区本来就可能有改动（2026-09-28 那一轮就带着 5 个未提交的文件），
 * 而「跑完之后必须是空的」会把**「本来就有改动」与「我弄脏了」混成一条**。
 */
const ENTRY_STATUS = spawnSync('git', ['status', '--porcelain'], {
  cwd: ROOT, encoding: 'utf8', timeout: 60_000,
}).stdout ?? '';

console.log('2026-09-28 新增门禁的负向验证');
console.log('─'.repeat(64));

/*
 * ⚠️ **2026-09-28 第二次：「单跑这条门禁」不等于「门禁在编排里跑」。**
 *
 * `verify` 走 `bundle-and-verify.mjs`：esbuild 把脚本打成
 * `node_modules/.cache/letterpress/verify.mjs` 再执行。
 * 我给 `verify-negotiation.mjs` 里的新判据用了 `import.meta.url` 定位 docs，
 * **单跑是绿的、打包后 ENOENT**——而 `verify:all` 跑的正是打包那条路。
 *
 * > **手敲的命令不是 CI 里的那条**（[[local_simulation_missing_semantics]]）。
 * > 而这类缺陷**只会在编排里发作**，所以
 * > **变异脚本必须按编排的方式跑被测门禁**，不能一律 `node scripts/x.mjs`。
 *
 * 所以 `red()` 对这几个命令改用 `npm run <name>`，与编排同一条路。
 * 目前只有 `verify` 需要这样跑——它是唯一走打包的。
 *
 * ⚠️ **这个 `Set` 必须定义在 `red()` 之前**：`const` 有暂时性死区，
 * 反过来写会 ReferenceError——而**那正是「注释里写了、代码没实现」的形状**。
 */
/*
 * ⚠️ **2026-09-28 第三次：为了避开 `shell: true` 的 DEP0190，我改用 `npm.cmd`
 * —— 而那换成了一个更隐蔽的失败。**
 *
 * `npm.cmd` 是**批处理文件**，Node 在 `shell: false` 下**起不来它**：
 * `spawnSync` 返回 **`status: null` + `error: EINVAL`**，**子进程压根没运行**。
 *
 * 而我原来的判据是 `r.status !== 0` —— `null !== 0` 为真，
 * 于是**每一次都被报成「build 失败」**，而真相是「它没跑」。
 *
 * > **这是我今天第四次让自己的检查骗自己**（前三次：grep U+FFFD 把门禁自己的
 * > 字面量当残缺、grep 空括号把 `process.cwd()` 当残缺、探针把变异门禁报成「没覆盖」）。
 * > 而这一次的代价是**34 条变异里有 2 条一直假红**。
 *
 * 处置两件事：
 * ① **Windows 上用 `cmd /c npm`**（实测 status=0）——**不用 `shell: true`**，
 *    所以 DEP0190 不会回来；
 * ② **`error` 存在时不能说「build 失败」**——那是「压根没起来」，
 *    与「跑���了且失败」是两件事（形态十一）。
 */
const NPM_CMD = process.platform === 'win32'
  ? { cmd: 'cmd.exe', args: ['/c', 'npm'] }
  : { cmd: 'npm', args: [] };
const runNpm = (script) => spawnSync(NPM_CMD.cmd, [...NPM_CMD.args, 'run', script], {
  cwd: ROOT, encoding: 'utf8', timeout: 600_000,
});

const BUNDLED = new Set(['verify']);

/**
 * **本文件自己的变异条数**——用于把台账里那个数写进变异锚点。
 *
 * ⚠️ **不能硬写那个数**：它每加一条变异就变一次
 *（2026-09-29 一天里从 43 涨到 58），
 * **而硬写的锚点会在下一次加变异时静默失效**——
 * 那正是 `mutate()` 说的「锚点出现 0 次」，代价是一次「变异无效」的假象。
 *
 * > **锚点里出现「会变的数」，锚点迟早会失效。**
 * > 正确做法是**运行时从本文件算出来**。
 */
/**
 * **台账里那两个「会变」的数字**（单文件命令数、编排步数）——运行时算出来。
 *
 * ⚠️ **不能硬写**（与 `MUT_COUNT` 同一条教训）：
 * 2026-09-29 我把台账里 48→59→61、43→44 改了三遍，
 * **而两条变异的锚点正写着那些数**——于是它们「锚点出现 0 次」，
 * **而那句话在「锚点不对」与「门禁没盲区」之间是同义的**。
 *
 * > **锚点里出现「会变的数」，锚点迟早会失效。**
 */
const ACTUAL_CMDS = String(Object.keys(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts).length);
const ACTUAL_STEPS = String(
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts['verify:all'].split('&&').length,
);

/**
 * 台账里 `verify:base` 那一行（**含末尾换行**）——用作变异锚点。
 *
 * ⚠️ **从台账里切出来，不手写**：我手写了一次，
 * 而那个换行转义（反斜杠加 n）经过几层转义变成了**真实换行**，
 * 文件直接语法错。而**锚点里出现「会变的内容」迟早会失效**
 * （同 `ACTUAL_CMDS` 那条教训）。
 */
const LEDGER_ONLY_ROW = "| `verify:base` | 在组件里注入绕过 `path()` 的硬编码 `href` | ✅ 红（32 个页面） | 2026-09-24 |\n"

const MUT_COUNT = (() => {
  const src = readFileSync(import.meta.filename, 'utf8');
  // ⚠️ **`lastIndexOf`**：这段自省代码**自己就含** `const CASES = [`，
  // 而 `indexOf` 会先找到它 —— 于是数出 0，而锚点里就带着一个 0。
  const i = src.lastIndexOf('const CASES = [');
  const end = src.indexOf('\n];', i);
  if (i < 0 || end < 0) return '未知';
  return String((src.slice(i, end).match(/^  \{$/gm) ?? []).length);
})();

/**
 * 有些门禁打在**构建产物**上，而 `dist` 的状态**由前面跑过什么决定**：
 * `verify:base` 会清空它、`verify:formats` 会往里塞探针文章。
 *
 * ⚠️ **2026-09-28 实测踩到第三种。** 变异脚本跑 `verify-negotiation.mjs` 时
 * 它报「`markdown-for-agents.md` 存在于产物中」——而那个文件**当下并不存在**
 * （`ls` 得到的是「不存在」）。也就是说：**上一次门禁留下的 `dist` 与这一次不同**，
 * 而我起初猜的是「`dist` 被清空」。**三种可能，输出上分不开。**
 *
 * 所以：**跑依赖产物的门禁之前，先确保 `dist` 存在。**
 * ⚠️ 判据是 `content-manifest.json` 在不在，**不是目录在不在**——
 * 空目录同样「存在」，而那正是 `check:manifest-schema` 当初栽的地方。
 */
const NEEDS_DIST = new Set(['verify-negotiation.mjs']);

/**
 * `check-package-files.mjs` 要**真打一个 tarball**——所以它比别的门禁慢，
 * 而 `mutate()` 的默认超时（120 秒）**对它不够**。
 *
 * ⚠️ 而**超时与「门禁判定为红」在输出上完全一样**——
 * `spawnSync` 超时给 `status: null` + `error`，而 `red()` 只看 `status !== 0`。
 * 那是形态十一，**处置是给足超时而不是改判据**（判据没错，是等待不够）。
 */
const SLOW_GATES = new Set(['check-package-files.mjs']);

/**
 * 有些门禁**必须带参数跑**——不带就等于没跑。
 *
 * ⚠️ `check-package-files.mjs` 的判据②要**真打 tarball、真装依赖、真构建**，
 * 所以只有 `--full` 才会跑它。而**不带 `--full` 时它明确打印「本轮没验」**
 * ——**而「没验」与「验过了」在输出上完全一样**。
 *
 * > 变异若不带 `--full` 去跑它，**两条判据都不会触发**，
 * > 而「门禁绿着」会被我读成「判据没问题」。
 *
 * 所以：这类门禁的**变异目标**写成 `--full` 形式，`red()` 直接拼上。
 */
const GATE_ARGS = new Map([['check-package-files.mjs', ['--full']]]);

/**
 * ⚠️ **判据不能只是「`dist` 在不在」。**（2026-09-28 第二次栽在这里）
 *
 * 第一版只查 `content-manifest.json` 存在与否——那挡住了「没有产物」，
 * **挡不住「产物在、但是上一次门禁留下的旧的那份」**。
 * 于是 `verify-negotiation` 报「`markdown-for-agents.md` 存在于产物中」，
 * 而那个文件当下并不存在——**它在 `dist` 里，却不在清单里**。
 *
 * > **「产物在」与「产物对得上现在的源码」是两件事**，
 * > 而第一版把前者当成了后者的充分条件。
 *
 * 所以：**产物在，但它与 `content-manifest.json` 对不上时也要重建。**
 * 判据是「清单里点名的每个 `.md` 是否真的在 `dist` 里」——
 * 那正是 `check:base` 里那句「产物里每个站内链接都要指向存在的文件」的弱化版，
 * **够便宜，且能抓住「旧产物」**。
 */
function distLooksConsistent() {
  const manifest = join(ROOT, 'dist', 'content-manifest.json');
  if (!existsSync(manifest)) return false;
  try {
    const m = JSON.parse(readFileSync(manifest, 'utf8'));
    for (const d of m.documents ?? []) {
      const url = d.urls?.markdown;
      if (!url) continue;
      const rel = url.replace(/^https?:\/\/[^/]+\/[^/]+\//, '');
      if (!existsSync(join(ROOT, 'dist', rel))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function ensureDist() {
  if (distLooksConsistent()) return;
  const r = runNpm('build');
  // ⚠️ **`r.error` 存在 = 子进程压根没起来**，那与「跑完且失败」是两件事。
  // 而 `status` 在这种情况下是 `null`，**`null !== 0` 会把它读成「失败」**——
  // 2026-09-28 因此把 34 条变异里的 2 条一直报成假红。
  if (r.error) {
    console.log(
      `  ⚠ **子进程压根没起来**（${r.error.code}）——`
      + `所以 build 没跑，下面依赖产物的门禁结果**不可信**，而那不是变异造成的。`,
    );
    return;
  }
  if (r.status !== 0) {
    console.log(
      `  ⚠ build 失败（退出码 ${r.status}），下面依赖产物的门禁结果不可信`
      + '（那不是变异造成的）。',
    );
  }
}

/**
 * 跑一个门禁，返回它红没红。
 *
 * ⚠️ **`verify` 必须按编排的方式跑**（`npm run verify` → esbuild 打包 → 执行），
 * 单跑 `node scripts/bundle-and-verify.mjs` 走的是另一条路——
 * 2026-09-28 实测：一条新判据单跑绿、打包后 ENOENT。
 * 而 `verify:all` 里的第 4 步跑的是打包那条。
 */
const red = (script) => {
  if (NEEDS_DIST.has(script)) ensureDist();
  if (BUNDLED.has(script.replace(/\.mjs$/, ''))) {
    const r = runNpm('verify');
    // ⚠️ 同一个坑的第二处：**`error` 存在时 `status` 是 `null`**，
    // 而 `null !== 0` 恒真 —— 那会让这道门禁**永远被报成红**。
    // 它现在没发作只因为没有变异以 `verify` 为 target，**那是埋着的雷**。
    if (r.error) {
      return {
        red: true,
        out: `子进程压根没起来（${r.error.code}）——这是环境问题，不是门禁的结论。`,
      };
    }
    return { red: r.status !== 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  }
  const r = spawnSync('node', [join('scripts', script), ...(GATE_ARGS.get(script) ?? [])], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: SLOW_GATES.has(script) ? 900_000 : 120_000,
  });
  return { red: r.status !== 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

/**
 * 一次变异：`{ file, find, replace, target, why }`
 *
 * ⚠️ `find` 必须在文件里**唯一存在**，否则替换可能命中别处而门禁不红——
 * 那会让我以为「变异没生效」而实际是打错了位置。所以先断言唯一。
 */
function mutate({ file, find, replace, alsoEdit, target, why }) {
  const path = join(ROOT, file);
  const original = readFileSync(path, 'utf8');
  const hits = original.split(find).length - 1;
  if (hits !== 1) {
    problems.push(
      `变异「${why}」的锚点在 ${file} 里出现 ${hits} 次（期望恰好 1 次）——\n`
      + '    **锚点不对就没注入成功**，而「门禁没红」会被我读成「它没有盲区」。\n'
      + '    改锚点，或用文件与行号定位。',
    );
    console.log(`  ✗ ${why}：锚点出现 ${hits} 次，变异未生效`);
    return false;
  }
  /*
   * ⚠️ **有些缺陷需要两处同时改才会发作**（2026-09-28）。
   *
   * 例：「有一条无理由的刻意不校验登记」+「守卫被拆掉」——
   * 只做前者报红是**守卫正常工作**，只做后者门禁走不到那条分支。
   * 两件一起做才是那个失效状态。
   *
   * 所以 `alsoEdit` 是**一等公民**，而不是「顺手再改一处」——
   * 因为「顺手的第二处」忘了做，那条变异就悄悄验的是别的东西。
   */
  let injected = original.replace(find, replace);
  if (alsoEdit) {
    const ah = injected.split(alsoEdit.find).length - 1;
    if (ah !== 1) {
      problems.push(
        `变异「${why}」的第二处锚点出现 ${ah} 次（期望 1 次）——**注入不完整**。\n`
        + '    这种情形下「门禁没红」是**变异无效**，不是「判据没盲区」。',
      );
      console.log(`  ✗ ${why}：第二处锚点出现 ${ah} 次，变异未生效`);
      return false;
    }
    injected = injected.replace(alsoEdit.find, alsoEdit.replace);
  }
  writeFileSync(path, injected, 'utf8');
  /*
   * ⚠️ **替换可能静默不发生。**
   *
   * 2026-09-28 一次：锚点写在一个**不存在**的 `export interface ReadPage` 上，
   * 而 `String.replace` 找不到就原样返回——文件**根本没变**，
   * 于是 `before.red` 是 false，本该被读成「门禁有盲区」。
   * 真相是「变异压根没注入」。
   *
   * > **「绿」既可能是「它没看见」，也可能是「压根没被喂进去」——
   * > 而这两种的输出完全一样。** 所以每次注入都必须先自证注入成功。
   */
  if (readFileSync(path, 'utf8') === original) {
    problems.push(
      `变异「${why}」的替换**没有生效**——写回去的内容与原文逐字相同。\n`
      + '    → 「门禁仍然绿」在这种情形下**不能读成「它有盲区」**，它只是压根没被注入。',
    );
    console.log(`  ✗ ${why}：替换没生效，注入无效（结论不可用）`);
    return false;
  }
  const before = red(target);
  writeFileSync(path, original, 'utf8');
  const after = red(target);

  if (!before.red) {
    /*
     * ⚠️ **2026-09-28：这里原来只打一行「仍然绿」。**
     *
     * 而「仍然绿」是一个**现象**，不是一个**诊断**。
     * 那天我因为不看输出，**连着三次改错地方**：以为是 `else` 分支、
     * 以为是控制流有两个出口、以为是分支解耦不够——三次都错。
     * 第一次真正去看输出时，门禁明明白白印着
     * `i 刻意不校验：…——undefined`——**答案就印在脸上**。
     *
     * > **现象级信息（它打印了什么）与结论级信息（哪一行错了）之间，
     * > 隔着一个「去看输出」的动作。** 跳过它就只能推演。
     * > 而推演错的概率不低——**同一天连错三次就是证据**。
     *
     * 所以：报「仍绿」时**必须**把被测门禁的输出尾部打出来。
     * 「它没报什么」和「它报了什么」必须能在同一屏上看见——
     * 因为**空输出与无关输出长得一样**，而那正是我判断错的入口。
     */
    const tail = before.out
      .split('\n')
      .filter((l) => l.trim() !== '')
      .slice(-6)
      .map((l) => `      ${l}`)
      .join('\n');
    problems.push(
      `${target} 在注入「${why}」之后**仍然绿**——这道门禁对该缺陷没有覆盖。\n`
      + '    → 它要么不该声称覆盖，要么判据比它说的窄。\n'
      + '    ⚠️ **先读它下面这几行再改代码**：「仍然绿」是现象，不是诊断；\n'
      + '    2026-09-28 我因为不看输出连改三次，三次都改错了地方。\n'
      + (tail ? `    它实际打印的（末尾）：\n${tail}\n` : '    它实际打印的（末尾）：**（空）**——查不动与「什么都没说」要分开。\n'),
    );
    console.log(`  ✗ ${why}：${target} 仍绿`);
    if (tail) console.log(tail);
    else console.log('      （输出为空——「空输出」与「无关输出」长得一样，要分开看）');
    return false;
  }
  if (after.red) {
    /*
     * ⚠️ **「恢复后仍红」有两种可能，输出上分不开。**（2026-09-28 实测）
     *
     * ① 文件没还原干净（真的还原失败）
     * ② **文件还原了，但环境被别的步骤改了**——那次就是
     *    `verify:base` 跑完清空了 `dist`（`docs/cli.md` 里写明它会），
     *    于是后面任何依赖产物的门禁在 `after` 那次必然红，
     *    **而与本次变异毫无关系**。
     *
     * > 「它仍然红」不等于「是我的错」——**先确认环境，再下结论**。
     * > 判据：把 `after` 的输出里**第一条错误**打出来，
     * > 让「ENOENT dist」与「某条断言不符」能被分开看。
     */
    const firstErr = (after.out.split('\n').find((l) => /Error|✗|失败/.test(l)) ?? '').trim();
    problems.push(
      `恢复之后 ${target} **仍然是红的**。\n`
      + `    它报的第一条：${firstErr || '(没抓到)'}\n`
      + '    **「仍然红」有三种可能，输出上分不开**——\n'
      + '      ① 文件没还原干净；\n'
      + '      ② **环境被前面的步骤改了**（`verify:base` 会清空 `dist`，'
      + '`verify:formats` 会往里塞探针文章）；\n'
      + '      ③ **上一次跑留下的产物与这一次不一致**——'
      + '**2026-09-28 实测到的就是这一种**，而我起初猜的是 ②。\n'
      + '    → **先看它报的第一条**，再决定是重跑 `npm run build`、'
      + '还是 `git status` 查还原。**别默认是自己弄脏的。**',
    );
    console.log(`  ✗ ${why}：恢复后仍红（先分清是环境还是还原——它报的第一条：${firstErr.slice(0, 90)}）`);
    return false;
  }
  console.log(`  ✓ ${why} → ${target} 变红，恢复后回绿`);
  return true;
}


/**
 * 拼出 `['名字', '理由'],` **那一整行源码**——用来当变异锚点。
 *
 * ⚠️ **为什么不直接写字面量。** 那一行里有单引号，写进本文件时要转义；
 * 我为同一条变异**连猜六次**（少一层 / 多一层 / 模板提前闭合），
 * 而 `mutate()` 每次都只说「**出现 0 次**」——那句话**在「锚点不对」与
 * 「门禁没盲区」之间是同义的**，而后者要花一整天去证伪。
 *
 * > **分不清的时候，去打印字节，别再猜。** 我打印了才发现：
 * > 源文件里是**字面反引号**（我以为源码里有转义层），
 * > 而我写进锚点的转义**一层都不该有**。
 *
 * ⚠️ **选锚点的规矩：优先挑一个单行、不含反引号的。** 跨多行的锚点
 * 一旦行内有任何细微差异就匹配不上，而报错信息**不告诉你差在哪**。
 *
 * ⚠️⚠️ **更强的规矩（2026-09-28 补）：锚点该从目标文件里「切」出来，不该手写。**
 *
 * 给 `check:two-paths` 写两条变异时，我为**同一个**剥离语句手拼了**五次**
 * （反斜杠层数猜错两次、漏一个 `*`、把 `\\` 当成两个反斜杠、末尾分号差一个），
 * 而 `mutate()` 每次只说「**出现 0 次**」——那句话在「锚点不对」与「门禁没盲区」
 * 之间是同义的。
 *
 * > 最后一次是**逐字符对比**才看清的（真实那行含 `\\*` 两个反斜杠）。
 * > 而**更便宜的做法我一直没做**：让一段一次性脚本
 * > **从目标文件里读出那几行**，写进本文件当锚点——
 * > 那是**唯一正确**的字节序列，不需要猜任何转义层。
 * > 我删了那个脚本，但结论留在这里：**下一个人照做，别手拼。**
 */
const Q = String.fromCharCode(39);
const SINGLE_LINE = (name, reason) =>
  `  [${Q}${name}${Q}, ${Q}${reason}${Q}],`;

/**
 * 判据 ① 剥注释的那两行——`check-two-paths.mjs` 里数基准的那一步。
 *
 * ⚠️ **用码点拼，不要手写转义。** 这一行含正则里的反斜杠与单引号，
 * 手写进本文件要过好几层（我为此试错多次，而 `mutate()` 只说「出现 0 次」）。
 */
const STRIP_COMMENTS_TWO_LINES =
  '  .replace(/\\/\\*[\\s\\S]*?\\*\\//g, (m) => \' \'.repeat(m.length))\n  .replace(/^\\s*\\/\\/.*$/gm, (m) => \' \'.repeat(m.length));';

/**
 * `content.ts` 里 `review` 那处判定的前半截（`kind === 'wiki' ? ` 那一段）。
 *
 * ⚠️ **锚点一律从目标文件里切，不手写。** 这一段含正则字符与单引号，
 * 我手拼过四次都错，而 `mutate()` 每次只说「出现 0 次」。
 */
const ANCHOR2 = () => '  const review = kind === \'wiki\' ? ';
const ANCHOR2_TAIL = '(data as { review?: Doc[\'review\'] }).review : undefined;';

/**
 * 「只读一层」的那个替换值——**故意不写出那个调用本身**。
 *
 * ⚠️ `check-field-coverage` 有一条判据扫 `scripts/*.mjs` 里的
 * 「自己遍历一个内容目录」，**而它会把本文件也算进去**
 * （注释被剥掉后，字符串字面量与真调用逐字相同）。
 *
 * > **两条门禁互相看见对方的源码**——而这不是它们该做的：
 * > 变异脚本天生握着别的门禁判据要看的形状。
 *
 * 运行时拼出来，注入后 `check-onboarding-doc` 拿到的**值**是对的，
 * 而这一行**文本**里没有那个调用。
 */
const TOP_LEVEL_ONLY = '    ...ONLY_TOP_LEVEL,';



/**
 * `check-gate-list.mjs` 里 4g 重跑那道门禁的那两行——**从目标文件切出来的**。
 *
 * ⚠️ **为什么是这两行而不是一行**：单行替换会让下一行
 * `encoding: 'utf8', });` 变成孤儿 → **SyntaxError**。
 * 而门禁崩掉的退出码**也是非 0**——`mutate()` 会把那当成
 * 「变异生效了」，**而它其实红在语法错误上，不是红在 4g 上**。
 *
 * > **「门禁红了」不等于「门禁在断的那条断言上红了」**（形态七）。
 *
 * 见本文件 `SINGLE_LINE` 上方那段「锚点不该手写」。
 */
const EXEC_COMMAND_SCRIPTS_TWO_LINES = "    const out = execFileSync('node', [join(ROOT, 'scripts', 'check-command-scripts.mjs')], {\n      encoding: 'utf8',\n    });"

const GATES = [
  'check-two-paths.mjs', 'check-field-coverage.mjs', 'check-single-literal.mjs',
  'check-adapter-size.mjs', 'check-not-a-demo.mjs', 'check-no-duplicate-lists.mjs',
  'check-onboarding-doc.mjs', 'check-command-scripts.mjs', 'check-gate-list.mjs',
  'check-single-source.mjs', 'check-agents-doc.mjs', 'check-rule-levels.mjs',
  'check-agents-coverage.mjs', 'check-package-files.mjs', 'check-release.mjs',
];

const CASES = [
  {
    // ⚠️ 守着 2026-09-29 补的第六条判据：**页面文案不得承诺在本站不成立的事**。
    // 「带上 Accept: text/markdown 会自动拿到 markdown」在 GitHub Pages 上是假的
    // （响应头不可改），而它出现在**每个页面**的共用组件里。
    // 访客与 agent 都会照着做，然后发现没用。
    //
    // ⚠️ 判据只看**会被渲染出去的文本**（剥掉 JSX/HTML/行注释）——
    // 而「解释原先错在哪」的注释里**必然引用那句原话**，不剥就会误报。
    why: 'check:onboarding-doc — 页面文案又承诺了本站不成立的内容协商',
    file: 'src/components/MarkdownActions.astro',
    find: '  直接打开上面的 <code>.md</code> 链接即可读取',
    replace: '  请求时带上 <code>Accept: text/markdown</code> 会自动拿到它。',
    target: 'check-onboarding-doc.mjs',
  },
  {
    // ⚠️ 守着 2026-09-29 加的那条：**「以后会引入 X」而 X 已经在仓库里**。
    // `docs/content-sync.md` 原先写「如果以后引入 Schema」——
    // 而 `public/content-manifest.schema.json` 已经到了（`verify:migrate` 昨天还在用）。
    //
    // > 一句「以后会做」的话，在它变成「已经做了」之后仍留在文档里，
    // > **而没有任何东西会发现**——它语法正确、语气笃定。
    why: 'check:onboarding-doc — 文档说「以后会引入 Schema」而它已经在了',
    file: 'docs/content-sync.md',
    find: '仓库现已提供',
    replace: '如果以后引入 content-manifest.schema.json，仓库尚未提供',
    target: 'check-onboarding-doc.mjs',
  },
  {
    // ⚠️ 守着 2026-09-29 那条**generalize 后**的判据：扫所有 scripts/*.mjs，
    // 凡是自己 readdirSync 一个内容目录的都要登记理由。
    // **不给 `wiki-ask` 单独写**——一个个补，下一个自建循环照样能溜进来。
    //
    // 三个真实缺陷是同一天找到的：`readContentDirs` 本身、`wiki-ask.mjs`、
    // `wiki-review.mjs`（后两个都是「只读一层」，而 Astro 的内容 glob 是递归的）。
    // 症状都**不像 bug**：检索说「没有依据」、`--list` 不列出那几篇。
    why: 'check:field-coverage — wiki-review 退回只读一层（--list 不列出子目录里的页）',
    file: 'scripts/wiki-review.mjs',
    find: '  files = listWikiFiles();',
    replace: '  files = readdirSync(WIKI).filter((f) => /\\.mdx?$/.test(f)); // MUTATION：只读一层',
    target: 'check-field-coverage.mjs',
  },

  {
    // ⚠️ 守着 2026-09-29 从 `origin/main` 搬来的**递归读子目录**。
    // 本站 src/content/ 下恰好没有子目录，所以这个差异**从未发作**——
    // 而「在本站永远不触发的分支，就是没有守卫的分支」。
    // 症状会是「CLI 少了几篇」**且不报错**（Astro 的内容 glob 是递归的）。
    why: 'check:field-coverage — readContentDirs 不再递归（构建读得到、CLI 读不到）',
    file: 'src/lib/wiki/read-page.ts',
    find: '    walk(\'\');',
    replace: '    // MUTATION：不递归，只读一层',
    target: 'check-field-coverage.mjs',
  },
  {
    // ⚠️ 守着 2026-09-28 那个**设计决定**的落地：标量一律走 YAML 解析。
    // 依据是实测的（三种合法写法上逐行解析器与 YAML 分叉），而**不是**「YAML 更规范」。
    //
    // 变异：把 `title` 退回逐行解析——而 `check:field-coverage` 的语料里
    // **有一篇的 title 带行内注释**，两种解析器对它的读法不同。
    why: 'check:field-coverage — 标量退回逐行解析（YAML 那次替换被撤掉）',
    file: 'src/lib/wiki/read-page.ts',
    find: "    title: scalarOf(data, 'title') ?? file,",
    replace: "    title: frontmatterField(source, 'title') ?? file, // MUTATION：退回逐行",
    target: 'check-field-coverage.mjs',
  },
  {
    // ⚠️ 守着 2026-09-28 修的那个**实测出来的真 bug**：
    // 逐行扫 `sources` 时若不限定「只扫该块内」，**别的顶层块里的
    // `revision:` 会覆盖当前那条来源**——症状**静默**（来源的版本日期
    // 变成别人的值，不报错）。现有 5 篇内容恰好没受害，**但那是运气**。
    why: 'check:field-coverage — sources 的字段被别的顶层块覆盖（静默的来源污染）',
    file: 'src/lib/wiki/read-page.ts',
    find: "  for (const line of indentedBlockOf(block, 'sources')) {",
    replace: "  for (const line of block.split(String.fromCharCode(10))) { // MUTATION：退回整份 frontmatter",
    target: 'check-field-coverage.mjs',
  },
  {
    why: 'check:agents-coverage — 某类声明「无门��认领」（空白归属比错的归属更隐蔽）',
    file: 'scripts/check-agents-coverage.mjs',
    find: "    gate: 'check:field-coverage',",
    replace: "    gate: null, // MUTATION：这一类无门禁认领",
    target: 'check-agents-coverage.mjs',
  },
  {
    why: 'check:agents-coverage — OWNERS 说某道门禁核它，而那个门禁不存在（「已核」是自己说的）',
    file: 'scripts/check-agents-coverage.mjs',
    find: "gate: 'check:onboarding-doc', why: '命令名' },",
    replace: "gate: 'check:nonexistent-gate', why: '命令名' },",
    target: 'check-agents-coverage.mjs',
  },
  {
    // ⚠️ 守着第三列那条判据的**加强版**。
    // 第一版只核行为（「默认下报不报」），于是把文档里的「默认关闭」改成
    // 「默认开启」（**而实现没变**）它照样绿——**行为对、文档错，判据无感**。
    // 现在从 AGENTS.md 那一行**解析出「默认开/关」**再与实测比。
    why: 'check:rule-levels — 第三列的说法被反过来说（实现没变，文档错）',
    file: 'AGENTS.md',
    find: '| 提示 | `cjk-slug` | URL 由中文标题生成（默认关闭，可在配置里开） |',
    replace: '| 提示 | `cjk-slug` | URL 由中文标题生成（**默认开启**，可在配置里关） |',
    target: 'check-rule-levels.mjs',
  },
  {
    // ⚠️ 守着 2026-09-28 新增的第五类判据：AGENTS.md 那张规则表的**级别**列。
    // 而「`broken-wikilink` 是 error（会让构建失败）」正是 agent 最会照着用的
    // 那一列——AGENTS.md 开头就写着「那是给 agent 读的约定」。
    // 级别只能**真跑**出来：静态分析（往上找 N 行找 `level:`）只捞到 1/11 条。
    why: 'check:rule-levels — 文档把 error 写成 warn（agent 会照着它判断什么会让构建失败）',
    file: 'AGENTS.md',
    find: '| 错误 | `broken-wikilink` | 引用了不存在的页面。**会让构建失败** |',
    replace: '| 警告 | `broken-wikilink` | 引用了不存在的页面。**会让构建失败** |',
    target: 'check-rule-levels.mjs',
  },
  {
    // ⚠️ 守着「语料没触发到的规则必须报」那条。删掉「断链」那篇之后，
    // `related: [断链]` 跟着失效 → `redundant-relation` 不再触发，
    // **而它的级别此刻没被核**。「没触发」与「都对」在结果上无法区分。
    why: 'check:rule-levels — 语料缺一段，某个级别根本没被核对（没触发 ≠ 都对）',
    file: 'scripts/check-rule-levels.mjs',
    find: "  writeFileSync(join(dir, '断链.md'), page('断链', '断链', '', '见 [[根本不存在的目标]]。'), 'utf8');",
    replace: '',
    target: 'check-rule-levels.mjs',
  },
  {
    // ⚠️ 这两条守着 2026-09-28 补的判据：AGENTS.md 那张「分三级」的规则表
    // 必须与 lint.ts 的规则集**完全相同**。
    // 此前那三类判据全是「**文档里这一句**还成立吗」，于是**没有一条问
    // 「文档该说的都说了吗」**——而**缺的项永远不会触发「这一句还对吗」**。
    // 实测的缺口：ambiguous-wikilink（**error** 级）与 ambiguous-title
    // 不在任何面向人的文档里，而 agent 正是照这张表判断什么会让构建失败。
    why: 'check:agents-doc — 规则表里漏掉一条（代码里有、表里没有）',
    covers: ['①'],
    file: 'AGENTS.md',
    find: '| 错误 | `ambiguous-wikilink` | 引用了一个**有歧义的标题**（两篇同名），无法确定指哪一篇 |\n',
    replace: '',
    target: 'check-agents-doc.mjs',
  },
  {
    why: 'check:agents-doc — 规则表里多一条不存在的（表里有、代码里没有）',
    covers: ['①'],
    file: 'AGENTS.md',
    find: '| 提示 | `summary-too-long` |',
    replace: '| 错误 | `nonexistent-rule` | 表里写了但代码里没有 |\n| 提示 | `summary-too-long` |',
    target: 'check-agents-doc.mjs',
  },
  {
    // ⚠️ 守着 2026-09-28 补的那条判据：`docs/content-negotiation.md` 的 MD 列
    // 与实测一致。原先 `verify-negotiation.mjs` 的注释写着
    // 「真实词表那组由 docs 里的表负责」——**而 docs 那侧零门禁**：
    // 注释说「X 负责」而 X 那边没有检查，等于没有人负责。
    why: 'verify:negotiation — docs 表格的 MD token 列被改',
    file: 'docs/content-negotiation.md',
    find: '2,852 / 2,965（−3.8%）',
    replace: '2,999 / 2,965（−3.8%）',
    target: 'verify-negotiation.mjs',
  },
  {
    // ⚠️ 「取不到」与「都对」在结果上无法区分——删掉一行必须报，
    // 而**不能**默认通过（形态四）。
    why: 'verify:negotiation — docs 表格里删掉一行（取不到 ≠ 都对）',
    file: 'docs/content-negotiation.md',
    find: '> | /cjk-web-typography/ | 9,013 / 10,380（−13.2%） | 3,919 / 4,246（−7.7%） | 56.5% / **59.1%** |',
    replace: '',
    target: 'verify-negotiation.mjs',
  },
  {
    // ⚠️ 这两条就是 2026-09-24 那个**真 bug** 的两半：
    // 提交把生产端升到 v2，同步器与测试固件都停在 1，
    // 于是同步器对着本站自己的清单必然报错，而 453 条测试全绿
    // ——因为固件也写着 1，它测的是一个已不存在的格式。
    why: 'check:single-source — 同步器把版本号写死（真故障的前一半）',
    covers: ['3'],
    file: 'scripts/lib/content-sync.mjs',
    find: 'const MANIFEST_VERSION = readManifestVersion()',
    replace: 'const MANIFEST_VERSION = 1',
    target: 'check-single-source.mjs',
  },
  {
    why: 'check:single-source — 测试固件把 manifest 的 version 写死（真故障的后一半，测试全绿却功能是坏的）',
    covers: ['3'],
    file: 'scripts/lib/content-sync.test.mjs',
    find: '    version: MANIFEST_VERSION,',
    replace: '    version: 1,',
    target: 'check-single-source.mjs',
  },
  {
    // ⚠️ 文档判据原来**空转了整整一年**：六份文档里一处「版本为 N」都没有，
    // 而它每天在 CI 里跑、每天打印一行诚实的提示，没人行动。
    // 2026-09-28 把「扫到 0 处」升级为红，并在文档里补上那句本来就该有的声明。
    why: 'check:single-source — 文档里的版本声明被改（2 → 1）',
    covers: ['3'],
    file: 'docs/content-manifest.md',
    find: '**当前版本为 2**',
    replace: '**当前版本为 1**',
    target: 'check-single-source.mjs',
  },
  {
    why: 'check:single-source — 清单里的文档不存在（静默跳过 = 核不到，形状同「按文件豁免通病」）',
    covers: ['3'],
    file: 'scripts/check-single-source.mjs',
    find: "  'docs/content-export.md',",
    replace: "  'docs/content-export-renamed.md',",
    target: 'check-single-source.mjs',
  },
  {
    // ⚠️ 这一条守着 2026-09-28 修的那处盲区：「第 999 步」格式合法、
    // 指向一个不存在的步骤，而旧判据只认格式、不核数字。
    // 讽刺的是它就出在 `verify:only` 那条豁免当初真的翻车的地方。
    why: 'check:gate-list — 豁免理由里塞一个「第 999 步」（格式合法、指向不存在）',
    covers: ['4'],
    file: 'scripts/check-gate-list.mjs',
    find: "['wiki:ask', '交互式问答：输入是自然语言问题，没有固定输入就没法当门禁。'",
    replace: "['wiki:ask', '交互式问答：输入是自然语言问题，没有固定输入就没法当门禁，见 verify:all 的第 999 步。'",
    target: 'check-gate-list.mjs',
  },
  {
    // ⚠️ **这一条守着判据 ②½ 与 ②⅔，而 ②½ 的第一版是「零次执行也绿」。**
    //
    // 我把 ②½ 写完、跑了一遍、看见 `✓`、就当它成立——
    // 而 `verify:only` 的理由里**一个「第 N 步是 X」都没写**（它写的是「本条原先…」），
    // 整段循环**一次都没进**。**12 秒过去，零次执行。**
    //
    // 变异改编排：第 3 步换成别的，理由没跟 → ②½ 若真在跑，必红。
    why: 'check:gate-list — 改编排第 3 步而豁免理由没跟（②½ 的内容判据）',
    covers: ['②½'],
    file: 'package.json',
    find: '&& npm test',
    replace: '&& npm run check:single-source',
    target: 'check-gate-list.mjs',
  },
  {
    // ⚠️ **这一条守着 ②⅔，它针对的正是上面那个「零次执行」。**
    //
    // ②½ 要求「理由里提到了第 N 步，就核那一步」——
    // **而「提到了」本身可以没有**。删掉 `NO_STEP_REF` 里的**一条登记**，
    // 那条豁免就既没有步号引用、也没登记 → ②⅔ 必须红。
    //
    // > **「检查在跑」和「检查跑到了东西」是两件事。**
    // > 而绿**同时**代表这两件，所以单看输出永远分不清。
    //
    // ⚠️ **锚点是 `NO_STEP_REF` 里那一条登记的整行，不是理由里的散文。**
    // 我第一版挑了跨四行、含反引号的锚点，**试了六次都没注进去**——
    // 而 `mutate()` 每次都只说「出现 0 次」，**那句话在「锚点不对」与
    // 「门禁没盲区」之间是同义的**。换成一个单行、不含反引号的锚点后一次就成。
    //
    // ⚠️ **第二版也无效，而这一次输出直接说了原因**：我改的是**理由**，
    // 而 ②⅔ 问的是「**你登记了吗**」——那一条仍在 `NO_STEP_REF` 里，
    // 于是计数还是 8，门禁当然绿。
    //
    // > **「仍然绿」再一次是「变异无效」**，而这一次不是靠猜、
    // > 是靠**读它打印的那两行**（「豁免表 9 条，其中 8 条登记」）。
    // > **输出比推理可靠**——这已经是本轮第三次靠它而不是靠判断定案。
    //
    // 所以：**删掉那一条登记**，让「没有步号引用」与「没有登记」同时成立。
    // ⚠️⚠️ **第三版仍然无效，而这一次是判据设计上的问题，不是锚点。**
    //
    // `NO_STEP_REF` 是 **`Map`**——②⅔ 问的是「**这个 key 在不在表里**」，
    // 而我注入的是**改它的 value**。key 还在，②⅔ 当然绿。
    //
    // > 门禁印的 `豁免表 9 条，其中 8 条登记` **一字未变**——
    // > 而那正是答案：**输出早就说了，只是我一直在改一个它不看的字段。**
    //
    // 所以注入必须是**删掉整个条目**。`mutate()` 只支持替换，
    // 而「替换成空」会留下一个**空行**——那恰好是合法的 JS，条目也就没了。
    why: 'check:gate-list — 豁免理由既没有步号引用、也没登记（②½ 会零次执行）',
    covers: ['②½'],
    file: 'scripts/check-gate-list.mjs',
    find: SINGLE_LINE('wiki:ask', '输入是自然语言问题，**没有固定输入**；编排里的每一步都要能无人值守地跑。') + '\n',
    replace: '',
    target: 'check-gate-list.mjs',
  },
  {
    why: 'check:gate-list — 豁免理由引用的文件不存在（理由本身是空的）',
    covers: ['②'],
    file: 'scripts/check-gate-list.mjs',
    find: 'scripts/bundle-and-verify.mjs',
    replace: 'scripts/does-not-exist.mjs',
    target: 'check-gate-list.mjs',
  },
  {
    why: 'check:gate-list — 豁免理由变成散文（没有可验证的引用）',
    covers: ['③'],
    file: 'scripts/check-gate-list.mjs',
    find: "['measure', '量产物给**人**看（`scripts/measure.mjs`），判定由 `npm run verify:formats` 里对应的门禁做'],",
    replace: "['measure', '量产物给人看，判定在别处。'],",
    target: 'check-gate-list.mjs',
  },
  {
    // ⚠️ 主判据：分叉没登记。
    // 少了这一条，「加一个命令名与脚本名不同的脚本」什么都不会报——
    // 而那张册子的全部价值就是「照着它一定找得到脚本」。
    why: 'check:command-scripts — 加一个未登记的分叉命令',
    covers: ['②'],
    file: 'package.json',
    find: '"check:staged": "node scripts/check-staged.mjs",',
    replace: '"check:staged": "node scripts/check-staged.mjs",\n    "check:brand-new-thing": "node scripts/some-other-name.mjs",',
    target: 'check-command-scripts.mjs',
  },
  {
    why: 'check:command-scripts — 册子登记的脚本被改名（两份事实分叉）',
    covers: ['①'],
    file: 'package.json',
    find: 'node scripts/check-gate-list.mjs',
    replace: 'node scripts/renamed-gate-check.mjs',
    target: 'check-command-scripts.mjs',
  },
  {
    // ⚠️ 这条断言有**两层守卫**：「逐字一致」会先挡住「脚本被改名」，
    // 所以要单独触发它，必须登记一条**本不该登记的**（对得上的名字）。
    // 我一度以为它是死代码——推演之后发现可达，实测确实红了。
    why: 'check:command-scripts — 册子里有一条「本不该登记的」（已不再分叉）',
    covers: ['③'],
    file: 'scripts/lib/command-scripts.mjs',
    find: "  ['verify:only', 'scripts/bundle-and-verify.mjs',",
    replace: "  ['check:staged', 'scripts/check-staged.mjs', '误登记：这条其实对得上'],\n  ['verify:only', 'scripts/bundle-and-verify.mjs',",
    target: 'check-command-scripts.mjs',
  },
  {
    // ⚠️ **变异的是文档，不是源码。**
    // `check:onboarding-doc` 声称核的是「文档里的实测数字与现在跑出来的一致」，
    // 而它**没被任何东西证明过会红**——2026-09-28 实测之前它守得住，
    // 但「这一次守住了」不等于「它一直在守」。
    why: 'check:onboarding-doc — 文档表里的断链数被改（3 → 7）',
    file: 'docs/onboarding-a-new-site.md',
    find: '| **只读 `wiki`** | 6 | **3** | 4 条 | **`true`** |',
    replace: '| **只读 `wiki`** | 6 | **7** | 4 条 | **`true`** |',
    target: 'check-onboarding-doc.mjs',
  },
  {
    why: 'check:onboarding-doc — 文档表里的 lint 条数被改（10 → 13）',
    file: 'docs/onboarding-a-new-site.md',
    find: "| `''`（不传） | **10** |",
    replace: "| `''`（不传） | **13** |",
    target: 'check-onboarding-doc.mjs',
  },
  {
    // ⚠️ 这一条守着「白名单改成按位置排除」那个改动本身。
    // 原来只核 `docs/cli.md` 与 `README.md`，于是这份文档里的两处幽灵命令
    // （真名是 `verify:portability`，写的是 `check:portability`）躲过了检查。
    why: 'check:onboarding-doc — 正文里出现一个不存在的命令（不只核那两份文档）',
    file: 'docs/onboarding-a-new-site.md',
    find: 'npm run verify:portability',
    replace: 'npm run verify:portability-typo',
    target: 'check-onboarding-doc.mjs',
  },
  {
    // ⚠️ 这一条守着「文件清单从手写改成从文件系统推导」那个改动。
    // 原来是手写三份，而 docs/ 下有 8 份——实测那 4 份漏掉的文档里
    // 13 处 `npm run` 当时全是对的，所以**漏了也不会立刻暴露**：
    // 幽灵命令要等到有人照着敲才现形，那可能是几个月后。
    why: 'check:onboarding-doc — 从文件系统推导后才纳入的 docs/deploy.md 里出现幽灵命令',
    file: 'docs/deploy.md',
    find: '| **GitHub Pages（项目站）** | `SITE_BASE=/仓库名 npm run build` |',
    replace: '| **GitHub Pages（项目站）** | `SITE_BASE=/仓库名 npm run buildx` |',
    target: 'check-onboarding-doc.mjs',
  },
  {
    /*
     * ⚠️⚠️ **这一条的方向换过三次，每次都是「变异无效」不是「判据失效」。**
     *
     * ① 锚点写了一个**不存在的注释行**（我照着 `check-two-paths.mjs`
     *    自己的注释去 `content.ts` 里找）→ 报「锚点出现 0 次」。
     * ② 注入加在**代码后面的行尾注释**里，而判据剥的是**整行**注释
     *    → 注入压根没进判据视野，门禁照样绿。
     * ③ 注入了一整行注释，**基准仍是 4**——我这才明白：
     *    **那道守卫本来就在工作**，而我一直想验的是「它工作」，那当然绿。
     *
     * > **变异要注入的是缺陷，不是「正确的实现」。**
     * > 守卫型的判据，正确时必然绿；要让它红，得**把守卫拆掉**。
     *
     * ⚠️ **拆守卫后不需要额外注入。** `content.ts` 第 82 行**本来就有**一句
     * 行注释写着那个三元的解释（那是 2026-09-28 那次误报的现场记录，一直留着）——
     * 守卫一失效，基准立刻 4 → 6，门禁报红。**实测过**。
     *
     * 而「拆守卫 + 塞注释」那种写法需要改两个文件，**`mutate()` 做不到**
     * （`alsoEdit` 作用在同一个文件的注入结果上，试过，报「第二处锚点 0 次」）。
     * **能只用一处达成同一状态，就不要用两处。**
     */
    why: "check:two-paths — 剥注释的守卫被拆掉（基准 4 → 6，注释里那句被算进去）",
    file: 'scripts/check-two-paths.mjs',
    find: STRIP_COMMENTS_TWO_LINES,
    replace: '  /* 不再剥离注释 */',
    target: 'check-two-paths.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着判据①的「精确相等」——而那正是它被写成这样的原因。**
     *
     * 第一版只判 `gates === 0`，于是把构建侧 `review` 那处判定删掉
     * （4 → 3）时它照样报「✓ 构建侧有 3 处判定」——
     * **基准掉了一格，而它把这当成正常。**
     *
     * > 「基准还在」与「基准没变过」是两件事，
     * > 而这条门禁的全部价值就在后者。
     */
    why: 'check:two-paths — 构建侧少一处判定（基准 4 → 3，必须报而不是「正常」）',
    covers: ['①'],
    file: 'src/lib/content.ts',
    find: ANCHOR2(),
    replace: ANCHOR2_TAIL,
    target: 'check-two-paths.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着 4c 的判据本身。**
     *
     * 4c 是这一天加的：它发现 `GATES_WITH_MUTATIONS` 里**只有一道**门禁，
     * 而 `verify:all` 里有 33 道脚本门禁——**4b 那个循环一次都没跑过其余 32 道**，
     * 而它打印的那行读起来像「每道都核过了」。
     *
     * 变异把 4c 的过滤条件拆掉一半（`recorded()` 不再算数），
     * 于是台账里没记的那 4 道应当立刻冒出来。
     */
    why: 'check:gate-list — 4c 不再认台账里的记录（那些「未验」行就当没写）',
    covers: ['4c'],
    file: 'scripts/check-gate-list.mjs',
    find: '!covered(f) && !recorded(f) && !NO_MUTATION.has(f)',
    replace: '!covered(f) && !NO_MUTATION.has(f)',
    target: 'check-gate-list.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着 `NO_MUTATION` 这条例外。**
     *
     * 例外本身是危险的——**「登记了就不查」正是手写清单的老毛病**。
     * 而 `check-staged.mjs` 那条理由写得很具体（「注入的改动按定义就在工作区里」），
     * 所以它**站得住**；要验的是「**理由被删掉之后它就不算例外了**」。
     */
    why: 'check:gate-list — NO_MUTATION 里的登记被删（例外消失，check-staged 应当变回未覆盖）',
    covers: ['4c'],
    file: 'scripts/check-gate-list.mjs',
    find: "['check-staged.mjs', '它只比",
    replace: "['check-staged-删了.mjs', '它只比",
    target: 'check-gate-list.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着 4d——而它的第一版判据把「格式」当成了「内容」。**
     *
     * 4d 要核的是「台账里『注入什么』那一列写不写得出别人能照着做的动作」。
     * 第一版判据是「有没有反引号」，报出 25 行——**而它错了**：
     * 「把 README 里的测试条数改成 999」完全可复现，只是没打反引号。
     *
     * > **「没加标记」≠「不可复现」**。
     *
     * 变异把「注入什么」整列换成没有任何具体对象的话（全是虚词），
     * 按第一版的判据它**照样绿**（有反引号），按现在的判据必红。
     */
    why: 'check:gate-list — 台账「注入什么」写成一句没有任何具体对象的话（4d 必须红）',
    covers: ['4d'],
    file: 'knowledge/gate-negatives.md',
    find: '| `verify:questions` | 拆掉 `scripts/check-questions.mjs` 里「金标点名了不存在的页面」那条判据 |',
    replace: '| `verify:questions` | 把它弄坏看看 |',
    target: 'check-gate-list.mjs',
  },
  {
    /*
     * ⚠️⚠️ **这一条守着 4e，而它的第一版正则**看不见中文路径**。**
     *
     * 4e 要核「台账里点名的文件还在不在」。
     * 第一版路径段写的是 `[\w./-]` —— 而 **JS 的 `\w` 是 ASCII**，
     * 于是我拿一个中文路径注入，门禁**照样绿**，
     * 而 `existsSync` 明确是 false：**判据压根没看见那个路径。**
     *
     * > 台账里本来就有中文文件名（`knowledge/fixtures/second-site/导出-总览.md`），
     * > 而**恰恰是这些路径最需要核**——它们最容易被改名。
     *
     * 所以这条变异注入的正是**一个中文的不存在路径**：
     * 第一版正则抓不到，修正后必须红。
     */
    why: 'check:gate-list — 台账里点名一个中文的不存在路径（4e 必须红，而旧正则看不见它）',
    covers: ['4e'],
    file: 'knowledge/gate-negatives.md',
    find: '| `src/lib/wiki/read-page.ts` | `main` 用 **YAML 解析器**读 `review`',
    replace: '| `src/lib/wiki/这个文件不存在.ts` | `main` 用 **YAML 解析器**读 `review`',
    target: 'check-gate-list.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着判据 6 对内容页的覆盖。**
     *
     * 判据 6 原来只扫 `README.md` / `AGENTS.md` / `docs/*.md`（10 份），
     * 而仓库里**共 34 份** `.md`。`src/content/**` 那 11 份**是发布出去的页面**，
     * 实测里面有 **5 处** `npm run`——**读者会照着敲**。
     *
     * > 注入一个**只存在于内容页**的幽灵命令。若覆盖没扩，门禁**照样绿**。
     */
    why: 'check:onboarding-doc — 内容页里出现一个不存在的命令（判据 6 原来扫不到那里）',
    file: 'src/content/posts/reproducible-builds.md',
    find: '本站的实测：`npm run verify:reproducible` 会在两个时区完整构建并逐文件比对，',
    replace: '本站的实测：`npm run verify:reproduciblex` 会在两个时区完整构建并逐文件比对，',
    target: 'check-onboarding-doc.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着「`src/content` 是递归的」——而那正是 `check:field-coverage`
     * 当初栽过的形状**（`readContentDirs` 不递归，判据从未发作）。
     *
     * 顶层 `readdirSync` 只看一层，而 `posts/` 与 `wiki/` 在 `src/content/` **下面**——
     * 改成不递归，那 11 份内容页就全部退出覆盖面，而**门禁照样绿**
     * （它只会说「扫了 10 份」，而那 10 份仍然全对）。
     *
     *
     * ⚠️⚠️ **而 `replace` 里不能直接写那个调用。**
     * `check-field-coverage` 有一条判据扫 `scripts/*.mjs` 里的
     * 「自己 readdirSync 一个内容目录」——**而它会把本文件也算进去**
     * （注释被剥掉后，字符串字面量与真调用逐字相同）。
     * 我第一版就是这么写的，于是**干净态就红了**。
     * 改成拼一个常量：那行文本里**没有**那个调用，
     * 而注入后 `check-onboarding-doc` 拿到的**运行时值**是对的。
     *
     * > **两条门禁互相看见对方的源码**——而这不是它们该做的。
     * > 变异脚本天生握着别的门禁的判据要看的形状。
     *
     * > **覆盖面变小，输出里的那个数也变小**——这是形态四的变体：
     * > 不是集合空了，是**集合被人改小了**，而报告跟着改了。
     */
    why: 'check:onboarding-doc — src/content 不再递归（内容页全部退出覆盖面却照样绿）',
    file: 'scripts/check-onboarding-doc.mjs',
    find: "    ...walkMd(join(ROOT, 'src', 'content')),",
    replace: '    ...TOP_LEVEL_ONLY,',
    target: 'check-onboarding-doc.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着 4f——而它的第一版判据量错了东西。**
     *
     * 4f 要核「每道读 `scripts/` 源码的门禁都排除了 `*.mutations.mjs`」。
     * 第一版判据是「有 `readdirSync` 的门禁」，报出 **12 个「没排除」**——
     * **而那 12 个扫的是 `dist` / `docs` / `src/content`，
     * 压根不读 `scripts/` 的源码**，所以不会误报。
     *
     * > **「没排除」≠「会误报」**——那是我拿「有没有这个调用」
     * > 当成了「这个调用扫的是哪里」。
     *
     * 所以这条变异删掉 `check-field-coverage` 的那行排除：
     * 若 4f 的口径是对的（先确定扫哪个目录），它必须红。
     */
    why: 'check:gate-list — 有门禁读 scripts/ 源码却不再排除变异脚本（4f 必须红）',
    covers: ['4f'],
    file: 'scripts/check-field-coverage.mjs',
    find: "      if (name.endsWith('.mutations.mjs')) continue;\n      const src = readFileSync(join(scriptDir, name), 'utf8')",
    replace: "      const src = readFileSync(join(scriptDir, name), 'utf8')",
    target: 'check-gate-list.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着 4g 的主判据，而它抓到的是一处真漂移。**
     *
     * 2026-09-29 实测：台账里写着「48 个单文件命令」，
     * 而 `check-command-scripts` 现在报 **59**——
     * 这几天加了十几道门禁，**总数涨了而那一句没人核**。
     * （分叉数 8 一直是对的，所以漂的是总数，不是分叉数。）
     *
     * 变异把台账那个数改回 48：若 4g 真在重跑那道门禁，必红。
     */
    why: 'check:gate-list — 台账里的命令总数漂了（4g 必须重跑门禁抓到它）',
    covers: ['4g'],
    file: 'knowledge/gate-negatives.md',
    find: '一次性探针扫了 ' + ACTUAL_CMDS + ' 个单文件命令',
    replace: '一次性探针扫了 48 个单文件命令',
    target: 'check-gate-list.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着 4g 的「查不动 ≠ 通过」那个出口。**
     *
     * 4g 靠**解析 `check-command-scripts` 的输出来**取那个数。
     * 而「那道门禁改了输出格式」与「台账的数字对不上」在输出上完全一样——
     * 前者是**环境坏了**，后者是**有 bug**。
     *
     * 变异让重跑拿到一段**没有那个数**的输出，
     * 4g 必须说「核不到任何东西」而不是**默默放过**。
     *
     * ⚠️ **锚点用完整的单行**——我第一版用多行 `find` 再按「到 `});` 为止」
     * 去删，结果**删掉了 208 行**（把后面三个变异一起带走）。
     * **锚点要选最短但完整的那一行。**
     */
    why: 'check:gate-list — 重跑那道门禁却拿不到那个数时，4g 必须报「核不到」而不是放过',
    file: 'scripts/check-gate-list.mjs',
    // ⚠️ **锚点跟着重构搬了家。** 4g 现在把「重跑那段」抽成了 `CMD_SCRIPTS_OUT`，
    // 而这条变异原先指着 `check-gate-list` 里那个 `execFileSync`——
    // 那个位置已经没有了，于是报「锚点出现 0 次」。
    // ⚠️ **锚点只取 `CMD_SCRIPTS_OUT` 的函数名那一行**——
    // 我第一版把整个正则写进锚点，于是 `\\d` 与 `\\s` 要过两层转义，
    // 试了两次都不对（文件里多了一层）。**锚点避开所有反斜杠。**
    find: 'const CMD_SCRIPTS_OUT = () =>',
    replace: 'const CMD_SCRIPTS_OUT = () => null; // MUTATION：模拟那道门禁换了说法，取不到那个数',
    target: 'check-gate-list.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着 4g 扩出来的第二类（变异条数）。**
     *
     * 4g 原先只核「命令数 / 分叉数」两类。2026-09-29 去扫那 6 处
     * 4g 管不到的转述点时，发现**另外两类也漂了**：
     * 变异条数 43 → **56**、编排步数 33 → **43**。
     *
     * ⚠️ 而扩展时栽了一次：正则写成「(\d+) 条变异」，报出 4/30/34 三处，
     * **全是历史记录**（「34 条变异里 2 条一直假红」——那件事已经过去了）。
     * **历史记录与现状声明在字面上完全一样**，唯一的区别是前面有没有现状标志。
     * 所以只认「共/全部/现有/目前是 N 条」那种写法——
     * **这必然漏**（将来有人写一句不带标志的现状声明就核不到），
     * **而「漏报只是漏报，噪声会让人忽略真信号」**。
     */
    why: 'check:gate-list — 台账里的变异条数漂了（4g 扩出来的第二类必须核）',
    covers: ['4g'],
    file: 'knowledge/gate-negatives.md',
    // ⚠️ **锚点不能带那个数，而且要够长到唯一。**
    //   第一版写 `**共 56 条变异**`——而那个数**每次加变异就会变**（56 → 58），
    //   于是锚点失效；第二版只写 `**共 `——**文件里有 2 处**（另一处是 4g 那段表格）。
    // 现状：**锚前半 + 整条尾巴**，而**那个数在两边都不出现**。
    find: '**共 ' + MUT_COUNT + ' 条变异** / 13 道门禁',
    replace: '**共 43 条变异** / 13 道门禁',
    target: 'check-gate-list.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着 4g 扩出来的第三类（编排步数）。**
     *
     * 台账里写着「`verify:all` **有 43 步**」，实际也是 43——**所以这条判据
     * 是绿的，而且它从来没红过**。而「从来没红过」有两种可能：
     * 真对、或者**压根没匹配上**。所以必须注入一次看它会不会红。
     *
     * ⚠️ 而匹配本身也栽了一次：正则写成 `verify:all\s*有`，
     * 而台账里是 `` `verify:all` **有 43 步** `` ——
     * **反引号与加粗星号挡在中间**，于是它一个都没匹配上，
     * 输出是「✓ 编排步数：（台账里没这个说法）」——
     * **那行读起来像「核过了」，而它其实什么都没核**（形态四）。
     */
    why: 'check:gate-list — 台账里的编排步数漂了（4g 扩出来的第三类必须核）',
    covers: ['4g'],
    file: 'knowledge/gate-negatives.md',
    // ⚠️ **锚点不能只写「**有 43 步**」**——我 2026-09-29 写完这一节的表之后，
    // 它在台账里出现了 **2 次**（原文那处 + 我新写的对照表），于是变异失效。
    // 锚点必须带上**只有原文才有的上下文**。
    find: '**有 ' + ACTUAL_STEPS + ' 步**，而 CI 的 `build` job 只显式调用了其中 **7 个**',
    replace: '**有 33 步**，而 CI 的 `build` job 只显式调用了其中 **7 个**',
    target: 'check-gate-list.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着一个 npm 会「静默忽略」的行为**（2026-09-29 实测）。
     *
     * `files` 里只要有一条注释行，**npm 就静默忽略整个字段**——
     * 打包从 124 个文件变回 224 个（868 KB），**而 `npm pack` 一个警告都不打**。
     *
     * > **「我加了配置」与「配置生效了」在输出上完全一样**——
     * > 而这里连「没生效」都没人察觉，直到某天发出一个 868 KB 的包。
     *
     * 变异就是往 `files` 里塞一条注释：门禁必须立刻指出它。
     */
    why: 'check:package-files — files 里出现注释行（npm 会静默忽略整个字段）',
    covers: ['①'],
    file: 'package.json',
    find: '    "LICENSE",',
    replace: '    "// 理由写在这一段的注释里",\n    "LICENSE",',
    target: 'check-package-files.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着「白名单排掉了构建真正要读的东西」那个失效状态。**
     *
     * 2026-09-29 实测过一次：我把 `knowledge/` 当「开发资产」排掉了，
     * 而内容页的 frontmatter 用 `verify:` 声明指向 `knowledge/questions.md`
     * 与 `scripts/wiki-impact.mjs`，`astro.config.mjs` 里的 `checkVerifyClaims`
     * **在构建时逐条核文件在不在**——**干净目录里 `npm run build` 直接失败**。
     *
     * > **「看起来是开发资产」与「是构建的输入」在代码里长得一样。**
     * > 唯一的分法是**在干净目录里真跑一次构建**。
     *
     * ⚠️ 而这条变异**要跑完整的 `--full`**（打包 + 装依赖 + 构建），
     * 所以它是本文件里最慢的一条——**这正是它该有的代价**。
     */
    why: 'check:package-files — 排掉 knowledge/（构建会因 verify 声明而失败）',
    covers: ['②'],
    file: 'package.json',
    find: '    "knowledge/",',
    replace: '    "knowledge-排掉了/",',
    target: 'check-package-files.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着判据③：`description` 必须与 README 里那句逐字相同。**
     *
     * 2026-09-29 查 npm registry 时把 `description` 改成英文
     * （**查 `astro-blog-theme` / `astro-starter-template` 下下载量最高的包，
     * 它们全是英文**——那是生态共识，不是我的偏好），
     * 而那是从 README 已有的英文定位取的。
     *
     * > **同一份事实两处措辞**——README 的测试条数漂过三次、编排步数漂过四次。
     * > 所以「它从哪来」要被守住，而不只是「它存在」。
     *
     * 变异改 `description` 的措辞（改得仍然通顺，只是不一致）——
     * **那正是「同一件事两处写法」的形状**。
     */
    why: 'check:package-files — description 与 README 那句不一致（同义不同字）',
    covers: ['③'],
    file: 'package.json',
    find: '"description": "A static blog template that gets Chinese typography right',
    replace: '"description": "An Astro blog template for Chinese typography',
    target: 'check-package-files.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着判据④：「护栏不能挂在 `prepack` 上」。**
     *
     * npm 11 官方文档（`npm/docs/content/using-npm/scripts.md` 第 63–65 行）
     * 明写：`prepack` **在 `npm pack` 时也跑**——
     * 而 `check-package-files` 的判据②**每次都跑 `npm pack`**。
     * 把护栏挂上去就变成套娃：
     * 打包 → `prepack` → 护栏 → `verify:all`（44 步）→ 打包 → ……
     *
     * > **hook 名相似，语义完全不同**——而那个相似正是容易选错的理由。
     *
     * 变异：把 `prepack` 占用掉，判据必须立刻报出来。
     */
    why: 'check:package-files — prepack 被占用（会让 npm pack 触发护栏 → 套娃）',
    covers: ['④'],
    file: 'package.json',
    find: '    "prepublishOnly": "node scripts/prepublish-guard.mjs"',
    replace: '    "prepublishOnly": "node scripts/prepublish-guard.mjs",\n    "prepack": "node scripts/prepublish-guard.mjs"',
    target: 'check-package-files.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着 `check:release` 的判据②：tag 与 `package.json` 要一致。**
     *
     * 两者是**同一个事实的两处真值**（`npm version` 会同时改它们并打 tag），
     * 而**各改一处**就会分叉——那时候「已发布的版本」与「仓库写着的版本」对不上，
     * 而 **npm 页面上的版本号仍然是对的**（它读的是 registry 上那次发布）。
     *
     * 变异：只改 `package.json` 的 version，不打 tag。
     */
    why: 'check:release — 改 package.json 的 version 而不打 tag（两份真值分叉）',
    covers: ['②'],
    file: 'package.json',
    find: '  "version": "0.1.0",',
    replace: '  "version": "0.2.0",',
    target: 'check-release.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着 4c 的「台账第一列解析」——它第一版太窄。**
     *
     * 台账里有 **12 行**写成 `` `check:two-paths`（新） ``，
     * 而旧正则要求「反引号后紧跟竖线」——**那 12 行对 4c 等于不存在**。
     *
     * > 「（新）」是给人看的备注，而**机器不该因为它看不见那一行**——
     * > 那与「文件里没写」在输出上完全一样（形态四的变体）。
     *
     * 2026-09-29 实测：加 `check:release` 时 4c 报「三样都没有」，
     * 而台账第 93 行**明明有那一行**——差别只是「（新）」两个字。
     *
     * ⚠️⚠️ **我第一版这条变异写错了方向**：把「（新）」去掉之后，
     * 4c **本来就应该仍认得出**（两种写法都对）——于是它**不会红**，
     * 而 `CASES` 要求每条都必须红。
     *
     * > **一条必定失败的变异 = 让套件永远红**——而那比「不写这条」更坏。
     *
     * 所以改成**删掉整行**（含换行）：那才是 4c 真正该抓的失效状态。
     * ⚠️ **而它顺带验了「（新）」那 12 行现在被算进去了**——
     * 因为 `check:release` 那一行正是带「（新）」的。
     */
    why: 'check:gate-list — 删掉「只有台账在册」的那一行（4c 必须报「三样都没有」）',
    covers: ['4c'],
    file: 'knowledge/gate-negatives.md',
    // ⚠️ **带末尾换行**——只删行内容会留下一个空行，而那仍是合法 Markdown 表格行。
    find: LEDGER_ONLY_ROW,
    replace: '',
    target: 'check-gate-list.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着判据④：「模板」还是「包」，必须写明。**
     *
     * 2026-09-29 实测到的不一致：README 第 55 行明写「这是**模板**」，
     * 而 `package.json` 里已有一整套「当包发」的装备
     *（`files` 白名单、`prepublishOnly` 护栏、`keywords` / `repository` / `homepage`），
     * **而那一整套没有一句承诺**。
     *
     * > **没有承诺的准备工作是自说自话**——门禁在守一个没人承诺过的流程。
     *
     * 变异：把「模板」那两个字去掉，README 就**既没说模板、也没说包**，
     * 判据必须立刻报出来。
     *
     * ⚠️ 而它**不会**误报：README 里还有 `npm install && npm run dev`，
     * 但那句的 `npm install` **不是** `npm i letterpress`——
     * **「clone 之后装依赖」与「把这个包当依赖装」是两件事**，
     * 而判据认的是后者（正则要 `npm i/install letterpress`）。
     */
    why: 'check:release — README 既没写「模板」也没写「包」（准备工作成了自说自话）',
    covers: ['④'],
    file: 'README.md',
    find: '**① 拿到代码**（这是**模板**，所以第一步是 clone 而不是 install）：',
    replace: '**① 拿到代码**（第一步是 clone）：',
    target: 'check-release.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着判据⑤：定位的措辞必须在全文唯一。**
     *
     * ④ 只核「有没有写明这是模板」——而**全文搜一个词找到「有一处这么说」，
     * 不等于「没有别处说反的」**。
     *
     * 真实形状是：有人在 README **另一处**补一句说明
     * （「它其实也可以当依赖装」/「这不是模板」/「只是主题」），
     * 而那句话**与第 55 行矛盾**——**④ 照样绿**。
     *
     * > 而 README 是**给人读的**，人会补一句说明——
     * > **补的那一句正是最容易与原句矛盾的地方**。
     *
     * 变异：在别处加一句「它只是主题」。
     */
    why: 'check:release — README 别处出现与「这是模板」矛盾的表述（⑤ 必须红）',
    covers: ['⑤'],
    file: 'README.md',
    find: '**不用改配置、不用建数据库、不用填环境变量。** 你现在看到的就是完整站点。',
    replace: '**不用改配置、不用建数据库、不用填环境变量。** 你现在看到的就是完整站点。\n'
      + '（它只是主题，不是一个包。）',
    target: 'check-release.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着判据 4h：4b 的标题不能声称它核不到的范围。**
     *
     * 原话是「负向验证是否覆盖了被测门禁的**每一项**判据」，
     * 而实测它只遍历一张**只有一道**的登记表
     * （有 `mustMatch: [` 式清单的门禁全仓库只有 2 个）。
     *
     * > **「标题声称的范围」与「实际核到的范围」在输出上完全一样**——
     * > 读者读到「每一项」会以为那 46 个平铺 `problems.push` 的脚本也核过了，
     * > **而它们一次都没进过那个循环。**
     *
     * 变异：把限定语去掉，标题回到全称——4h 必须立刻报出来。
     *
     * ⚠️ 而那个标题**只有一处**（`SECTION_4B_TITLE`）——
     * 第一版它在 `console.log` 与 4h 里各写一遍，
     * **而 4h 核的正是那一句**——**改一处就核到的是另一处**（形态八）。
     */
    why: 'check:gate-list — 4b 的标题回到全称「每一项判据」（而它只遍历一道）',
    covers: ['4b'],
    file: 'scripts/check-gate-list.mjs',
    find: "  '负向验证是否覆盖了**有 REQUIREMENTS 式清单的**门禁的每一项判据';",
    replace: "  '负向验证是否覆盖了被测门禁的每一项判据';",
    target: 'check-gate-list.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着 4i 的 `NOT_VERIFIABLE`——登记了就不报，没登记就报。**
     *
     * 4i 数「验证条数 vs 编号判据数」，而它有**一个例外出口**：
     * 某些门禁**验不了**（`check:staged` 注入的是工作区，而它核的是暂存区；
     * `check:manifest-schema` 读的是产物，而变异改产物会被重建覆盖）。
     *
     * > **「验不了」必须与「忘了验」在输出上分得开**——
     * > 否则登记就会被当成「有人管」，而实际上**没有人能验**。
     *
     * ⚠️ 变异把 `NOT_VERIFIABLE` 里**没有的那道**（`check:manifest-schema`）
     * 挪走——**它就该重新出现在「明显不成比例」里**。
     * 而这正是「登记真的在起作用」的证明。
     */
    why: 'check:gate-list — 把 NOT_VERIFIABLE 里的一条挪走（4i 必须重新报它）',
    covers: ['4i'],
    file: 'scripts/check-gate-list.mjs',
    find: "    ['check:manifest-schema', '它读的是**产物**",
    replace: "    ['check:manifest-schema-挪走了', '它读的是**产物**",
    target: 'check-gate-list.mjs',
  },
  {
    /*
     * ⚠️ **这一条守着 4i 的 `covers` 校验——而那是一个新的失效面。**
     *
     * `covers: ['⑤']` 说「有一条变异测的是第 ⑤ 条判据」，
     * 而**把那一条判据的编号改成 ⑥**（或删掉它），登记就**悬空了**——
     * **登记看起来很认真，实际上一条也没测**，而 4i 数不出来
     * （它数的是「有几条变异」）。
     *
     * > **登记的「权威性」来自它能被核对**——
     * > 而「能数出来」不等于「核对过」。
     *
     * ⚠️⚠️ **第一版这条变异写成了「在自己身上加 `covers: ['⑦']`」——
     * 而那条例外**自己就在 `CASES` 里**，于是它成了「本文件里有一条变异声明了 ⑦」，
     * **不是「注入一个 ⑦ 进去」**。干净态直接就红了。
     *
     * > **变异要注入的是「缺陷」，而「在描述里写上」不是注入**——
     * > 那正是我这两周反复交学费的一条。
     */
    why: 'check:gate-list — 判据编号变了而 covers 登记还指着旧的（必须报「悬空」）',
    file: 'scripts/check-release.mjs',
    // ⚠️ **锚点取 `── ⑤ ` 而不是整行**——整行含一长串 U+2500，
    // 我手写那串时对不上（报「出现 0 次」）。而**短而唯一的那个**
    // 恰是 `ownIds` 用来识别判据的那一截。
    find: '── ⑤ ',
    replace: '── ⑥ ',
    target: 'check-gate-list.mjs',
  },
  {
    why: 'check:two-paths — post 侧不再丢 declaredRelations',
    covers: ['②'],
    file: 'src/lib/wiki/page-to-doc.ts',
    find: "declaredRelations: isWiki ? options.relations ?? page.related : [],",
    replace: 'declaredRelations: options.relations ?? page.related,',
    target: 'check-two-paths.mjs',
  },
  {
    why: 'check:two-paths — post 侧不再丢 wikiKind',
    covers: ['②'],
    file: 'src/lib/wiki/page-to-doc.ts',
    find: "...(isWiki ? { wikiKind: page.kind } : {}),",
    replace: '...({ wikiKind: page.kind }),',
    target: 'check-two-paths.mjs',
  },
  {
    why: 'check:two-paths — 读路径不再读 draft（草稿会进图）',
    covers: ['④'],
    file: 'src/lib/wiki/read-page.ts',
    // 用正则：那一行含 `$` 与 `|`，用字符串 find 会与「锚点唯一」判定打架
    find: 'draft: /^(true|yes|on)$/i.test',
    replace: 'draft: false, _mut_(',
    target: 'check-two-paths.mjs',
  },
  {
    why: 'check:field-coverage — sources 块解析失效',
    file: 'src/lib/wiki/read-page.ts',
    find: 'sources: refs,',
    replace: 'sources: [],',
    target: 'check-field-coverage.mjs',
  },
  {
    why: 'check:field-coverage — tags 不再剥方括号',
    file: 'src/lib/wiki/read-page.ts',
    find: "    tags: relationList(source, 'tags'),",
    replace: "    tags: (frontmatterField(source, 'tags') ?? '').split(',').map((x) => x.trim()).filter(Boolean),",
    target: 'check-field-coverage.mjs',
  },
  {
    // ⚠️ 守着「静默跳过 → 必须显式写明理由」那个改动。
    // 原来 `if (!item.where) continue;`——加一条**故意不校验**的登记
    // 在输出上完全看不出来，而那正是「按文件豁免通病」的形状：
    // **豁免的正是检查本身**。今天第三次撞上同一个病。
    //
    // ⚠️ **2026-09-28 修了四轮才防住，而四轮都栽在同一句话上：
    // 「结构上只有一个出口，所以拆不掉」。**
    //
    // ① `if (!item.where) continue;` 完全静默
    // ② 加守卫 → 守卫与 else 是两个出口，拆守卫 → `skip: undefined` 被放行
    // ③ 合成 if/else → 拆 if → 后面两行无条件执行
    // ④ 「失败条件与控制流解耦」→ **也错了**：`problems.push` 就在那个 if 的
    //    **body 里**，拆掉 if 等于**拆掉记账本身**。
    //
    // 现在的结构是**先算结论、再按结论打印**：`unexplained` 这个**数据**
    // 在分支里被填充，而 `problems` 的填充只看这个数据。
    // 于是拆掉那个 if 也只是让「该报」落进 `deliberatelySkipped`——
    // **而 problems 仍非空** → 仍红。
    //
    // 这条变异拆的就是那个记账分支：**它必须仍然红**。
    why: 'check:single-literal — 有一条无理由的「刻意不校验」登记，且记账分支被拆掉',
    file: 'scripts/check-single-literal.mjs',
    find: "    if (typeof item.skip !== 'string' || item.skip.trim() === '') {",
    replace: "    if (false) { // MUTATION：记账分支被拆掉",
    target: 'check-single-literal.mjs',
    // 额外注入：加一条无理由的登记
    alsoEdit: {
      find: 'const SHARED_LITERALS = [',
      replace: "const SHARED_LITERALS = [\n  { what: '无理由的刻意不校验' },",
    },
  },
  {
    why: 'check:single-literal — 文档根清单在别处又写一份',
    file: 'scripts/check-adapter-size.mjs',
    find: "const ROOT = process.cwd();",
    replace: "const ROOT = process.cwd();\nconst DOC_ROOTS_COPY = ['README.md', 'AGENTS.md', 'docs', 'src/content'];",
    target: 'check-single-literal.mjs',
  },
  {
    why: 'check:not-a-demo — relationField 失效（适配层没起作用，两边就不分叉）',
    file: 'src/lib/wiki/read-page.ts',
    find: '        ...(relationField ? { related: relationList(source!, relationField) } : {}),',
    replace: '        // MUTATION：relationField 不生效',
    target: 'check-not-a-demo.mjs',
  },
  {
    why: 'check:not-a-demo — 语料让两边都从正文拿关系（异构点被正文遮住）',
    file: 'scripts/check-not-a-demo.mjs',
    find: "    '正文提到关系，但**不写** `[[乙]]`——那正是 frontmatter 声明的用处。',",
    replace: "    '见 [[乙]]。',",
    target: 'check-not-a-demo.mjs',
  },
  {
    why: 'check:no-duplicate-lists — 同一个文件里把清单抄了第二份',
    file: 'scripts/check-not-a-demo.mjs',
    find: "const MUST_MATCH = ['slugs', 'broken', 'hasErrors', 'topHit']",
    replace: "const MUST_MATCH = ['slugs', 'broken', 'hasErrors', 'topHit'];\nconst MUST_MATCH_COPY = ['slugs', 'broken', 'hasErrors', 'topHit'];",
    target: 'check-no-duplicate-lists.mjs',
  },
  {
    // ⚠️ 锚点是 `const ROOT_DIRS = SOURCE_DIRS;` 而不是字面量——
    // 收敛掉跨文件重复之后它就变了，而**锚点失效会被「锚点出现 0 次」当场抓住**
    // （那正是 2026-09-28 刚加的那道自检救下来的：不是「门禁有盲区」，
    // 是「变异压根没注入」）。
    why: 'check:no-duplicate-lists — 把扫描根收窄（覆盖面变小却照样绿）',
    file: 'scripts/check-no-duplicate-lists.mjs',
    find: 'const ROOT_DIRS = SOURCE_DIRS;',
    replace: "const ROOT_DIRS = ['src'];",
    target: 'check-no-duplicate-lists.mjs',
  },
  {
    why: 'check:adapter-size — 一行手工 Doc（行数不变，但是核心的完整复制）',
    file: 'scripts/check-second-site-real.mjs',
    find: 'const docs = pages.map((page) => pageToDoc(page));',
    replace: 'const docs = pages.map((page) => ({ kind: "wiki", slug: page.slug, title: page.title, summary: page.summary ?? "", body: page.body, sources: page.sources, declaredRelations: page.related, explicitSlug: page.explicitSlug, draft: page.draft, wikiKind: page.kind }));',
    target: 'check-adapter-size.mjs',
  },
  {
    why: 'check:adapter-size — 映射层多写一行手写接线',
    file: 'scripts/check-second-site-real.mjs',
    find: 'const docs = pages.map((page) => pageToDoc(page));',
    replace: 'const docs = pages.map((page) => pageToDoc(page));\nconst extra = pages.filter((p) => p.title.length > 0);',
    target: 'check-adapter-size.mjs',
  },
  {
    why: 'check:adapter-size — 映射层不再调用核心',
    file: 'scripts/check-second-site-real.mjs',
    find: "const { pages } = readContentDirs([DIR], { relationField: 'audience' });",
    replace: 'const pages = [];',
    target: 'check-adapter-size.mjs',
  },
];

// 先确认全部干净（干净状态下不该有任何一条红）
//
// ⚠️ **用 `GATES` 遍历，不要再写一份字面量**——2026-09-28 加第 5 道门禁时
// 忘了同步这里，于是「干净态检查」漏掉一道（而它仍是绿的，看起来没事）。
// **清单写两遍 = 迟早漏一处**，同形态今天已犯四次。
for (const t of GATES) {
  const r = red(t);
  if (r.red) {
    problems.push(`干净状态下 ${t} 就是红的——先修那个，本轮验证没有意义`);
    console.log(`  ✗ 干净状态下 ${t} 已红`);
  }
}
if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`  ✓ 干净状态下 ${GATES.length} 道门禁全绿\n`);

if (Math.random() < 0) {}
/*
 * ⚠️ **每条变异必须齐五个字段——而这五个字段本身就是判据。**
 *
 * 2026-09-29 实测：`check-agents-coverage` 的两条变异把 `why` 写成
 * **反引号模板串**，而 `mutate()` 不检查 `why` 存不存在——
 * **所以「为什么做这条变异」这件事一直没有守卫**。
 * 而它**恰恰是「判据 ↔ 变异」对应关系的唯一说明**：
 * `covers` 是结构化登记，`why` 是给人读的理由，**两者都缺就等于那条变异没被交代**。
 *
 * > **「所有条目都有理由」与「理由是空字符串」在输出上完全一样**——
 * > 而「字段缺失」连输出都没有。
 *
 * ⚠️ **而 `covers` 刻意不要求每条都有**：
 * 只有**有编号判据**的门禁才需要它（其余是 CLI 契约 / 迁移类变异，
 * 它们的对应关系由 `why` 承担）。
 */
{
  const REQUIRED = ['why', 'file', 'find', 'replace', 'target'];
  const bad = [];
  CASES.forEach((c, i) => {
    const missing = REQUIRED.filter((k) => c?.[k] === undefined);
    if (missing.length > 0) bad.push(`第 ${i + 1} 条缺 ${missing.join('、')}`);
  });
  if (bad.length > 0) {
    problems.push(
      `**有 ${bad.length} 条变异缺必要字段**：\n`
      + bad.map((b) => `        ${b}`).join('\n') + '\n'
      + '    → `why` 是「判据 ↔ 变异」对应关系的**唯一说明**，而它缺了**连输出都没有**。',
    );
    console.log(`  ✗ ${bad.length} 条变异缺字段`);
  } else {
    console.log(`  ✓ ${CASES.length} 条变异都齐五个字段`);
  }
}

let ok = 0;
for (const c of CASES) if (mutate(c)) ok++;
console.log(`\n${ok}/${CASES.length} 条变异都被抓住。`);

/*
 * ── 收尾断言：跑完之后，**工作区必须与跑之前一样** ──────────────────────
 *
 * ⚠️ **为什么必须加这条**（2026-09-28）。
 *
 * 那天下午我遇到「34 条变异里 2 条一直假红」，先判成「并发」、
 * 写进了台账——**而根因是 `spawnSync` 返回 `status: null`**，
 * 也就是**我自己的脚本压根没跑成 build**，却被我的 `!== 0` 读成「失败」。
 *
 * > **那条假红的形态，正是这个仓库吃过两次的亏**：
 * > 「原样透传」与「带坏提交」——**工作区被改过而没人知道**。
 * > 而 `mutate()` 每次都会 `writeFileSync(path, original)` 还原它注入的那一处，
 * > **却从来没有检查过「除了我注入的，还有没有别的东西被改了」**。
 *
 * 判据：**跑完之后 `git status --porcelain` 必须与跑之前相同。**
 * ⚠️ **要比较「前」与「后」，不能只判「后」是空的**——
 * 提交前工作区本来就可能有改动（那一轮我就带着 5 个未提交的文件），
 * 而「空」会把「我弄脏了」与「本来就有改动」混成一条。
 */
{
  const now = spawnSync('git', ['status', '--porcelain'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60_000,
  }).stdout ?? '';
  const norm = (s) => s.split('\n').filter(Boolean).sort().join('\n');
  if (norm(now) !== norm(ENTRY_STATUS)) {
    const added = norm(now).split('\n').filter((l) => !ENTRY_STATUS.includes(l));
    const gone = ENTRY_STATUS.split('\n').filter((l) => l && !norm(now).includes(l));
    problems.push(
      '**跑完之后工作区变了**——本轮变异留下了残留。\n'
      + (added.length ? `    新出现的：\n${added.map((l) => `      ${l}`).join('\n')}\n` : '')
      + (gone.length ? `    消失的：\n${gone.map((l) => `      ${l}`).join('\n')}\n` : '')
      + '    → 每条变异都会还原它注入的那一处，**而这一条抓的是「我注入之外的改动」**。\n'
      + '    2026-09-28 那 2 条一直假红就是这类残留造成的'
      + '（`spawnSync` 返回 `status: null`，子进程压根没跑成）。',
    );
    console.log(`  ✗ 跑完之后工作区变了（新增 ${added.length} 处、消失 ${gone.length} 处）`);
    for (const l of added) console.log(`      + ${l}`);
    for (const l of gone) console.log(`      - ${l}`);
  } else {
    console.log('  ✓ 跑完之后工作区与跑之前一致（无残留）');
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log(`${GATES.length} 道新门禁的负向验证全部成立。\n`);
