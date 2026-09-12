/**
 * 确定性几何封面生成。
 *
 * ── 为什么要有这个东西 ──────────────────────────────────────────────
 *
 * 竞品几乎都支持封面图，但**「支持」不等于「有」**：新建一个博客的人
 * 手里没有配图，于是首页就是一列纯文字——看起来像技术演示，不像产品。
 *
 * 两种常见的错误解法：
 *   - 内置一堆占位图 → 所有人的站点长得一样，且换成自己的图之前一直很丑
 *   - 强制要求封面图 → 提高了上手门槛，与「零配置」矛盾
 *
 * 这里的解法是**从 slug 确定性地生成**：同一个 slug 永远得到同一张封面，
 * 不同 slug 得到不同的。用户不提供图片时它不是占位符，而是一个
 * 真正的设计元素；想换成真实配图时又随时可以。
 *
 * 「确定性」这一点很重要——它意味着构建产物是可复现的，
 * 同一份源码在任何机器上构建出的封面完全一致（见 README 的契约章节）。
 *
 * ── 为什么是几何图形 ────────────────────────────────────────────────
 *
 * 瑞士国际主义的视觉语言本来就是网格、矩形、圆与一个强调色。
 * 生成这类图形不是「凑合」，而是与整套设计同源。
 * 反过来，如果设计是插画风，自动生成就很难不显得廉价。
 */

/** 画布比例。16:9 在列表缩略图与文章头图两个位置都合适。 */
const W = 1200;
const H = 675;

/** 配色取自设计令牌，见 src/styles/tokens.css。 */
const PAPER = '#fafafa';
const INK = '#18181b';
const ACCENT = '#002fa7';
const RULE = '#e4e4e7';

/**
 * FNV-1a 32 位哈希。
 *
 * 用它而不是 `Math.random` 或 `Date.now`：**必须确定性**。
 * 也不用 crypto——它在这个场景下没必要，而且会让函数变成异步的。
 */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // FNV 质数 16777619，用移位与加法避免 32 位溢出
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * 把哈希值彻底打散。
 *
 * **必须做这一步**：FNV-1a 的低位分布很差，而原型选择用的是取模
 * （只吃低位）。实测直接 `seed % 6` 时，八篇示例文章里有五篇落到了
 * 同一种原型上——「每篇封面都不一样」这个目标就废了。
 *
 * 这里用 murmur3 的最终混淆（avalanche）步骤：xor-shift、乘质数、
 * 再来一次。几行代码，把每一位都影响到位。
 */
function mix(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** 从一个哈希值里取出可复用的「随机」数序列。 */
function stream(seed: number): () => number {
  let state = seed || 1;
  return () => {
    // xorshift32：短、确定、分布够用
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/**
 * 六种构图原型。
 *
 * ── 一条来自实look的经验 ────────────────────────────────────────────
 *
 * 第一版做的是「白底 + 一个大圆 + 一条线」这种极简构图。在小缩略图里还行，
 * 放到文章头图那么大时**读起来是「空」而不是「设计」**——大片留白没有
 * 承担任何结构作用，只是没东西。
 *
 * 瑞士海报（Müller-Brockmann、Hofmann 那一脉）从来不是「白底上一个圆」，
 * 而是靠**密集的几何关系**产生张力：同心圆弧、被切开的圆、重复的模数、
 * 满幅的色块。留白是算出来的，不是剩下的。
 *
 * 所以这一版把每个原型都做得更满——元素更多、尺寸更大、彼此有咬合关系。
 * 缩略图会因此显得更有辨识度，头图也不会再空。
 */
type Archetype = (rand: () => number) => string;

const bg = `<rect x="0" y="0" width="${W}" height="${H}" fill="${PAPER}"/>`;

/**
 * ── 配色配比的约束 ──────────────────────────────────────────────────
 *
 * 第一版把强调色当成**面**来用——半张画布填满 IKB 蓝。放进列表里
 * 就是一堵蓝墙，而设计规则里写得很清楚：「强调色在任一屏上不超过 10%，
 * 它的稀有性才是重点」。
 *
 * 所以这一版的配比是刻意定的：
 *   **纸白是底（占大部分）、墨黑承担图形、蓝只做点缀（约 5–15%）**
 *
 * 瑞士书封和海报基本都是这个比例。蓝一多，整个站就变得吵闹，
 * 而且八张封面排在一起会失去彼此的分辨度。
 */

/**
 * 一：同心圆弧。
 *
 * 来自 Müller-Brockmann 的 Beethoven 海报那一脉。用**描边**圆环而非实心，
 * 让纸白透出来；只有最内圈填蓝——一个视觉落点，不是一片色块。
 */
const concentricArcs: Archetype = (rand) => {
  const cx = Math.round(W * (0.3 + rand() * 0.4));
  const cy = Math.round(H * (0.5 + (rand() - 0.5) * 0.3));
  const rings = 4 + Math.floor(rand() * 3);
  const step = Math.round(46 + rand() * 22);
  const parts: string[] = [];

  for (let i = rings; i >= 2; i--) {
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${i * step}" fill="none" stroke="${INK}" stroke-width="${i % 2 === 0 ? 6 : 3}"/>`,
    );
  }
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${step}" fill="${ACCENT}"/>`);

  return `${bg}${parts.join('')}
    <line x1="0" y1="${Math.round(H * 0.78)}" x2="${W}" y2="${Math.round(H * 0.78)}" stroke="${INK}" stroke-width="4"/>`;
};

/**
 * 二：横带。
 *
 * 宽窄交替的横带，**大部分留白**，只有一条填蓝。
 * 带子刻意不铺满整宽——参差的右边缘让画面有呼吸。
 */
const bands: Archetype = (rand) => {
  const count = 4 + Math.floor(rand() * 3);
  const heights: number[] = [];
  for (let i = 0; i < count; i++) heights.push(0.4 + rand());
  const total = heights.reduce((a, b) => a + b, 0);

  const accentIndex = Math.floor(rand() * count);
  const parts: string[] = [];
  let y = 40;

  for (let i = 0; i < count; i++) {
    const h = Math.round(((heights[i] ?? 1) / total) * (H * 0.72));
    const w = Math.round(W * (0.45 + rand() * 0.5));
    const x = Math.round(rand() * (W - w));

    if (i === accentIndex) {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${ACCENT}"/>`);
    } else if (rand() > 0.4) {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${INK}"/>`);
    } else {
      // 细线代替色块——「轻」的一档，让节奏有起伏
      parts.push(`<line x1="${x}" y1="${y + h}" x2="${x + w}" y2="${y + h}" stroke="${INK}" stroke-width="5"/>`);
    }
    y += h + Math.round(18 + rand() * 26);
  }

  return `${bg}${parts.join('')}`;
};

/**
 * 三：模数网格。
 *
 * 方格阵按概率填充，**保留骨架线**——留白因此显得是「空的格子」
 * 而不是「没画东西」。这是模数化设计最基本的道理。
 *
 * **蓝格数量硬性封顶为 2 个。**
 *
 * 这条不是随手定的：24 个格子按 6% 的概率独立掷骰，期望 1.44 个蓝格，
 * 但方差让它时不时冒出 4–5 个——那就是 20% 的画面面积，
 * 直接顶穿了「强调色不超过 10%」的设计规则。独立随机数在**数量少**时
 * 本来就会扎堆，指望概率自己收敛是不现实的，只能显式封顶。
 */
const modularGrid: Archetype = (rand) => {
  const cols = 6;
  const rows = 4;
  const cellW = W / cols;
  const cellH = H / rows;
  const parts: string[] = [];
  let accentCells = 0;
  const MAX_ACCENT_CELLS = 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const roll = rand();
      const x = Math.round(c * cellW);
      const y = Math.round(r * cellH);

      if (roll < 0.08 && accentCells < MAX_ACCENT_CELLS) {
        accentCells++;
        parts.push(`<rect x="${x}" y="${y}" width="${Math.ceil(cellW)}" height="${Math.ceil(cellH)}" fill="${ACCENT}"/>`);
      } else if (roll < 0.24) {
        parts.push(`<rect x="${x}" y="${y}" width="${Math.ceil(cellW)}" height="${Math.ceil(cellH)}" fill="${INK}"/>`);
      } else if (roll < 0.34) {
        // 半圆：在格子里画弧，打破纯方块的单调
        const cy = Math.round(y + cellH);
        parts.push(`<path d="M ${Math.round(x)} ${cy} A ${Math.round(cellW / 2)} ${Math.round(cellW / 2)} 0 0 1 ${Math.round(x + cellW)} ${cy} Z" fill="${INK}"/>`);
      }
    }
  }

  const lines: string[] = [];
  for (let c = 1; c < cols; c++) {
    lines.push(`<line x1="${Math.round(c * cellW)}" y1="0" x2="${Math.round(c * cellW)}" y2="${H}" stroke="${RULE}" stroke-width="2"/>`);
  }
  for (let r = 1; r < rows; r++) {
    lines.push(`<line x1="0" y1="${Math.round(r * cellH)}" x2="${W}" y2="${Math.round(r * cellH)}" stroke="${RULE}" stroke-width="2"/>`);
  }

  return `${bg}${lines.join('')}${parts.join('')}`;
};

/**
 * 四：被切的圆。
 *
 * 一个大**描边**圆被画布边缘裁掉，内嵌一个小实心蓝圆。
 * 「不完整的圆」是瑞士设计里反复出现的母题——完整即静止，裁切即张力。
 * 描边而非实心，是为了不让它变成一块大色斑。
 */
const croppedCircle: Archetype = (rand) => {
  const r = Math.round(H * (0.52 + rand() * 0.3));
  const atLeft = rand() > 0.5;
  const cx = Math.round(atLeft ? r * 0.45 : W - r * 0.45);
  const cy = Math.round(H * (0.38 + rand() * 0.34));
  const innerR = Math.round(r * (0.2 + rand() * 0.12));

  return `${bg}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${INK}" stroke-width="10"/>
    <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="${ACCENT}"/>
    <line x1="0" y1="${Math.round(H * 0.86)}" x2="${W}" y2="${Math.round(H * 0.86)}" stroke="${INK}" stroke-width="4"/>`;
};

/**
 * 五：对角构成。
 *
 * 细骨架线 + 一条斜带。斜带是**中性的墨黑或强调色**由掷骰决定——
 * 两种情况都保留，因为「这一张是不是蓝的」本身就是分辨度。
 */
const diagonal: Archetype = (rand) => {
  const thickness = Math.round(90 + rand() * 110);
  const flip = rand() > 0.5;
  const useAccent = rand() > 0.45;
  const rules: string[] = [];
  const count = 6 + Math.floor(rand() * 5);
  const gap = W / (count + 1);

  for (let i = 1; i <= count; i++) {
    const x = Math.round(i * gap);
    rules.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${RULE}" stroke-width="2"/>`);
  }

  return `${bg}${rules.join('')}
    <line x1="${flip ? W + 60 : -60}" y1="-40" x2="${flip ? -60 : W + 60}" y2="${H + 40}"
          stroke="${useAccent ? ACCENT : INK}" stroke-width="${thickness}"/>
    <line x1="0" y1="${Math.round(H * 0.5)}" x2="${W}" y2="${Math.round(H * 0.5)}"
          stroke="${useAccent ? INK : ACCENT}" stroke-width="5"/>`;
};

/**
 * 六：分割面。
 *
 * 一条**窄**竖条填蓝，另一侧用黑色方块阵压住重心。
 * 早先版本把整块填蓝——那是色块不是分割。
 */
const splitField: Archetype = (rand) => {
  const x = Math.round(W * (0.22 + rand() * 0.2));
  const barW = Math.round(60 + rand() * 70);
  const squares: string[] = [];
  const rows = 3 + Math.floor(rand() * 3);
  const sizes: number[] = [];
  for (let i = 0; i < rows; i++) sizes.push(0.5 + rand());

  for (let i = 0; i < rows; i++) {
    const size = Math.round(36 + (sizes[i] ?? 1) * 52);
    const y = Math.round(((i + 0.5) / rows) * H - size / 2);
    squares.push(
      `<rect x="${x + 90 + Math.round(rand() * 60)}" y="${y}" width="${size}" height="${size}" fill="${INK}"/>`,
    );
  }

  return `${bg}
    <rect x="${x}" y="0" width="${barW}" height="${H}" fill="${ACCENT}"/>
    ${squares.join('')}`;
};

const ARCHETYPES: readonly Archetype[] = [
  concentricArcs,
  bands,
  modularGrid,
  croppedCircle,
  diagonal,
  splitField,
];

/**
 * 由 slug 生成一张封面 SVG。
 *
 * 调用方把它直接内联进页面或写成文件；因为是 SVG，任何尺寸都清晰，
 * 且体积通常在 400–900 字节。
 */
export function generateCover(slug: string, title = ''): string {
  // 标题也参与哈希：两篇文章 slug 相同是不可能的，但同一篇文章改标题时
  // 换一张封面是合理的——而 slug 往往是英文、标题才是作者真正在改的东西。
  const seed = hash(`${slug}::${title}`);
  const rand = stream(seed);

  // 取模前必须 mix()——见 mix 的注释，直接用低位会撞得很厉害
  const archetype = ARCHETYPES[mix(seed) % ARCHETYPES.length] ?? splitField;
  const body = archetype(rand);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
}

/**
 * 小尺寸变体，用于列表缩略图。
 *
 * 同一张 SVG 缩到 80×45 时，网格原型里的细线会糊成一团灰。
 * 这里按比例放大线宽并减少元素数量，保证小尺寸下仍然清晰。
 */
export function generateThumbnail(slug: string, title = ''): string {
  const seed = hash(`${slug}::${title}`);
  const rand = stream(seed);
  // 与完整版用**同一套**选择逻辑，否则列表缩略图与文章头图会是两张不同的图
  const archetype = ARCHETYPES[mix(seed) % ARCHETYPES.length] ?? splitField;

  // 小图把线加粗一倍，避免细线缩到 150px 时糊成一团灰
  const body = archetype(rand).replace(
    /stroke-width="(\d+)"/g,
    (_m, w: string) => `stroke-width="${Number(w) * 2}"`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
}

/** 供测试与调试：列出所有原型名。 */
export const ARCHETYPE_COUNT = ARCHETYPES.length;
