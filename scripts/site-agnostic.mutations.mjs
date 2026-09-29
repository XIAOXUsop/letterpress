#!/usr/bin/env node
/**
 * `check-site-agnostic` 的负向验证。
 *
 * 门禁查的是「本站才有的东西能不能由调用方覆盖」。这个判据很容易
 * **写得看着严、实际什么都测不到**，所以这里把每条判据依次弄坏，
 * 每次都必须真的变红：
 *
 *   ① 删掉 `urlFor` 的前缀参数      → 门禁「知识库 URL 前缀」应红
 *   ② 删掉 `urlOf` 的透传           → 同上（**签名里有不等于用上了**）
 *   ③ 删掉 `LintOptions` 的注入口    → 门禁「根层保留路由表」应红
 *   ④ 让 `lint()` 忽略该选项、退回模块级常量 → 同上
 *   ⑤ 把 `toDoc` 改回写死 `data.related` → 门禁「关系声明的字段名」应红
 *   ⑥ 改 `site.wiki.relationField` 而不改 zod schema → 同上（关系会静默全丢）
 *
 * ④ 是最关键的一条：只留选项、但调用点不传，门禁仍然该红——
 * **「声明了能力没接线」正是迭代 AK 在 JSON-LD 上踩过的同一个坑**。
 *
 * ⑤ 守的是 2026-09-28 新增的那条判据：构建侧的关系字段名此前写死，
 * 而读路径那侧已经是 `relationField` 参数——**同一件事，一处能配一处不能**。
 *
 * ⑥ 守的是它**剩下的一半**：zod schema 必须是静态字面量（否则 Astro
 * 推不出 `data` 的类型），所以**改配置必须同时改 schema**，
 * 而忘了改的后果是**关系静默全丢、构建成功、所有门禁全绿**。
 *
 * 跑法：`npm run verify:site-mutations`
 *
 * 放在 `scripts/` 而不是 `.verify/`，因为后者被 `.gitignore` 忽略、
 * 也会被 `npm run clean` 清掉——**放那儿它就等于没写**，CI 上根本跑不到。
 * 退出码 0 = 每次变异都真的报出来了（这道负向验证才成立）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureWorktree, diffWorktree } from './lib/worktree-assert.mjs';

/** 跑之前的工作区——收尾断言要与它比，而不是与「空」比。 */
const WORKTREE = captureWorktree();

const ROOT = process.cwd();
const GATE = join(ROOT, 'scripts/check-site-agnostic.mjs');
/*
 * ⚠️ **文件名要带 `.ts` 后缀。**
 *
 * 2026-09-24 踩过：`lib()` 收到的是 `'graph'`（无后缀）而不是 `'graph.ts'`，
 * 于是 `writeFileSync` 写出了一个**没有扩展名的 `src/lib/wiki/graph`**，
 * 而门禁读的 `graph.ts` **从未被改动**——
 * 四次变异「全部不生效」，看起来像门禁有洞。
 *
 * > **症状与「门禁坏了」完全一样**：注入成功、门禁全绿。
 * > 唯一能分辨的办法是**打印绝对路径**——
 * > 逐字比对锚点、验 cwd、验 `writeFileSync` 都对，因为它们都在验证「前提」，
 * > 而真凶是「写到了别处」。**查「量出来不对」时，第一反应应该是「尺子不对」。**
 */
const lib = (name) => join(ROOT, 'src/lib/wiki', name);
/**
 * ⚠️ **2026-09-28 加 `content`：`src/lib/content.ts` 不在 `wiki/` 下面。**
 *
 * 它带着第三条「关系声明的字段名」判据（`toDoc` 要按 `site.wiki.relationField` 读），
 * 而**每条判据都必须有对应的变异**——那是 `check-gate-list` 强制的。
 */
const libOf = (key) => (key === 'content'
  ? join(ROOT, 'src/lib/content.ts')
  : key === 'config'
    ? join(ROOT, 'src/config.ts')
    : lib(`${key}.ts`));

const original = {
  graph: readFileSync(lib('graph.ts'), 'utf8'),
  lint: readFileSync(lib('lint.ts'), 'utf8'),
  content: readFileSync(join(ROOT, 'src/lib/content.ts'), 'utf8'),
  config: readFileSync(join(ROOT, 'src/config.ts'), 'utf8'),
};

/*
 * ⚠️ **按 `original` 的键遍历还原，不要一个个写。**
 *
 * 第一版是 `writeFileSync(lib('graph.ts'), …); writeFileSync(lib('lint.ts'), …);`——
 * 于是 2026-09-28 加了 `content` 这个 key 之后**还原漏了它**，
 * 表现是「恢复后仍然红」，而那正是本脚本自己的判据在报警。
 *
 * > **加一个 key 时，改「读它的地方」而漏了「还原它的地方」**——
 * > 与 2026-09-28 那次「CORE 名单加了模块但没加判据」是同一族。
 */
const restore = () => {
  for (const key of Object.keys(original)) {
    writeFileSync(libOf(key), original[key], 'utf8');
  }
};

const runGate = () => {
  let status = null;
  let out = '';
  try {
    out = execFileSync('node', [GATE], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    status = 0;
  } catch (e) {
    status = typeof e.status === 'number' ? e.status : -1;
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  if (process.env.MUTATE_DEBUG) {
    console.log(`      [debug] status=${status} 输出前 80 字=${JSON.stringify(out.slice(0, 80))}`);
  }
  return { red: status !== 0, out };
};

const patch = (key, find, replace) => {
  if (!original[key].includes(find)) return null;
  const target = libOf(key);
  const out = original[key].replace(find, replace);
  writeFileSync(target, out, 'utf8');
  if (process.env.MUTATE_DEBUG) {
    const onDisk = readFileSync(target, 'utf8');
    console.log(`      [debug] 写入 ${target}`);
    console.log(`      [debug]   落盘后确实含变异=${onDisk.includes(replace)}（不打印则本脚本毫无意义）`);
  }
  return true;
};

const MUTATIONS = [
  {
    name: '① 删掉 urlFor 的前缀参数',
    expectRed: true,
    apply: () =>
      patch(
        'graph',
        `export function urlFor(
  kind: Doc['kind'],
  slug: string,
  prefixes: UrlPrefixes = DEFAULT_URL_PREFIXES,
): string {`,
        `export function urlFor(kind: Doc['kind'], slug: string): string {\n  const prefixes = DEFAULT_URL_PREFIXES;`,
      ),
  },
  {
    name: '② 删掉 urlOf 的透传',
    expectRed: true,
    apply: () =>
      patch(
        'graph',
        'export function urlOf(doc: Doc, prefixes: UrlPrefixes = DEFAULT_URL_PREFIXES): string {\n  return urlFor(doc.kind, doc.slug, prefixes);',
        'export function urlOf(doc: Doc): string {\n  return urlFor(doc.kind, doc.slug);',
      ),
  },
  {
    name: '③ 删掉 LintOptions 的注入口',
    expectRed: true,
    apply: () =>
      patch(
        'lint',
        '  readonly reservedPostRoutes?: ReadonlyMap<string, string>;',
        '  readonly reservedPostRoutesUnused?: never;',
      ),
  },
  {
    name: '④ 选项留着但调用点不传（声明了能力没接线）',
    expectRed: true,
    apply: () =>
      patch(
        'lint',
        '    ...checkReservedPostRoutes(docs, opts.reservedPostRoutes ?? DEFAULT_RESERVED_POST_ROUTES),',
        '    ...checkReservedPostRoutes(docs, DEFAULT_RESERVED_POST_ROUTES),',
      ),
  },
  {
    /**
     * ⚠️ **2026-09-28 新增。**
     *
     * `toDoc` 原先写死 `(data as { related?: string[] }).related`——
     * **而读路径那侧已经是 `relationField` 参数**。同一件事，一处能配一处不能，
     * 就是一个站点换字段名时**构建侧要改代码而读路径不用**。
     *
     * 这一条把 `toDoc` 改回写死的形式，断言门禁会红。
     */
    // 目标文件：`../content.ts`（相对 `src/lib/wiki/` 的路径技巧，见 libOf）
    name: '⑤ toDoc 改回写死 data.related（构建侧失去字段名注入口）',
    expectRed: true,
    apply: () =>
      patch(
        'content',
        '  const relationValues = (data as Record<string, unknown>)[site.wiki.relationField];',
        '  const relationValues = (data as { related?: string[] }).related;',
      ),
  },
  {
    /**
     * ⚠️ **2026-09-28 新增。**
     *
     * 「改了 `site.wiki.relationField` 忘了改 zod schema」的后果是**静默的**：
     * zod 把那个键剥掉 → `toDoc` 读到 `undefined` → **关系全丢**，
     * 而构建成功、lint 通过、所有门禁全绿。
     *
     * 所以这一条把配置改成 `audience`（zod 仍声明 `related`），
     * 断言 `check-site-agnostic` 会红。
     */
    name: '⑥ 配置改了字段名而 zod 没改（关系会静默全丢）',
    expectRed: true,
    apply: () =>
      patch(
        'config',
        "    relationField: 'related',",
        "    relationField: 'audience',",
      ),
  },
];

let allGood = true;
console.log('check-site-agnostic 的负向验证');
console.log('─'.repeat(64));

if (runGate().red) {
  console.log('  ✗ 干净状态下门禁就是红的——先修那个，这轮验证没有意义');
  process.exit(1);
}
console.log('  ✓ 干净状态：绿\n');

for (const m of MUTATIONS) {
  const injected = m.apply();
  if (process.env.MUTATE_DEBUG) console.log(`      [debug] apply() 返回 ${JSON.stringify(injected)}`);
  if (injected !== true) {
    console.log(`  ✗ ${m.name}：锚点找不到，变异没注入（门禁判据或源码已漂）`);
    allGood = false;
    restore();
    continue;
  }
  if (process.env.MUTATE_DEBUG) {
    const g = readFileSync(lib('graph.ts'), 'utf8');
    const l = readFileSync(lib('lint.ts'), 'utf8');
    console.log(
      `      [debug] 写盘后 graph 有 urlFor 三参=${/export function urlFor\(\s*kind: Doc\['kind'\],\s*slug: string,\s*prefixes: UrlPrefixes\s*=/.test(g)}` +
        ` lint 有注入口=${/readonly reservedPostRoutes\?: ReadonlyMap<string, string>;/.test(l)}` +
        ` lint 调用点传 opts=${/checkReservedPostRoutes\(docs,\s*opts\.reservedPostRoutes/.test(l)}`,
    );
  }
  const { red, out } = runGate();
  restore();
  const which = red ? (out.match(/(graph|lint)\.ts\s+[^：\n]*：没有注入口/) ?? [''])[0].trim() : '';
  if (red === m.expectRed) {
    console.log(`  ✓ ${m.name} → ${red ? '红了' : '仍然绿'}${which ? `（命中「${which}」）` : ''}`);
  } else {
    console.log(`  ✗ ${m.name} → ${red ? '红了' : '仍然绿'}，与预期不符`);
    allGood = false;
  }
}

if (runGate().red) {
  console.log('\n  ✗ 恢复后仍然红——源码没还原干净，这轮结论不作数');
  process.exit(1);
}
console.log('  ✓ 恢复后：绿（源码已还原）\n');
/*
 * 收尾断言见 `lib/worktree-assert.mjs` 的文件头。
 *
 * ⚠️ **本脚本此前只问「被测门禁还绿吗」，不问「我改了什么」**——
 * 而这两件事在输出上完全一样。
 * 所以上面那句「源码已还原」**只对 `graph.ts` / `lint.ts` 成立**，
 * 而「我顺手在别处留下的东西」它永远看不见。
 */
{
  const { ok, report } = diffWorktree(WORKTREE);
  if (!ok) { console.log(report); allGood = false; }
  else console.log(report);
}
console.log(
  allGood
    ? `${MUTATIONS.length} 次变异都真的报出来了——这道门禁是尺子，不是装饰。`
    : '有变异没报出来——门禁有洞。',
);
console.log();
process.exit(allGood ? 0 : 1);
