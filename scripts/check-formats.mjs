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
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

/**
 * 负向探针：它必须被内容层读取，但绝不能出现在任何发布出口。
 * 只检查「某个页面不存在」不够——草稿曾经同时泄漏到页面、孪生文件、OG、
 * 列表、RSS、sitemap 与 llms 文件，而构建仍然是绿色的。
 */
const DRAFT_PROBE = {
  file: 'zprobe-draft-must-not-ship.md',
  slug: 'zprobe-draft-must-not-ship',
  marker: 'DRAFT_PROBE_MUST_NOT_SHIP',
  body: '---\ntitle: DRAFT_PROBE_MUST_NOT_SHIP\nsummary: 这条内容只用于验证草稿隔离。\ndate: 2026-01-01\ndraft: true\n---\n\nDRAFT_PROBE_MUST_NOT_SHIP\n',
};

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
  await writeFile(join(probeDir, DRAFT_PROBE.file), DRAFT_PROBE.body, 'utf8');
  console.log(`\n放入 ${PROBES.length} 个格式探针和 1 个草稿隔离探针，构建…`);

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

  const forbiddenOutputs = [
    join(dist, DRAFT_PROBE.slug, 'index.html'),
    join(dist, `${DRAFT_PROBE.slug}.md`),
    join(dist, 'og', `${DRAFT_PROBE.slug}.png`),
  ];
  const leakedFiles = [];
  for (const full of forbiddenOutputs) {
    try {
      await readFile(full);
      leakedFiles.push(full.slice(dist.length + 1));
    } catch {
      // 正确：没有生成草稿产物
    }
  }

  for (const relative of await readdir(dist, { recursive: true })) {
    if (!/\.(?:html|md|txt|xml|json)$/i.test(relative)) continue;
    const full = join(dist, relative);
    try {
      const text = await readFile(full, 'utf8');
      if (text.includes(DRAFT_PROBE.marker)) leakedFiles.push(relative);
    } catch {
      // 目录或非文本产物不参与内容泄漏检查
    }
  }

  if (leakedFiles.length === 0) {
    console.log('  ✓ 草稿没有进入页面、孪生文件、OG 或任何文本出口');
  } else {
    const unique = [...new Set(leakedFiles)];
    problems.push(`草稿泄漏到 ${unique.join('、')}`);
    console.log(`  ✗ 草稿泄漏到 ${unique.join('、')}`);
  }
} finally {
  // 无论如何都要清掉探针，别把它们留在仓库里
  for (const probe of PROBES) {
    await rm(join(probeDir, probe.file), { force: true });
  }
  await rm(join(probeDir, DRAFT_PROBE.file), { force: true });
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
