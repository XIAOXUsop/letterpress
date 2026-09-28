#!/usr/bin/env node
/**
 * **同一个「清单」在文件里只能有一份字面量。**
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 2026-09-28 一天之内栽了**四次**，形态完全一样：
 *
 * | # | 清单 | 漏在哪 |
 * |---|---|---|
 * | 1 | `check-portability` 的 `CORE`（核心模块） | 手写 8 个，**漏了 5 个** |
 * | 2 | `check-exit-codes` 的 `USER_CLIS` | 手写 4 个，**漏了 3 个** |
 * | 3 | `check-gate-list` 的 `NOT_IN_ALL` 与变异脚本的 `file` 值 | 改了 A 忘了改 B |
 * | 4 | `new-gates.mutations.mjs` 的 `GATES` 与「干净态检查」的数组 | 加了第 5 道忘了同步 |
 *
 * > **共同形态：同一份事实写了两遍，而两遍不会互相提醒。**
 * > 前两处已改成**从数据源推导**；后两处是「两处字面量要手工同步」——
 * > 而本检查量的就是**后一种**。
 *
 * ── 判据 ────────────────────────────────────────────────────────────
 *
 * 扫 `scripts/` 与 `src/`，找**同一个 `const X = [...]` 在一个文件里出现两次以上**
 * （按内容归一化后比较）。
 *
 * ⚠️ **它量的是「字面量重复」，不是「逻辑重复」**——
 * 后者要读懂每个函数，量不到。而 2026-09-28 那四次**全都是字面量**。
 *
 * ⚠️ **它量不到「手写的那份是子集」。**
 * 那天四次里的前两次（`CORE` 漏 5 个、`USER_CLIS` 漏 3 个）**不是这个形态**：
 * 手写 8 个、实际 13 个，手写那份是**子集而不是副本**，
 * 而「子集 ≠ 内容相同」——所以本检查对那两次**完全无感**。
 * 抓子集要靠「名单从数据源推导」，那是另外两处已经采用的处置。
 *
 * ⚠️ **它只在「一个文件里」找重复。** 跨文件那份用另一条判据
 * （2026-09-28 实测：56 份清单里**只有 1 份**跨文件重复，而那 1 份还是
 * 本文件自己刚写进去的 `['scripts','src']`）——已收敛，没留第二道。
 *
 * ⚠️ **不排除同名不同内容**：那叫「两个不同的清单碰巧同名」，
 * 不一定是错。所以判据只看**内容逐字相同**的重复。
 *
 * 用法：`node scripts/check-no-duplicate-lists.mjs`
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { SOURCE_DIRS } from './lib/source-dirs.mjs';

const ROOT = process.cwd();
const problems = [];

console.log('同一个清单只能有一份字面量');
console.log('─'.repeat(64));

const files = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) {
      if (!['node_modules', '.git', 'dist', '.astro', '.verify', 'public'].includes(e.name)) walk(p);
    } else if (/\.(ts|mjs)$/.test(e.name)) {
      files.push(p);
    }
  }
};
/** 扫描根目录。⚠️ **改这个列表等于改这道门禁的覆盖面**，见下面的下限断言。 */
const ROOT_DIRS = SOURCE_DIRS;
for (const d of ROOT_DIRS) walk(join(ROOT, d));

if (files.length === 0) {
  console.error('一个源码文件都没扫到——这个检查什么都没量。');
  process.exit(1);
}

/*
 * ⚠️ **排除测试与变异注入文件。**
 *
 * 收窄到「非空且 ≥2 元素」之后，26 处降到 3 处，而那 3 处全在 `*.test.ts` 里：
 * `const pages = [makePage(), makePage()]` 是**造测试固件**，
 * 两个 `describe` 各造一份、名字一样内容也一样——**那是巧合，不是清单**。
 *
 * > 判据太宽就变成噪声，而噪声会让人忽略真信号。
 * > 所以判据要**先问「这个重复有没有害」**，再问「它重复了吗」。
 */
const isFixture = (f) => /\.(test\.ts|test\.mjs|mutations\.mjs)$/.test(f);
const scanned = files.filter((f) => !isFixture(f));

console.log(`  扫了 ${files.length} 个文件（排除 ${files.length - scanned.length} 个测试/变异夹具）\n`);

/**
 * 找 `const/let NAME = [ … ]` 的**数组字面量**，按归一化后的内容分组。
 *
 * ⚠️ **跨行也要认**（清单通常是多行的），所以按**括号配平**扫，
 * 而不是单行正则。
 */
function arrayLiterals(text) {
  const out = [];
  const re = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\[/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < text.length; i++) {
      if (text[i] === '[') depth++;
      else if (text[i] === ']') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue; // 没配平（被截断或跨文件）——跳过
    const body = text.slice(start + 1, i);
    /*
     * ⚠️ **只认「真正的清单」：非空、且至少两个元素。**
     *
     * 第一版没加这个限制，于是扫出 26 处——绝大多数是
     * `const docs = []` / `const queryTerms = []` 这类**同名同值但毫无关系**的
     * 局部变量。**判据太宽就会变成噪声，而噪声让人忽略真信号。**
     *
     * 而「清单」的定义是：一组需要与别处保持一致的条目——
     * 空的、或只有一个元素的，不可能是「需要同步的第二份」。
     */
    const items = body.split(',').map((s) => s.trim()).filter(Boolean);
    if (items.length < 2) {
      re.lastIndex = i;
      continue;
    }
    // 归一化：先按元素切开、每个元素去掉首尾空白与全部内部空白，再拼回去
    out.push({ name: m[1], key: items.map((s) => s.replace(/\s+/g, '')).join(',') });
    re.lastIndex = i;
  }
  return out;
}

/**
 * 把 `analyze` 跑在**临时文件**上，返回它会说什么。
 *
 * ⚠️ **临时副本，不动真源码。**
 * 一天里因此栽过两次：往真文件注入变异，探完**忘了还原**——
 * 而那一刻 Git 是干净的（文件根本没被跟踪？不对：它被跟踪），
 * 于是「还原没做」和「文件本来就那样」长得一模一样，**只有 `git status` 能分辨**。
 * 临时副本让这个风险归零：写进 `.verify/`，用完即删。
 */
function analyzeText(name, text) {
  const dir = join(ROOT, '.verify', 'no-dup-lists');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, text, 'utf8');
  try {
    return analyze(readFileSync(p, 'utf8')).map((n) => n.join('、'));
  } finally {
    rmSync(p, { force: true });
  }
}

/**
 * 一份源码里的重复清单：`[名字, 名字, …]`。
 *
 * ⚠️ **只报「逐字相同」的。** 同名不同内容是两个不同的清单碰巧同名，
 * 那不一定是错；判据只抓「同一份事实写两遍」这个真正有害的形态。
 */
function analyze(text) {
  const byKey = new Map();
  for (const l of arrayLiterals(text)) {
    if (!byKey.has(l.key)) byKey.set(l.key, []);
    byKey.get(l.key).push(l.name);
  }
  return [...byKey.values()].filter((names) => names.length >= 2);
}

let duplicates = 0;

/*
 * ⚠️ **「扫到文件」不等于「扫到清单」。**
 *
 * 形态五的变体：**被测集合被悄悄缩小，而门禁照样绿**。
 * 第一版没有这道下限断言，于是把 `ROOT_DIRS` 从 `['scripts','src']`
 * 改成 `['src']` 就能让覆盖减半——而「0 处重复」这个输出**一模一样**。
 *
 * ⚠️ **这两个下限是实测出来的，不是估的。**
 * 第一版我凭印象写了 `100 / 5`，门禁立刻报 scripts 只有 54 个——
 * **尺子自己先量错了**。而「我拍了个数」和「我量了个数」长得一模一样。
 *
 * 现行值 `54 / 70` 由实跑得到（2026-09-28）。真实文件数会**随仓库增长**，
 * 所以钉住的是**下限**：往下（覆盖面被缩小）会红，往上（新增文件）不红。
 */
const MIN_FILES_PER_ROOT = [
  ['scripts', 54],
  ['src', 70],
];
for (const [dir, min] of MIN_FILES_PER_ROOT) {
  const n = files.filter((f) => f.startsWith(join(ROOT, dir) + sep)).length;
  if (n < min) {
    problems.push(
      `**扫描范围被缩小了**：\`${dir}/\` 下只扫到 ${n} 个文件（实测下限 ${min}）。\n`
      + '    缩小覆盖面不会让「0 处重复」变好看——它只是让门禁**少看见东西**。\n'
      + '    改覆盖面之前先问：是不是想藏掉一处真重复？',
    );
    console.log(`  ✗ ${dir}/ 只扫到 ${n} 个文件（下限 ${min}）`);
  } else {
    console.log(`  ✓ ${dir}/ 扫到 ${n} 个文件（下限 ${min}）`);
  }
}
console.log('');

for (const f of scanned) {
  const rel = relative(ROOT, f).split(sep).join('/');
  for (const names of analyze(readFileSync(f, 'utf8'))) {
    duplicates++;
    problems.push(
      `${rel} 里 **\`${names[0]}\` 出现了 ${names.length} 次**（逐字相同）：\n`
      + `      ${names.join('、')}\n`
      + '    **同一份事实写两遍，而两遍不会互相提醒**——\n'
      + '    2026-09-28 一天之内栽了四次（CORE 漏 5 个模块、USER_CLIS 漏 3 个 CLI、\n'
      + '    NOT_IN_ALL 与变异脚本的 file 值、GATES 与干净态检查的数组）。\n'
      + '    改一处留一个变量：另一处引用它。',
    );
    console.log(`  ✗ ${rel}：${names.join('、')} 内容相同`);
  }
}

/*
 * ── 自测：先证明这套判据能看见东西，再拿它去说「没看见东西」 ──────────
 *
 * ⚠️ **为什么必须自测。** 第一版没有这段，于是「往跨行清单里插一份重复」这个变异
 * 跑出来是**绿的**——而那一刻我差点读成「判据漏了跨行」。
 * 真相分两层，第二层更要紧：**注入根本没生效**（锚点写在一个不存在的
 * `export interface ReadPage` 上，写入静默不发生），
 * 而**「注入无效」和「判据有盲区」的输出长得一模一样**——都是「绿」。
 *
 * 这就是那句「**它报了 ≠ 它判了**」的反面：
 * **它没报，也分不清是没看见、还是压根没被喂进去。**
 * 所以自测里**逐条断言期望的结论**，红绿都由判据自己给。
 *
 * ⚠️ 全部用**临时副本**，不碰真源码——2026-09-28 一天里因此栽过两次。
 */
console.log('  自测（临时副本，不碰真源码）');
const SELF_CASES = [
  {
    why: '逐字相同的两份清单（跨行）必须被报出来',
    src: "const A = [\n  'x',\n  'y',\n];\nconst B = [\n  'x',\n  'y',\n];\n",
    want: 1,
  },
  {
    why: '同名但内容不同 —— 是两个碰巧同名的清单，不该报',
    src: "const A = ['x', 'y'];\nconst B = ['x', 'z'];\n",
    want: 0,
  },
  {
    why: '空清单与单元素清单不可能是「需要同步的第二份」，不该报',
    src: "const A = [];\nconst B = [];\nconst C = ['only'];\nconst D = ['only'];\n",
    want: 0,
  },
  {
    why: '只有一份的多行清单不该报（第一版的变异栽在这里）',
    src: "const A = [\n  'x',\n  'y',\n];\n",
    want: 0,
  },
  {
    why: '空行与缩进不同不算不同（归一化后仍逐字相同）',
    src: "const A = ['x', 'y'];\nconst B = [\n  'x',\n\n  'y',\n];\n",
    want: 1,
  },
];
for (const c of SELF_CASES) {
  const got = analyzeText('self-test.mjs', c.src).length;
  if (got === c.want) {
    console.log(`    ✓ ${c.why}`);
  } else {
    problems.push(
      `**自测不通过**（${c.why}）：期望 ${c.want} 处，实际 ${c.want === 0 ? 0 : got} 处。\n`
      + '    → 它连自己造的样本都判不对，那「没报重复」就更不能当结论。',
    );
    console.log(`    ✗ ${c.why}（期望 ${c.want}，实际 ${got}）`);
  }
}
console.log('');

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} 处。\n`);
  process.exit(1);
}
console.log(`\n${files.length} 个文件里没有重复的清单字面量。\n`);
