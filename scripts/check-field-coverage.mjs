#!/usr/bin/env node
/**
 * **读路径必须能拿到构建侧读的那些 frontmatter 字段——用行为测，不用字面匹配。**
 *
 * ── 为什么是「行为」而不是「grep」 ──────────────────────────────────
 *
 * 第一版试图 grep 两边源码，看各自读了哪些字段。三次都失败：
 *
 * ① 构建侧的 `kind` 写成 `data as { kind?: string }`——**没被 `data.x` 那个正则认**；
 * ② 读路径的 `tags` 走 `relationList(source, 'tags')`——**不是 `frontmatterField`**；
 * ③ 加上 `data as` 之后，`sources` / `review` / `original` 全被报成「读路径不读」——
 *    **因为它们是块，靠逐行扫描解析，字面上根本不出现 `data.sources` 那样的调用**。
 *
 * > **字面匹配量的是「写法」，而契约是「拿得到」。**
 * > 一个字段可以用五种写法读，而 grep 只认其中一种。
 *
 * 所以：**造一份写满所有字段的 frontmatter，断言读路径真的拿到了。**
 *
 * ── 判据 ────────────────────────────────────────────────────────────
 *
 * 对每个字段：**写进 frontmatter → 读回来 → 断言它在那儿**。
 * `DELIBERATELY_UNREAD` 里的除外，**每一个都要能答「为什么核心不需要它」**。
 *
 * ⚠️ 顶层标量与块字段的写法不同（前者 `key: 值`、后者 `key:` 换行缩进），
 * 固件里分开写——**这正是 2026-09-28 那三处分歧的成因**（有的用块、有的没读）。
 *
 * 用法：`node scripts/check-field-coverage.mjs`
 */
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readContentPage } from '../src/lib/wiki/read-page.ts';

const ROOT = process.cwd();
const problems = [];

console.log('读路径读得到哪些 frontmatter 字段');
console.log('─'.repeat(64));

/**
 * ⚠️ **刻意不读的字段**，每条都要能答「为什么核心不需要它」。
 *
 * 加一条之前先问：**核心流程（链接图 / 体检 / 检索 / 影响分析 / 摘要）会看它吗？**
 * 会 → 补上；不会 → 留在白名单里并写清理由。
 */
const DELIBERATELY_UNREAD = new Map([
  ['cover', '封面图。核心一个都不看图，而 `Doc` 里也没有它。'],
  ['coverAlt', '封面 alt 文本，只对渲染有意义。'],
  ['ogImage', '社交卡图，同上。'],
  ['toc', '要不要显示目录——纯渲染开关。'],
  ['featured', '首页是否突出——纯展示。'],
  ['id', '**稳定身份**，走构建期那侧（`pageToDoc` 的注释里明说「不要在这里加 id」）。'],
]);

/**
 * 固件：把每种字段按**它本来的写法**写一遍。
 *
 * ⚠️ 顶层标量与块字段分开写，正是因为 2026-09-28 那三处分歧的成因
 * 就是「有的字段用块、有的被当成顶层读」。
 */
const SCALAR_FIELDS = {
  title: '读字段覆盖探针',
  slug: 'field-probe',
  summary: '这是一条用来量「读路径读得到哪些字段」的探针。',
  updated: '2026-01-02',
  date: '2026-01-01',
  kind: 'concept',
  draft: 'false',
};

const LIST_FIELDS = {
  related: '[field-probe-b]',
  tags: '[排版, css]',
};

const BLOCK_FIELDS = {
  sources: '  - sourceId: probe-source\n    revision: 2026-01-01\n    locator: §1',
  review: '  status: reviewed\n  checkedAt: 2026-01-03\n  contentDigest: abc',
  original: '  reason: 本站自己的约定',
};

/** 拼一份 frontmatter。 */
const fm = [
  ...Object.entries(SCALAR_FIELDS).map(([k, v]) => `${k}: ${v}`),
  ...Object.entries(LIST_FIELDS).map(([k, v]) => `${k}: ${v}`),
  ...Object.entries(BLOCK_FIELDS).map(([k, v]) => `${k}:\n${v}`),
].join('\n');

const dir = mkdtempSync(join(tmpdir(), 'field-cov-'));
let page;
try {
  writeFileSync(join(dir, 'probe.md'), `---\n${fm}\n---\n\n正文。\n`, 'utf8');
  page = readContentPage(dir, 'probe.md');
} finally {
  // 读完再删：page 里已经是值，删目录不影响它
}

/** 每条判据：[字段名, 读路径拿到它了吗] */
const checks = [
  ['title', page.title === SCALAR_FIELDS.title],
  ['slug', page.slug === SCALAR_FIELDS.slug],
  ['summary', page.summary === SCALAR_FIELDS.summary],
  ['updated', page.updated === SCALAR_FIELDS.updated],
  ['date', page.date === SCALAR_FIELDS.date],
  ['kind', page.kind === SCALAR_FIELDS.kind],
  ['draft', page.draft === false],
  ['related', page.related.length === 1 && page.related[0] === 'field-probe-b'],
  // ⚠️ 第一版只查 includes('排版')——**第二个元素没被看**。
  // 「切出 2 个、第一个对」与「两个都对」在输出里一样。
  ['tags', JSON.stringify(page.tags) === JSON.stringify(['排版', 'css'])],
  ['sources', page.sources.length === 1 && page.sources[0].sourceId === 'probe-source'],
  ['review', page.review?.status === 'reviewed' && page.review?.checkedAt === '2026-01-03'],
  ['original', page.original?.reason === '本站自己的约定'],
];

/*
 * ── 第 7 条：标量按 **YAML** 解析，而逐行解析器会读错的那几种写法 ──────
 *
 * ⚠️ **2026-09-28 换解析器时，第一版没有这条判据**，于是
 * 「把 `title` 退回逐行解析」这条变异**门禁照样绿**——
 * 因为原有语料里的字段**两种解析器读法完全一样**。
 *
 * > **判据没有覆盖新行为，而「读起来全绿」正是它没覆盖的证据。**
 * > 与「被测集合是空的」同族：**两边一样时，比对必然通过。**
 *
 * 所以这里造**三种只有 YAML 能读对**的写法（实测分叉，见 `read-page.ts`
 * 的 `dataOf` 注释里那张表）：
 * ① `title: 标题 # 注释` —— 逐行解析器**主动抛错**
 * ② `  title: 缩进的值` —— 逐行给 **`null`**（会被 `?? ''` 兜成空串）
 * ③ `title: 第 5 章: 冒号` —— 逐行**读成整串**，YAML 报错（这一条
 *    断言的是「YAML 会拒绝」，与前两条方向相反）
 */
{
  const d = mkdtempSync(join(tmpdir(), 'field-coverage-yaml-'));
  try {
    // ① 行内注释：YAML 读成「标题」，逐行解析器抛错
    writeFileSync(
      join(d, '注释.md'),
      '---\ntitle: 标题 # 这是注释\nslug: 注释\nsummary: 一句话。\n---\n\n正文。\n',
      'utf8',
    );
    const withComment = readContentPage(d, '注释.md');
    const commentOk = withComment.title === '标题';
    if (!commentOk) {
      problems.push(
        `标量**没有按 YAML 解析**：\`title: 标题 # 这是注释\` 读成了 `
        + `${JSON.stringify(withComment.title)}，而 YAML 应读成「标题」。\n`
        + '    → 逐行解析器在这一句上**主动抛错**，所以症状是「整篇读不出来」。',
      );
      console.log(`  ✗ 行内注释：title 读成 ${JSON.stringify(withComment.title)}（应为「标题」）`);
    } else {
      console.log('  ✓ 标量按 YAML 解析（`title: 标题 # 注释` 读成「标题」，逐行解析器会抛错）');
    }

    // ② **行内数组**：YAML 读成数组，逐行解析器给的是**原始字符串** `"[甲, 乙]"`。
    //    ⚠️ 我第一版造的是「顶层字段后面缩进的键」——**那不是合法 YAML**
    //    （`Nested mappings are not allowed in compact mappings`），
    //    于是断言崩在解析上。**第四次「我以为合法、其实不合法」的语料。**
    //    换成下面这个形状：它 100% 合法，且两种解析器的读法**必然不同**。
    writeFileSync(
      join(d, '数组.md'),
      '---\ntitle: 正常标题\nslug: 数组\nsummary: 一句话。\nrelated: [甲, 乙]\n---\n\n正文。\n',
      'utf8',
    );
    const arr = readContentPage(d, '数组.md');
    const arrayParsed = Array.isArray(arr.related) && arr.related.length === 2;
    if (!arrayParsed) {
      problems.push(
        `标量**没有按 YAML 解析**：\`related: [甲, 乙]\` 读成了 `
        + `${JSON.stringify(arr.related)}，而 YAML 应读成两项数组。\n`
        + '    → 逐行解析器给的是**原始字符串** `"[甲, 乙]"`——\n'
        + '    而 `relationList` 剥方括号后正好也能切成两项，**所以它蒙混过关了**。\n'
        + '    这就是为什么**换解析器必须由行为判据守着**：两边「都能用」时，'
        + '只有**直接看类型**才分得开。',
      );
      console.log(`  ✗ 行内数组：related 读成 ${JSON.stringify(arr.related)}（应为两项数组）`);
    } else {
      console.log('  ✓ 标量按 YAML 解析（`related: [甲, 乙]` 读成两项数组，不是字符串）');
    }
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

const readable = checks.filter(([, ok]) => ok).map(([f]) => f);
const missing = checks.filter(([, ok]) => !ok).map(([f]) => f);
const skipped = [...DELIBERATELY_UNREAD.keys()];

/*
 * ── 第 6 条：别的顶层块**不得覆盖** `sources` 里的字段（2026-09-28 实测的真 bug）
 *
 * 上一条只核「`sources` 读得到 `sourceId`」——**而「读到的是不是**这一条**的
 * `revision`」是另一回事**。
 *
 * 实测的 bug：逐行扫 `sources` 时规则是「`if (!current) continue`」，
 * 而那只在**还没开始**时跳过。于是**一旦进了某一条 `sources`**，
 * 后面**任何块**里的 `revision:` / `locator:` 都会**覆盖当前那一条**：
 *
 *   sources:
 *     - sourceId: css-values-4
 *       revision: WD-20240312        ← 真正的值
 *   review:
 *     revision: 不该出现在这里        ← 读出来的是这个
 *
 * > **症状是静默的**：来源的版本日期变成别人的值，**而它不报错**。
 * > 现有 5 篇内容**恰好没受害**（它们的 `review:` 里没有 `revision:`），
 * > **但那是因为运气，不是设计**。
 *
 * ⚠️ 而这一条是**行为判据**：造一份带污染的 frontmatter，读回来，
 * 断言 `revision` 仍是**它自己的值**。**不是 grep 源码**——
 * 逐行扫描的写法千变万化，字面匹配量不到。
 */
{
  const polluted = mkdtempSync(join(tmpdir(), 'field-coverage-'));
  try {
    writeFileSync(
      join(polluted, '污染.md'),
      `---\ntitle: 污染\nslug: 污染\nsummary: 一句话。\n`
      + `sources:\n  - sourceId: css-values-4\n    revision: WD-20240312\n    locator: §5.1.1\n`
      + `review:\n  status: reviewed\n  revision: 不该出现在这里\n---\n\n正文。\n`,
      'utf8',
    );
    const p = readContentPage(polluted, '污染.md');
    const own = p.sources[0]?.revision === 'WD-20240312';
    const locatorOwn = p.sources[0]?.locator === '§5.1.1';
    if (own && locatorOwn) {
      console.log('  ✓ sources 不被别的顶层块覆盖（造了带污染的 frontmatter，读回来源自己的值）');
    } else {
      problems.push(
        `\`sources\` 里的 \`revision\`/\`locator\` **被别的顶层块覆盖了**——`
        + `读出来是 ${JSON.stringify({ revision: p.sources[0]?.revision, locator: p.sources[0]?.locator })}。\n`
        + '    → 症状**静默**：来源的版本日期变成别人的值，而它不报错。\n'
        + '    2026-09-28 实测过：逐行扫 `sources` 时若不限定「只扫该块内」，'
        + '后面任何块的 `revision:` 都会覆盖当前那条。',
      );
      console.log(`  ✗ sources 被别的块覆盖（revision=${JSON.stringify(p.sources[0]?.revision)}）`);
    }
  } finally {
    rmSync(polluted, { recursive: true, force: true });
  }
}

console.log(`  读得到 ${readable.length} 个：${readable.join('、')}`);
console.log(`  刻意不读 ${skipped.length} 个：${skipped.join('、')}\n`);

if (missing.length > 0) {
  problems.push(
    `写进了 frontmatter 却读不到：${missing.join('、')}\n`
    + '    症状是**静默的**——读路径给 `[]` / `undefined` / `""`，'
    + '而构建侧看得到，于是同一页在两个出口形状不同。\n'
    + '    2026-09-28 的 `draft` / `date` / `tags` 三处就是这么漏的。',
  );
  console.log(`  ✗ 读不到：${missing.join('、')}`);
}

/*
 * ⚠️ **反向：白名单里的字段不该突然被读到。**
 * 若有人「顺手补上」了 `cover`，那不是错——而是**白名单该更新了**，
 * 而它在没更新前会与实际脱节。
 */
for (const f of skipped) {
  if (f in page) {
    problems.push(
      `\`${f}\` 在白名单里（刻意不读），但读路径现在读到了它。\n`
      + '    要么改回去，要么**从白名单里删掉并更新那段理由**——'
      + '**白名单与实际不一致，它就成了装饰**。',
    );
    console.log(`  ✗ ${f} 在白名单里却被读到了`);
  }
}

rmSync(dir, { recursive: true, force: true });

/*
 * ⚠️ **顺带核一遍：构建侧读的字段是不是都在上面这份清单里。**
 * 清单外的字段（构建侧读、而这里没测）**就是下一次分歧的候选**。
 */
const contentTs = readFileSync(join(ROOT, 'src', 'lib', 'content.ts'), 'utf8');
const buildFields = new Set();
/*
 * ⚠️ **同样要剥掉注释再抽字段。**
 *
 * 2026-09-28 实测：我在 `content.ts` 的注释里解释了「`data` 的类型里仍只有
 * `related`」，而这个正则把注释里的 `data.related` 当成了真读取——
 * 于是报「无人认领：audience」（`audience` 来自我另一处**代码**里的动态键
 * `[site.wiki.relationField]`，而那条同样被误认）。
 *
 * > 与 `check:two-paths` 完全同源：**判据数的东西比它声称的宽，
 * > 就会被注释触发**；而「写注释时避开某个字符串」不是可靠约束。
 */
const contentSrc = contentTs.replace(
  /\/\*[\s\S]*?\*\//g,
  (m) => ' '.repeat(m.length),
).replace(/^\s*\/\/.*$/gm, (m) => ' '.repeat(m.length));
for (const re of [/\bdata\.([a-zA-Z]+)/g, /data as \{ ([a-zA-Z]+)\?/g]) {
  for (const m of contentSrc.matchAll(re)) buildFields.add(m[1]);
}
const untested = [...buildFields].filter(
  (f) => !checks.some(([n]) => n === f) && !DELIBERATELY_UNREAD.has(f),
).sort();
if (untested.length > 0) {
  problems.push(
    `构建侧读、但这份探针既没测也没列入白名单：${untested.join('、')}\n`
    + '    它们要么该被测（那就在 SCALAR/LIST/BLOCK 里加一条），'
    + '要么该被白名单收编并写明理由。**没被任何一边认领 = 没人负责。**',
  );
  console.log(`  ✗ 无人认领：${untested.join('、')}`);
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log(
  `\n读路径读得到全部 ${readable.length} 个该读的字段；`
  + `${skipped.length} 个刻意不读的都写在白名单里并有理由。\n`,
);
