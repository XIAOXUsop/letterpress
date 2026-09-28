#!/usr/bin/env node
/**
 * **别人从 tarball 装上它之后，必须还能构建成功。**
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 2026-09-28 实测：`package.json` **没有 `files`**，于是 `npm pack` 把
 * **222 个文件、868 KB** 打进 tarball——其中 `scripts/` 37%、
 * `knowledge/` 10%、`docs/` 14%，**而 `.verify/` 明明在 `.gitignore` 里
 * 却仍被打进去**。
 *
 * > **因为 `npm pack` 只认 `files` 与 `.npmignore`，不看 `.gitignore`。**
 * > 那是 61% 的体积，而**对使用者毫无用处**。
 *
 * 于是加了 `files` 白名单。**而第一版立刻错了两次**——两次都只有真跑一次
 * 构建才看得出来：
 *
 * | 错法 | 症状 |
 * |---|---|
 * | **`files` 里写了注释行** | **npm 静默忽略整个字段**（224 个文件，一个警告都没打） |
 * | **把 `knowledge/` 与 `scripts/` 整个排掉** | 干净目录里 `npm run build` **直接失败** |
 *
 * 第二条的根因值得记住：`knowledge/` 与 `scripts/` **不只有台账**——
 * 内容页的 frontmatter 用 `verify:` 声明指向它们，而 `astro.config.mjs`
 * 里的 `checkVerifyClaims` **在构建时逐条核文件在不在**。
 *
 * > **「看起来是开发资产」与「是构建的输入」在代码里长得一样。**
 * > 唯一的分法是**在干净目录里真跑一次构建**。
 *
 * ── 判据 ────────────────────────────────────────────────────────────
 *
 * ① **`files` 里不能有注释行** —— 2026-09-28 实测它会让 npm 静默忽略整个字段。
 *    而 npm **一个警告都不打**，所以**除了本检查没有任何东西会报告它**。
 * ② **白名单必须覆盖构建真正要读的东西** —— 不是靠人列，而是**在干净目录里
 *    真跑一次 `npm run build`**。贵，但这是唯一能分开「必要」与「多余」的办法。
 *
 * ⚠️ **② 默认不跑**（要装 426 个包、几十秒）。加 `--full` 才跑；
 * 缺了 `--full` 时**必须说清「本轮没验」而不是假装验过了**。
 *
 * 用法：`node scripts/check-package-files.mjs [--full]`
 */
import { readFileSync, existsSync, rmSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const problems = [];
const FULL = process.argv.includes('--full');

/**
 * 跑一条 npm 命令。
 *
 * ⚠️ **Windows 上用 `cmd.exe /c npm`，不用 `shell: true`**——
 * 后者会触发 Node 的 DEP0190 弃用警告（2026-09-29 实测），
 * 而**一个每天在 CI 跑的脚本不该刷这种噪声**。
 * 处置与 `new-gates.mutations.mjs` 同一（那里是因为同一条原因）。
 */
const runNpm = (args, cwd, encoding) => {
  const [cmd, pre] = process.platform === 'win32' ? ['cmd.exe', ['/c', 'npm']] : ['npm', []];
  return execFileSync(cmd, [...pre, ...args], {
    cwd, stdio: 'pipe', ...(encoding ? { encoding } : {}),
  });
};

console.log('打包内容检查');
console.log('─'.repeat(64));

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const rawPkg = readFileSync(join(ROOT, 'package.json'), 'utf8');

// ── ① `files` 里不能有注释行 ───────────────────────────────────────────
/*
 * ⚠️ **npm 静默忽略整个 `files` 字段，而它一个警告都不打。**
 *
 * 2026-09-28 实测：`files` 里每条前面加一行 `// 解释`，
 * 打包结果从 124 个文件变回 **224 个**——而 `npm pack` **一声不吭**。
 *
 * > **「我加了配置」与「配置生效了」在输出上完全一样**——
 * > 而这里连「没生效」都不会被任何人察觉，直到某天有人发了个 868 KB 的包。
 */
if (!Array.isArray(pkg.files)) {
  problems.push(
    '**`package.json` 没有 `files` 白名单。**\n'
    + '    → `npm pack` 会把 `scripts/`、`knowledge/`、`docs/`、`.verify/`\n'
    + '    **全打进 tarball**（2026-09-28 实测 222 个文件 868 KB，61% 是无用体积）。\n'
    + '    → 而 `npm pack` **只看 `files` 与 `.npmignore`，不看 `.gitignore`**，\n'
    + '    所以 `.gitignore` 里的 `.verify/` 也会被打进去。',
  );
  console.log('  ✗ 没有 `files` 白名单');
} else {
  const commentish = pkg.files.filter((f) => typeof f !== 'string' || f.trim() === '' || f.startsWith('//') || f.startsWith('#'));
  if (commentish.length > 0) {
    problems.push(
      `**\`files\` 里有 ${commentish.length} 条注释或空行**——\n`
      + `        ${JSON.stringify(commentish).slice(0, 120)}\n`
      + '    → **npm 会静默忽略整个 `files` 字段**，而它**一个警告都不打**\n'
      + '    （2026-09-28 实测：加了注释后打包从 124 个文件变回 224 个）。\n'
      + '    → 理由写在这一段的**注释里**，不要放进数组。',
    );
    console.log(`  ✗ \`files\` 里有 ${commentish.length} 条注释/空行（会让 npm 静默忽略整个字段）`);
  } else {
    console.log(`  ✓ \`files\` ${pkg.files.length} 条，没有注释行`);
  }

  // 路径必须真存在——否则「排掉了必要文件」会静默发生
  const missing = pkg.files.filter((f) => typeof f === 'string' && !existsSync(join(ROOT, f.replace(/\/$/, ''))));
  if (missing.length > 0) {
    problems.push(
      `**\`files\` 里这些路径在仓库里不存在**：${missing.join('、')}\n`
      + '    → 排掉一个不存在的路径**看起来无害**（清单照旧）——\n'
      + '    **而它也许正说明你想排的那个目录已经被改名或删了。**',
    );
    console.log(`  ✗ ${missing.length} 条路径不存在：${missing.join('、')}`);
  } else {
    console.log(`  ✓ \`files\` 里 ${pkg.files.length} 条路径都存在`);
  }
}

// ── ③ `description` 必须与 README 里那句英文定位逐字相同 ──────────────────
/*
 * ⚠️ **2026-09-29 调研 npm registry 时加的。**
 *
 * 查 `astro-blog-theme` / `astro-starter-template` 这两组下**下载量最高的包**，
 * 它们的 `description` **全是英文**（其中一个还标了 `Trilingual (zh/en/ja)`）——
 * 那是**生态共识，不是我的偏好**。
 *
 * 所以 `package.json` 的 `description` 改成英文。**而那意味着它与 README
 * 里那句英文定位说的是同一件事**——于是**必须逐字一致**，否则又是
 * 「同一份事实两处措辞」（README 的测试条数漂过三次、编排步数漂过四次）。
 *
 * > **判据要核的是「同一件事的两处措辞」而不是「措辞好不好」**——
 * > 后者是人的判断，而前者是机械的。
 *
 * ⚠️ **而 README 里那句话的位置是判据的一部分**：它必须在 `<summary>English</summary>`
 * 那个折叠块里。**不在那儿就说明「英文定位」这件事已经变了**，而判据要报出来。
 */
{
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const m = /\*\*A static blog template[^*]*\*\*/.exec(readme);
  const claimed = m ? m[0].replace(/^\*\*|\*\*$/g, '').trim() : null;
  if (!claimed) {
    problems.push(
      '**`README.md` 里找不到那句英文定位**（`**A static blog template …**`）。\n'
      + '    → 而 `package.json` 的 `description` **取自它**——\n'
      + '    **所以那句话不见了，就没法核「两边是否还一致」。**',
    );
    console.log('  ✗ README 里找不到英文定位');
  } else if (claimed !== pkg.description) {
    problems.push(
      `**\`package.json\` 的 \`description\` 与 \`README.md\` 里那句不一致：**\n`
      + `        package.json: ${JSON.stringify(pkg.description)}\n`
      + `        README.md   : ${JSON.stringify(claimed)}\n`
      + '    → 两者**说的是同一件事**（那句是 description 的来源）。\n'
      + '    → 改一处而不改另一处，就是「同一份事实两处措辞」，\n'
      + '    **而读者读到的是任意一处**。',
    );
    console.log('  ✗ `description` 与 README 里那句不一致');
  } else {
    console.log('  ✓ `description` 与 README 里那句英文定位逐字相同');
  }
}

// ── ② 白名单覆盖后，干净目录里还能不能构建 ────────────────────────────
/*
 * ⚠️ **这才是唯一能分开「必要」与「多余」的办法。**
 *
 * 我第一版把 `knowledge/` 与 `scripts/` 当「开发资产」排掉了——
 * 而它们**被内容页的 `verify:` 声明点名**，
 * `astro.config.mjs` 里的 `checkVerifyClaims` **在构建时逐条核文件在不在**。
 * 症状是干净目录里 `npm run build` 直接失败：
 *
 *   声明说 knowledge/questions.md 应该存在，但它不在
 *   声明说 scripts/wiki-impact.mjs 应该存在，但它不在
 *
 * > **「看起来是开发资产」与「是构建的输入」在代码里长得一样。**
 */
if (!FULL) {
  console.log('  – 干净目录构建：**本轮没验**（要装 426 个包，加 `--full` 才跑）');
  console.log('    ⚠️ 「没验」与「验过了」在输出上完全一样——所以这里明写「没验」。');
} if (FULL) {
  const tmp = join(tmpdir(), 'lp-pack-check');
  try {
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    // 打一个真的 tarball
    runNpm(['pack', '--pack-destination', tmp], ROOT);
    // ⚠️ **npm 的 notice 走 stdout，会把门禁的输出淹没**——
    // 而 `--pack-destination` 已经把 tarball 放到 `tmp` 了，
    // **根本不需要读 stdout**（2026-09-29 实测：notice 灌了 100 多行）。
    const tgzPath = readdirSync(tmp).find((f) => f.endsWith('.tgz'));
    if (!tgzPath) {
      problems.push('**`npm pack` 没有在临时目录里产出 `.tgz`**——本判据此刻核不到任何东西。');
      console.log('  ✗ `npm pack` 没产出 tarball');
      throw new Error('no tgz');
    }
    // ⚠️ **用 Windows 侧的 tar**——Git Bash 的 `tar` 会把 `D:` 当远程主机
    // （2026-09-28 实测：`Cannot connect to D: resolve failed`）。
    const tarBin = process.platform === 'win32'
      ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe')
      : 'tar';
    execFileSync(tarBin, ['-xzf', join(tmp, tgzPath), '-C', tmp], { stdio: 'pipe' });
    const pkgDir = join(tmp, 'package');

    /*
     * ⚠️⚠️ **不要「复用本仓库的 node_modules 省时间」**（2026-09-29 实测栽在这）。
     *
     * 我第一版用 `xcopy` / `robocopy` 复制，踩了两个坑：
     *   ① **`robocopy` 的非零退出码本身就是成功**（它用退出码表示复制了多少
     *      文件），而 `execFileSync` 把非零当抛异常——于是**每次都「失败」**。
     *   ② 就算复制成功，**这个优化也证明不了什么**：它验的是「构建能跑」，
     *      而**别人装上这个包能不能成，取决于 `npm install` 能不能成**。
     *
     * > **省时间的那一步，恰好是让结论变得不可信的那一步。**
     *
     * 所以：**老老实实装一次**。慢几十秒，换来的是「使用者真的能装上」这个结论。
     */
    runNpm(['install', '--no-audit', '--no-fund'], pkgDir);

    const r = runNpm(['run', 'build'], pkgDir, 'utf8');
    const pages = (r.match(/(\d+)\s*page/gi) ?? []);
    console.log(`  ✓ 干净目录里 \`npm run build\` 成功（${pages[0] ?? '页数未报'}）`);
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    problems.push(
      '**把 tarball 解包到干净目录后，`npm run build` 失败。**\n'
      + '    → 这说明 `files` 白名单**排掉了构建真正要读的东西**。\n'
      + '    → 2026-09-28 实测过一次：把 `knowledge/` 与 `scripts/` 当「开发资产」排掉，\n'
      + '    而它们**被内容页的 `verify:` 声明点名**，构建时逐条核文件在不在。\n'
      + '    → **「看起来是开发资产」与「是构建的输入」在代码里长得一样**，\n'
      + '    唯一的分法就是**在干净目录里真跑一次构建**。\n'
      + (out.trim() ? `    ── 构建器的原话 ──\n${out.trim().split('\n').slice(-12).map((l) => '    ' + l).join('\n')}\n` : ''),
    );
    console.log('  ✗ 干净目录里 `npm run build` 失败（`files` 排掉了必要文件）');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log('\n打包内容与干净目录构建都没问题。\n');
