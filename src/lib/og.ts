/**
 * 社交分享图（og:image）生成。
 *
 * ── 先说不做什么 ────────────────────────────────────────────────────
 *
 * **它不含文字。**
 *
 * 想做带标题的分享图，需要把字体光栅化——那正是 Satori + resvg 或 sharp
 * 存在的理由，也是几十 MB 的原生依赖。本项目不引它们。
 *
 * 好在分享卡片（Twitter `summary_large_image`、Slack、Telegram）的版式是
 * 「大图 + 标题 + 摘要」，标题本来就由平台渲染。图片承担的是**视觉标识**，
 * 不是信息载体。所以一张有辨识度的几何图是够用的，只是比不上带标题的版本。
 *
 * 想要带文字的分享图，有两条现成的路：
 *   1. 在 frontmatter 里写 `cover:` 或 `ogImage:` 指向自己做的图
 *   2. 用构建脚本外挂一个 Satori 流程
 * 两条路都写在 README 的「已知限制」里。
 *
 * ── 尺寸 ────────────────────────────────────────────────────────────
 *
 * 1200×630 是 Open Graph 的事实标准（1.91:1），Twitter 的
 * `summary_large_image` 也用它。微信对尺寸不敏感但偏好横向。
 */

import { Canvas } from './png.js';

const W = 1200;
const H = 630;

/** 与设计令牌一致。 */
const PAPER: readonly [number, number, number] = [0xfa, 0xfa, 0xfa];
const INK: readonly [number, number, number] = [0x18, 0x18, 0x1b];
const ACCENT: readonly [number, number, number] = [0x00, 0x2f, 0xa7];
const RULE: readonly [number, number, number] = [0xe4, 0xe4, 0xe7];

/**
 * 由 slug 生成一张分享图。
 *
 * 构图比页面封面更简单——分享图在信息流里通常只有几百像素宽，
 * 细节会糊掉，所以只用大块的几何关系。
 */
export function generateOgImage(slug: string): Buffer {
  const canvas = new Canvas(W, H, PAPER);
  const seed = hash(`${slug}::og`);

  // 一：同心圆环。中央一个实心蓝点，外面几圈墨黑描边。
  if (seed % 3 === 0) {
    /*
     * 变化必须来自**档位**，不是随机抖动——与 `cover.ts` 同一个取舍。
     *
     * ── 这里改过一次（2026-09-22）──────────────────────────────────
     *
     * 原先圆心写死、`rings` 只有 `3 + seed % 2` 两档，也就是说**这一条分支
     * 总共只能产出两张不同的图**。而第三条分支也只有 `flip` 两态。
     * 实测 44 个 slug 落在三条分支上是 17 / 8 / 19，但产出的**不同图形只有 12 种**
     * ——站内 11 页里有 3 页的分享图逐字节相同。
     *
     * **根因是"分支里没有变化"，不是"哈希混洗得不够"。** 这一点是实测出来的：
     * 给 seed 加一轮 murmur3 混淆再取模，44 个 slug 仍然只产出 12 种图；
     * 而把各分支的档位补上之后，200 个 slug 有 194 种、500 个有 464 种。
     * 所以这里**没有**加混淆步骤——它测不出效果，加了只是一个说不出理由的改动。
     */
    const cx = W * (0.26 + ((seed >>> 3) % 7) * 0.06);
    const cy = H * (0.4 + ((seed >>> 6) % 4) * 0.05);
    const rings = 3 + ((seed >>> 8) % 4);
    const dot = 40 + ((seed >>> 11) % 4) * 8;
    const stroke = 5 + ((seed >>> 13) % 3) * 2;
    for (let i = rings; i >= 1; i--) {
      canvas.strokeCircle(cx, cy, 60 + i * 62, stroke, INK);
    }
    canvas.fillCircle(cx, cy, dot, ACCENT);
    canvas.fillRect(0, H - 40, W, 8, INK);
    return canvas.toPng();
  }

  // 二：竖条 + 模数网格。
  //
  // ── 这里改过两次 ────────────────────────────────────────────────
  //
  // 第一版：64–116px 的方块随机撒。缩到 400px 宽只剩二三十像素，
  // 像散落的墨点。
  //
  // 第二版：把方块放大到 170–290px，但**保留了随机偏移**。结果更糟——
  // 大小不一的方块各自偏一点，看起来像渲染出错，不像构图。
  //
  // 第三版（现在这版）：**严格对齐到网格，只有「填不填」是变量**。
  // 这才是模数化设计的本质——约束来自网格，变化来自填充。
  // 瑞士设计里没有「稍微偏一点」这种东西。
  if (seed % 3 === 1) {
    const barW = 100 + ((seed >>> 28) % 3) * 20;
    canvas.fillRect(96, 0, barW, H, ACCENT);

    const cols = 4;
    const rows = 2;
    const gap = 26;
    const originX = 340;
    const originY = 52;
    const areaW = W - originX - gap;
    const areaH = H - originY * 2;
    const cellW = Math.floor((areaW - gap * (cols - 1)) / cols);
    const cellH = Math.floor((areaH - gap * (rows - 1)) / rows);

    /*
     * 先决定哪些格子填实，再画。
     *
     * **必须保证最少填 3 个。** 独立掷骰期望填一半，但格子只有 8 个时
     * 方差很大——实测出现过只填 2 格的结果，画面上就剩两个孤零零的方块，
     * 看起来像渲染失败而不是构图。
     *
     * 这和封面模数网格里「蓝格封顶」是同一类问题：**元素数量少时，
     * 概率不会自己收敛，必须显式约束上下界。**
     */
    const cellCount = rows * cols;
    /*
     * 取**高位**而不是低位：低位同时在决定「落到哪条分支」（`seed % 3`），
     * 于是不同 slug 的低位是相关的。原先这里用 `seed >> (i % 30)`（第 0~7 位），
     * 实测 `post-9` 与 `how-this-works` 因此生成了同一张图。
     */
    const filled = Array.from({ length: cellCount }, (_, i) => ((seed >>> (i + 12)) & 1) === 1);

    if (filled.filter(Boolean).length < 3) {
      // 用另一段位重新掷，直到够数（最多试几轮，避免极端情况下死循环）
      for (let attempt = 1; attempt <= 4 && filled.filter(Boolean).length < 3; attempt++) {
        for (let i = 0; i < cellCount; i++) {
          filled[i] = ((seed >>> (12 + ((i * attempt) % 12))) & 1) === 1;
        }
      }
      // 兜底：仍然不够就按固定位置补齐
      for (let i = 0; i < cellCount && filled.filter(Boolean).length < 3; i++) filled[i] = true;
    }

    const accentIndex = 1 + ((seed >>> 24) % (cellCount - 1));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (!filled[i]) continue;

        const x = originX + c * (cellW + gap);
        const y = originY + r * (cellH + gap);
        canvas.fillRect(x, y, cellW, cellH, i === accentIndex ? ACCENT : INK);
      }
    }

    return canvas.toPng();
  }

  // 三：斜带 + 骨架线。
  //
  // ── 这里改过一次（2026-09-22）────────────────────────────────────
  //
  // 原先**只有 `flip` 两态**，而 44 个 slug 里有 19 个落在这条分支上——
  // 近一半的页面共享两张图。
  //
  // 第一次修只加了 `thickness` × `columns` 两个档位（24 种），**不够**：
  // 24 种对 19 个页面，鸽巢原理下必然撞——实测 `post-9` 与 `how-this-works`
  // 三个参数全同（300 / true / 8），于是仍是同一张图。
  //
  // 所以这里的做法与分支二一致：**变化来自"哪几根被填"，而网格是固定的。**
  // 骨架线本身可以加重，加不加由 seed 的每一位决定——`columns` 根线就是
  // 2^(columns-1) 种图案，空间一下就够大了，而构图仍然是那个构图。
  const thickness = 180 + ((seed >>> 5) % 3) * 60;
  const flip = seed % 2 === 0;
  const columns = 5 + ((seed >>> 9) % 6);
  for (let i = 1; i < columns; i++) {
    // 第 i 根骨架线加重与否，取一位——高位，理由同分支二
    const emphasized = ((seed >>> (12 + i)) & 1) === 1;
    canvas.fillRect((W / columns) * i, 0, emphasized ? 5 : 3, H, emphasized ? INK : RULE);
  }
  // 逐列填矩形画斜带——比逐像素判断简单，边界由矩形自己处理
  for (let x = 0; x < W; x++) {
    const center = flip ? H - (x / W) * H : (x / W) * H;
    canvas.fillRect(x, center - thickness / 2, 1, thickness, ACCENT);
  }
  canvas.fillRect(0, H / 2 - 4, W, 8, INK);
  return canvas.toPng();
}

/** 与封面生成器同一套哈希，保证两者风格同源。 */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** 站点默认分享图，用于首页等非文章页。 */
export function generateSiteOgImage(siteName: string): Buffer {
  const canvas = new Canvas(W, H, PAPER);
  const seed = hash(siteName);

  /*
   * 站点图用更简单的构图：一条蓝竖条 + 一组递减的黑方块。
   *
   * 它出现在首页分享里，不需要像文章图那样彼此区分，
   * 只需要一眼认出是同一个站点——所以元素更少、更规整。
   */
  canvas.fillRect(110, 0, 124, H, ACCENT);

  // 阶梯状排列：每往右一格，方块变小、下移一点，形成节奏
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const size = 260 - i * 46 + ((seed >> (i * 3)) % 3) * 18;
    const x = 360 + i * 168;
    const y = 120 + i * 74;
    canvas.fillRect(x, y, size, size, INK);
  }

  canvas.fillRect(0, H - 32, W, 6, INK);

  return canvas.toPng();
}
