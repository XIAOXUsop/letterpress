#!/usr/bin/env node
/**
 * **`AGENTS.md` 里每一个含可证伪声明的小节，都必须有一道门禁在核它。**
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 2026-09-28 实测：`AGENTS.md` 有 **13 个小节**，其中 **5 个含可证伪声明**，
 * 而 `check:agents-doc` 只核 **4 组**。
 *
 * > 剩下那 5 个小节的声明**恰好都有门禁在核**（`check:rule-levels` 核级别列、
 * > `check:onboarding-doc` 核命令名、`check:agents-doc` 核规则集）——
 * > **所以没有真缺口**。但那是**我手工读完 13 个小节才知道的**，
 * > **而那不会重复发生**——下一个人不会读。
 *
 * 所以把「全部」变成**可机械判定的事**：一张
 * 「小节 → 哪道门禁核它」的对照表，缺项就红。
 *
 * ── 判据的关键：不能把「散文小节」也算成缺口 ────────────────────────
 *
 * 13 个小节里 **8 个是散文**（「你可以做而机械检查做不到的事」「不要做的事」…），
 * 它们**本来就没有可证伪的声明**，所以「没有门禁核它们」是**对的**，不是缺口。
 *
 * > **把散文算成缺口，会逼着人给散文配门禁**——
 * > 而那正是「判据太宽就变成噪声，噪声让人忽略真信号」。
 * > 所以「有没有可证伪声明」这一步判据要**窄**：只认机器能判真假的标记
 * > （规则名 / 命令名 / frontmatter 字段 / 「会让构建失败」这类行为断言）。
 *
 * ⚠️ **标记表本身就是一份手写清单**——而「手写清单必然漏」是本仓库栽过四次的形态。
 * 所以：**「没匹配到任何标记」的小节不报**（它可能是散文，也可能是标记表漏了），
 * **而「匹配到标记却没有门禁核」才报**——后者是确定的缺口。
 * 标记表的局限写在下面的 `MARKERS` 注释里。
 *
 * 用法：`node scripts/check-agents-coverage.mjs`
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const problems = [];

console.log('AGENTS.md 的声明覆盖率');
console.log('─'.repeat(64));

const lines = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8').split('\n');

/** 小节：标题 + 起止行。 */
const sections = [];
lines.forEach((l, i) => {
  const m = /^(##|###) (.+)$/.exec(l);
  if (m) sections.push({ title: m[2], start: i + 1, end: Infinity });
});
for (let i = 0; i < sections.length - 1; i++) sections[i].end = sections[i + 1].start - 1;
if (sections.length > 0) sections[sections.length - 1].end = lines.length;

if (sections.length === 0) {
  console.error('AGENTS.md 里一个 `##` / `###` 标题都没解析到——本检查什么都没量。');
  process.exit(1);
}

/**
 * 「这个���节里有可证伪声明」的标记。
 *
 * ⚠️ **它是窄的，而且必须窄**：散文小节不该被算成缺口。
 * ⚠️ **它也是不完整的**：漏掉的标记会让某个小节**被当成散文**而静默通过——
 * 那正是本检查要防的同一族（形态四），**且这里无法自查**
 * （判据就是「有没有匹配到标记」，用标记判标记）。
 * **缓解：每加一个标记就补一条变异**，让「标记表本身漏了」至少在 CI 里被看见。
 */
const MARKERS = [
  { re: /`[a-z]+(?:-[a-z]+)+`/, what: 'kebab-case 标识符（规则名 / 字段名）' },
  { re: /`npm run [\w:-]+`/, what: '命令' },
  { re: /^\s*\w+:/m, what: 'frontmatter 字段' },
  { re: /会让构建失败|已实现|尚未实现|计划中/, what: '行为断言' },
];

/**
 * 每道门禁核哪一类声明。
 *
 * ⚠️ **这里写的是「哪一道核它」，不是「哪一行核它」**——
 * 门禁的内部结构会变，而「谁负责哪一类」是稳定的契约。
 * ⚠️ **改这张表等于改「什么算已被核」**——而那正是本检查的覆盖面。
 *    所以**下表里出现的每个门禁都必须在 `package.json` 里有定义**（下面会核）。
 *
 * ⚠️⚠️ **2026-09-28 第一版漏了 `frontmatter 字段` 那一类，于是两节被判成 ✓
 * 而后面是空的**（「写一个知识层条目」「『没有来源』有两种含义」）。
 *
 * > **那正是本检查要防的形状，我自己犯了**：一个「没有归属」的声明类别
 * > **静默通过**，因为 `missing` 只在「OWNERS 命中且门禁不存在」时才报。
 * >
 * > **「匹配到了标记、却找不到任何门禁」必须是红的**——
 * > 哪怕 OWNERS 里压根没这一类，那也意味着**没人认领它**。
 */
const OWNERS = [
  { re: /`[a-z]+(?:-[a-z]+)+`/, gate: 'check:agents-doc', why: '规则名 / 标识符' },
  { re: /会让构建失败|已实现|尚未实现|计划中/, gate: 'check:rule-levels', why: '行为断言' },
  { re: /`npm run [\w:-]+`/, gate: 'check:onboarding-doc', why: '命令名' },
  {
    re: /^\s*\w+:/m,
    gate: 'check:field-coverage',
    why: 'frontmatter 字段（读路径读得到构建侧读的那些）',
  },
];

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const defined = new Set(Object.keys(pkg.scripts ?? {}));

// OWNERS 里引用的门禁必须真的存在，否则「已核」是自己说的
for (const o of OWNERS) {
  if (!defined.has(o.gate)) {
    problems.push(
      `OWNERS 说 \`${o.gate}\` 核「${o.why}」，而 \`package.json\` 里没有这个脚本。\n`
      + '    → **「已核」是自己说的**。先把门禁补上，或改这张表。',
    );
    console.log(`  ✗ OWNERS 引用了不存在的门禁 ${o.gate}`);
  }
}

let withClaims = 0;
const unowned = [];
for (const s of sections) {
  const body = lines.slice(s.start - 1, s.end).join('\n');
  const hit = MARKERS.filter((m) => m.re.test(body));
  if (hit.length === 0) continue; // 散文小节——**不算缺口**
  withClaims++;
  const owners = OWNERS.filter((o) => hit.some((h) => h.re.source === o.re.source));
  const missing = owners.filter((o) => !defined.has(o.gate));
  /*
   * ⚠️ **「匹配到标记、却没有任何门禁认领」也要红**（2026-09-28 第一版的漏洞）。
   *
   * 第一版只在「OWNERS 命中、但那个门禁不存在」时报错，于是
   * **OWNERS 里压根没有的类别**（`frontmatter 字段`）会**静默通过**——
   * 输出是 `✓ 写一个知识层条目：frontmatter 字段 → `，**箭头后面什么都没有**，
   * 而那行读起来像「已核」。
   *
   * > **一个类别没有归属，与一个门禁不存在，是同一件事的两种说法。**
   * > 而**空白的归属**比「明确写了错的归属」更隐蔽——
   * > 后者至少有东西可看。
   */
  const unclaimed = hit.filter((h) => !owners.some((o) => o.re.source === h.re.source));
  if (missing.length > 0 || unclaimed.length > 0) {
    unowned.push({ ...s, hit, missing, unclaimed });
    const why = [
      ...missing.map((m) => `${m.gate} 不存在`),
      ...unclaimed.map((u) => `「${u.what}」无门禁认领`),
    ].join('、');
    console.log(`  ✗ ${s.title}：${hit.map((h) => h.what).join('、')} —— ${why}`);
  } else {
    console.log(
      `  ✓ ${s.title}：${hit.map((h) => h.what).join('、')}`
      + ` → ${owners.map((o) => o.gate).join('、')}`,
    );
  }
}

for (const u of unowned) {
  problems.push(
    `「${u.title}」里有可证伪的声明（${u.hit.map((h) => h.what).join('、')}），`
    + `而${[
      ...u.missing.map((m) => `门禁 \`${m.gate}\` 压根不存在`),
      ...u.unclaimed.map((x) => `**「${x.what}」这一类没有任何门禁认领**`),
    ].join('；')}。\n`
    + '    → 在 `OWNERS` 里登记归属（或让那个门禁真的存在）。\n'
    + '    **这一节是给 agent 读的**——它与代码不符时，agent 会照着错的改。\n'
    + '    ⚠️ 而「无主」比「有错的归属」更隐蔽：后者至少有东西可看。',
  );
}

console.log(
  `\n${sections.length} 个小节，${withClaims} 个含可证伪声明，`
  + `${withClaims - unowned.length} 个有门禁核。`,
);

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log('每个含可证伪声明的小节都有门禁在核。\n');
