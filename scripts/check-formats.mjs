#!/usr/bin/env node
/**
 * 内容格式探针：README 宣称支持的每一种格式，都必须真的能产出页面。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────
 *
 * 这个检查是**踩坑之后补的**：`@astrojs/mdx` 装在 `package.json` 里、
 * `content.config.ts` 的 glob 也匹配 mdx、README 写着
 * 「Markdown / **MDX**」——**但 `astro.config.mjs` 里从没注册过 `mdx()`**。
 *
 * 后果是：放进一个 `.mdx` 文件，构建成功、退出码 0，而文章在产物里
 * **根本不存在**、首页也不列。**不报错、不失败，只是消失**——
 * 而这恰恰是这个项目反复强调的头号敌人。
 *
 * 所以断言必须是：**真的放一个 `.mdx` 进去，构建，看它有没有变成页面**。
 * 读配置不够——配置可以是对的而接线是断的，这次就是。
 *
 * 用法：`npm run verify:formats`
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const probeDir = join(root, 'src', 'content', 'posts');

/** 探针文件。slug 带前缀，避免与真实内容撞名。 */
const PROBES = [
  {
    file: 'zprobe-markdown-format.md',
    label: 'Markdown',
    body: '---\ntitle: 格式探针 Markdown\nsummary: 验证 .md 能产出页面。\ndate: 2026-01-01\n---\n\n正文。\n',
    expect: 'zprobe-markdown-format/index.html',
  },
  {
    file: 'zprobe-mdx-format.mdx',
    label: 'MDX',
    body: '---\ntitle: 格式探针 MDX\nsummary: 验证 .mdx 能产出页面。\ndate: 2026-01-01\n---\n\n# 标题\n\n正文，含一个表达式：{1 + 1}\n',
    expect: 'zprobe-mdx-format/index.html',
  },
];

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: 'inherit', // 构建失败时能看到原因，否则只能靠猜
      shell: process.platform === 'win32',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

console.log('\n内容格式探针');
console.log('─'.repeat(64));

const problems = [];

try {
  // 放探针
  await mkdir(probeDir, { recursive: true });
  for (const probe of PROBES) {
    await writeFile(join(probeDir, probe.file), probe.body, 'utf8');
  }
  console.log(`\n放入 ${PROBES.length} 个探针文件，构建…`);

  // 干净的构建：不要被上一次的产物骗到
  await rm(join(root, '.astro'), { recursive: true, force: true });
  await rm(dist, { recursive: true, force: true });

  const code = await run('npx', ['astro', 'build']);
  if (code !== 0) {
    problems.push(`探索构建失败（退出码 ${code}）`);
  }

  // 逐个检查是否真的产出了页面
  for (const probe of PROBES) {
    let found = true;
    try {
      await readFile(join(dist, probe.expect));
    } catch {
      found = false;
    }

    if (found) {
      console.log(`  ✓ ${probe.label} 产出了页面`);
    } else {
      problems.push(
        `${probe.label} 声明支持但没有产出页面（期望 /${probe.expect}）——` +
          `构建成功、退出码 0，内容凭空消失`,
      );
      console.log(`  ✗ ${probe.label} 没有产出页面`);
    }
  }
} finally {
  // 无论如何都要清掉探针，别把它们留在仓库里
  for (const probe of PROBES) {
    await rm(join(probeDir, probe.file), { force: true });
  }
  await rm(join(root, '.astro'), { recursive: true, force: true });
  await rm(dist, { recursive: true, force: true });
  console.log('\n探针已清理（内容层缓存与产物也一并清掉，避免污染后续构建）');
}

console.log('\n' + '─'.repeat(64));
if (problems.length === 0) {
  console.log('内容格式探针通过。\n');
} else {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log('');
}
process.exitCode = problems.length === 0 ? 0 : 1;
