#!/usr/bin/env node
/**
 * `check-site-agnostic` 的负向验证。
 *
 * 门禁查的是「本站才有的东西能不能由调用方覆盖」。这个判据很容易
 * **写得看着严、实际什么都测不到**，所以这里把它依次弄坏四次，
 * 每次都必须真的变红：
 *
 *   ① 删掉 `urlFor` 的前缀参数      → 门禁 1-1 应红
 *   ② 删掉 `urlOf` 的透传           → 门禁 1-2 应红（**签名里有不等于用上了**）
 *   ③ 删掉 `LintOptions` 的注入口    → 门禁 2-1 应红
 *   ④ 让 `lint()` 忽略该选项、退回模块级常量 → 门禁 2-2 应红
 *
 * ④ 是最关键的一条：只留选项、但调用点不传，门禁仍然该红——
 * **「声明了能力没接线」正是迭代 AK 在 JSON-LD 上踩过的同一个坑**。
 *
 * 跑法：`npm run verify:site-mutations`
 *
 * 放在 `scripts/` 而不是 `.verify/`，因为后者被 `.gitignore` 忽略、
 * 也会被 `npm run clean` 清掉——**放那儿它就等于没写**，CI 上根本跑不到。
 * 退出码 0 = 四次变异都真的报出来了（这道负向验证才成立）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

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

const original = {
  graph: readFileSync(lib('graph.ts'), 'utf8'),
  lint: readFileSync(lib('lint.ts'), 'utf8'),
};

const restore = () => {
  writeFileSync(lib('graph.ts'), original.graph, 'utf8');
  writeFileSync(lib('lint.ts'), original.lint, 'utf8');
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
  const target = lib(`${key}.ts`);
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
console.log(
  allGood
    ? '四次变异都真的报出来了——这道门禁是尺子，不是装饰。'
    : '有变异没报出来——门禁有洞。',
);
console.log();
process.exit(allGood ? 0 : 1);
