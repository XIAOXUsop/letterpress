#!/usr/bin/env node
/**
 * `check-second-site-real` 的负向验证：**断言测的是契约，还是巧合？**
 *
 * 这个探针第一版有**四条断言测的是巧合**，各自都能在实现完全正确时变红——
 * 而「变红」与「测不到机制」在输出里**长得一样**：
 *
 *   - 「孤儿页恰好 3 篇」——派生结果，`audience:` 加一条声明就变 2；
 *   - 「两篇都没拿到入链」——`audience:` 给其中一篇入链就变红；
 *   - 「`audience:` 被翻译」（查「审计日志有入链」）——正文里本来就有真链接，
 *     **把 `audience:` 改名断言照样绿**；
 *   - 「至少一篇是中文 slug」/「至少一段带 §」——**只要求「有一个」**，
 *     改任意一篇都绿。
 *
 * > **一条通过但测不到机制的断言，比没有更糟**：
 * > 它让人以为那个机制被覆盖了。
 *
 * 本文件逐条注入，**每条都必须以预期的方式变红**。
 *
 * ⚠️ **这个脚本自己也栽过两次**，两次都在「注入」这一层：
 *
 * 1. 锚点漂移（`slug: retention` 后来改成了 `slug: 数据留存`），
 *    变异**根本没注入**，输出显示成「这条断言测不到那个机制」——
 *    > **「仍然绿」与「没注入」在输出里长得一样。**
 *    所以锚点没匹配时**必须显式失败**。
 * 2. 逐行匹配断言名：断言名一变长（加了「全部…数量一致」那几个字），
 *    逐行那条就失效，于是明明红了却被判成「不是预期的那一条」。
 *    → `isRed` 现在**只做全文匹配**。
 *
 * 跑法：`npm run verify:second-site-real-mutations`
 */
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const GATE = join(ROOT, 'scripts/check-second-site-real.mjs');
const FIXTURE_DIR = join(ROOT, 'knowledge', 'fixtures', 'second-site');

const runGate = () => {
  try {
    const out = execFileSync('node', [GATE], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return { red: false, out };
  } catch (e) {
    return { red: true, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

const files = readdirSync(FIXTURE_DIR).filter((f) => /\.md$/.test(f));
const originals = new Map();
for (const f of files) originals.set(join(FIXTURE_DIR, f), readFileSync(join(FIXTURE_DIR, f), 'utf8'));

const restore = () => {
  for (const [full, text] of originals) writeFileSync(full, text, 'utf8');
};

/** 门禁的某条断言变红了没——**只做全文匹配**（理由见文件头）。 */
const isRed = (out, pattern) => out.includes('✗') && pattern.test(out);

const MUTATIONS = [
  {
    name: '① 映射层不再翻译 audience:（改成 related）',
    file: '数据留存.md',
    expect: /audience: 被翻译成关系/,
    apply: (t) => t.replace('audience: [', 'related: ['),
  },
  {
    name: '② 一篇文档缺 summary（映射层得自己补的那个字段）',
    file: '访问控制.md',
    expect: /全部文档有 summary/,
    apply: (t) => t.replace(/^summary: .*$/m, 'summary: ""'),
  },
  {
    /*
     * ③ 改**文件名**而不是 `slug:` 字段。
     *
     * ⚠️ 第一版改的是 `slug: xxx` —— 而 `readContentPage` **不读那个字段**
     * （它按文件名给 slug），于是变异**注入成功、断言照样绿**，
     * 看起来像「这条断言测不到机制」。
     *
     * > **它测的机制压根不在那儿。** 断言测的是「中文文件名被原样保留」，
     * > 所以要破坏它就得改文件名。
     * > 而「改文件名」是 git mv 级别的操作，这里靠「复制成新名 + 删原件」模拟。
     */
    name: '③ 文件名改成 ASCII（中文 slug 那条路径不再被覆盖）',
    renameTo: (f) => f.replace(/[一-龥]/g, '').replace(/^-+|-+$/g, '') + '.md',
    // ⚠️ 断言名在迭代 AS 改过（「原样保留」→「被保留，且每个都与 resolveSlug 一致」）。
    //    写死旧名会让「红了但不是预期那条」——那正是本脚本要防的情况。
    //    **判据用断言名的稳定片段**，而不是整句（整句一改就会漂）。
    expect: /中文 slug/,
    apply: () => '', // 用改名实现，不用内容变形
  },
  {
    name: '④ 全部 § 编号章节改成普通小节名',
    all: true,
    requireAll: true,
    expect: /§ 编号章节全部被切进段落/,
    apply: (t) => t.replace(/^## §\d+\s*(.+)$/gm, '## $1'),
  },
  {
    name: '⑤ 制造一个断链（改掉一个 [[链接]] 目标）',
    file: '审计日志.md',
    expect: /0 个断链/,
    apply: (t) => t.replace('[[数据留存]]', '[[根本不存在的页面]]'),
  },
  {
    name: '⑥ 删掉唯一的歧义引用（那条 [[导出]]）',
    file: '导出-总览.md',
    expect: /引用打向歧义标题/,
    apply: (t) => t.replace('在正文里写 [[导出]] 时', '在正文里写「导出」两个字时'),
  },
  {
    /*
     * ⑧ 去掉 `Export Notes.md` 的显式 `slug:`——
     *    于是 read-page 该退回「文件名经 slugify」。
     *
     * > 这一条对着迭代 AS 修的那个缺口：
     * > 修之前它会让 `slug 走 resolveSlug` 与「中文 slug」两条都红。
     * > 修之后**不该**红——因为没有显式 slug 时两侧本来就该一致。
     * > **「不该红」也是一条判据**：它证明修复没有把显式分支一起废掉。
     */
    name: '⑧ 去掉显式 slug（应当仍绿——证明修复保留了默认分支）',
    file: 'Export Notes.md',
    expectRed: false,
    apply: (t) => t.replace(/^slug: .*$/m, 'title: 导出说明'),
  },
  {
    name: '⑦ 两篇同名标题改成不同名（歧义那条路径不再被覆盖）',
    file: '导出-格式细节.md',
    expect: /同名标题进了 ambiguousTitles/,
    apply: (t) => t.replace('title: 导出', 'title: 导出格式细节'),
  },
];

let allGood = true;
console.log('check-second-site-real 的负向验证（断言测的是契约还是巧合）');
console.log('─'.repeat(64));

if (runGate().red) {
  console.log('  ✗ 干净状态下门禁就是红的——先修那个，本轮验证没有意义');
  process.exit(1);
}
console.log('  ✓ 干净状态：绿\n');

for (const m of MUTATIONS) {
  /*
   * `renameTo` 那一类靠**改文件名**实现注入（slug 就是文件名，见 ③ 的说明）。
   * 改完必须还原——而还原是**删掉新文件 + 把原名写回去**。
   */
  if (m.renameTo) {
    const restored = [];
    try {
      for (const f of files) {
        const to = m.renameTo(f);
        if (to === f) continue;
        const from = join(FIXTURE_DIR, f);
        const toFull = join(FIXTURE_DIR, to);
        writeFileSync(toFull, originals.get(from), 'utf8');
        rmSync(from);
        restored.push({ from, to: toFull });
      }
      if (restored.length === 0) {
        console.log(`  ✗ ${m.name}：没有任何文件被改名（锚点全漂了）`);
        allGood = false;
        continue;
      }
      const { red, out } = runGate();
      for (const r of restored) {
        writeFileSync(r.from, originals.get(r.from), 'utf8');
        rmSync(r.to, { force: true });
      }
      if (!red) {
        console.log(`  ✗ ${m.name} → **仍然绿**，这条断言测不到那个机制`);
        allGood = false;
      } else if (isRed(out, m.expect)) {
        console.log(`  ✓ ${m.name} → 红了（命中预期的那一条断言）`);
      } else {
        console.log(`  ✗ ${m.name} → 红了，但**不是预期的那一条**——这次验证不算数`);
        const lines = out.split('\n').filter((l) => l.includes('✗')).join(' / ');
        console.log(`      实际报的是：${lines.slice(0, 200)}`);
        allGood = false;
      }
    } finally {
      restore();
      for (const f of readdirSync(FIXTURE_DIR)) {
        const expected = files.includes(f);
        if (!expected) rmSync(join(FIXTURE_DIR, f), { force: true });
      }
    }
    continue;
  }

  const targets = m.all ? [...originals.keys()] : [join(FIXTURE_DIR, m.file)];
  const applicable = targets.filter((full) => m.apply(originals.get(full)) !== originals.get(full));
  if (applicable.length === 0) {
    console.log(`  ✗ ${m.name}：**没有任何文件能注入**（锚点全漂了）——这不是「门禁有洞」`);
    allGood = false;
    continue;
  }

  let injected = 0;
  for (const full of applicable) {
    writeFileSync(full, m.apply(originals.get(full)), 'utf8');
    injected++;
  }
  if (injected !== applicable.length) {
    console.log(`  ✗ ${m.name}：只注入了 ${injected}/${applicable.length} 个——按没注入处理`);
    restore();
    allGood = false;
    continue;
  }

  const { red, out } = runGate();
  restore();

  /*
   * `expectRed: false` 表示**「不该红」也是一条判据**。
   * 那用来验证「修复没有顺手废掉另一条分支」——
   * 只验「该红时红了」会漏掉「把整个机制删了也能通过」。
   */
  if (m.expectRed === false) {
    if (red) {
      console.log(`  ✗ ${m.name} → **变红了**，而它不该红（说明修复动错了分支）`);
      const lines = out.split('\n').filter((l) => l.includes('✗')).join(' / ');
      console.log(`      报的是：${lines.slice(0, 200)}`);
      allGood = false;
    } else {
      console.log(`  ✓ ${m.name} → 仍然绿（预期如此）`);
    }
    continue;
  }

  if (!red) {
    console.log(`  ✗ ${m.name} → **仍然绿**，这条断言测不到那个机制`);
    allGood = false;
  } else if (isRed(out, m.expect)) {
    console.log(`  ✓ ${m.name} → 红了（命中预期的那一条断言）`);
  } else {
    console.log(`  ✗ ${m.name} → 红了，但**不是预期的那一条**——这次验证不算数`);
    const lines = out.split('\n').filter((l) => l.includes('✗')).join(' / ');
    console.log(`      实际报的是：${lines.slice(0, 200)}`);
    allGood = false;
  }
}

restore();
if (runGate().red) {
  console.log('\n  ✗ 恢复后仍然红——fixture 没还原干净，本轮结论不作数');
  process.exit(1);
}
console.log('  ✓ 恢复后：绿（fixture 已还原）\n');
console.log(
  allGood
    ? `${MUTATIONS.length} 种破坏都真的以预期的方式报了出来——这些断言测的是契约，不是巧合。`
    : '有破坏没按预期报出来——至少有一条断言测的是巧合。',
);
console.log();
process.exit(allGood ? 0 : 1);
