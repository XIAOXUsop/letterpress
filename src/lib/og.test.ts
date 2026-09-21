import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateOgImage, generateSiteOgImage } from './og.js';

/**
 * 分享图生成器的测试。
 *
 * ── 这个文件是补的，而且补得有点晚 ────────────────────────────────
 *
 * 2026-09-22 发现站内 11 张分享图里 **3 张逐字节相同**
 * （`content-negotiation` / `letterpress` / `static-site-search`）：
 * 它们都是 `seed % 3 === 0` 且 `seed % 2 === 1`，走进同一条分支、连 `rings` 都算成同一个 3。
 *
 * **根因是"分支里没有变化"，不是"哈希混洗得不够"**——这一点是实测出来的：
 * 三条分支里有两条当时各自只有两种输出（分支一看 `rings` 两档、分支三看 `flip` 两态），
 * 44 个 slug 摊到三条分支上，产出**不同图形只有 12 种**。给 seed 加一轮 murmur3 混淆
 * 再取模**没有用**（仍然 12 种），所以那个改动最后没留；管用的是给分支补档位。
 *
 * 所以这里的第一条用例不是"图好看不好看"，而是**两张图不许一样**——
 * 那是这个模块唯一会静默失效的地方：图照样生成、照样 200、照样 1200×630，
 * 只是两张卡片长得一模一样。
 */

const digest = (png: Buffer): string => createHash('sha256').update(png).digest('hex');

/** 站内真实页面——其中前三个就是当初撞掉的那三张。 */
const SITE_PAGES = [
  'content-negotiation',
  'letterpress',
  'static-site-search',
  'cjk-typography',
  'design-tokens',
  'reproducible-builds',
  'how-this-works',
  'markdown-for-agents',
];

const SLUGS = [
  ...SITE_PAGES,
  // 合成：覆盖不同长度、字符集、以及容易在低位上相邻的输入
  ...Array.from({ length: 24 }, (_, i) => `post-${i}`),
  ...Array.from({ length: 8 }, (_, i) => `注释 ${i} 号`),
  'a',
  'ab',
  'abc',
  'abcd',
];

describe('generateOgImage', () => {
  /** 确定性是这套东西能成立的前提：同 slug 必须同字节，否则构建不可复现。 */
  it('同一个 slug 两次生成逐字节相同', () => {
    for (const slug of SLUGS.slice(0, 6)) {
      expect(digest(generateOgImage(slug))).toBe(digest(generateOgImage(slug)));
    }
  });

  /**
   * **本次修复的回归用例。**
   *
   * 这三张曾经完全相同。断言写成"两两不同"而不是"等于某个固定哈希"——
   * 后者会在每次调整构图时无意义地变红。
   */
  it('曾经撞在一起的那三张现在各不相同', () => {
    const three = ['content-negotiation', 'letterpress', 'static-site-search'].map((s) => ({
      slug: s,
      digest: digest(generateOgImage(s)),
    }));
    expect(new Set(three.map((t) => t.digest)).size).toBe(three.length);
  });

  /** 站内真实页面的图必须两两不同——这是当初真正坏掉的东西，标准不放宽。 */
  it('站内所有页面的图两两不同', () => {
    const seen = new Map<string, string>();
    for (const slug of SITE_PAGES) {
      const d = digest(generateOgImage(slug));
      expect(seen.get(d), `「${slug}」与「${seen.get(d)}」生成了同一张图`).toBeUndefined();
      seen.set(d, slug);
    }
  });

  /**
   * 规模上的判据：**不许再有系统性撞车**。
   *
   * ── 为什么是 90% 而不是 100% ────────────────────────────────────────
   *
   * 构图是**有限集**：三条分支、每条若干档位。给定 N 个页面，鸽巢原理下 N 超过组合数
   * 就必然有重复；N 接近组合数时按生日问题也会撞。要求"任意 N 都两两不同"做不到，
   * 硬去凑只会变成**照着测试调参数**。
   *
   * 所以钉的是"分布可用"：100 个页面里至少 90% 的图彼此不同。
   * 实测当前是 **96.0%**（n=60 时 98.3%、n=150 时 96.0%）；
   * 而修复前 44 个 slug 只产出 **12** 种图，即 27%——离这条线差得远。
   *
   * 阈值定在 90 而不是测出来的 96：留出余量，否则这个测试会变成看运气。
   */
  it(
    '100 个 slug 里至少 90% 的图彼此不同',
    () => {
      const total = 100;
      const seen = new Set<string>();
      for (let i = 0; i < total; i++) seen.add(digest(generateOgImage(`page-${i}`)));
      const ratio = (seen.size / total) * 100;
      expect(ratio, `${total} 个 slug 只产出 ${seen.size} 种图（${ratio.toFixed(1)}%）`)
        .toBeGreaterThanOrEqual(90);
    },
    // 这张用例要**真的渲染 100 张 1200×630 的 PNG**（本地约 2.4 秒），
    // 默认的 5 秒在 CI 上不够——2026-09-22 就这么红过一次。
    // 显式给足超时，而不是把样本量缩到测不出问题。
    20_000,
  );

  it('尺寸固定为 1200×630 的 PNG', () => {
    const png = generateOgImage('content-negotiation');
    // PNG 的 IHDR 紧跟在 8 字节签名 + 4 字节长度 + 4 字节类型之后
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});

describe('generateSiteOgImage', () => {
  it('确定性', () => {
    expect(digest(generateSiteOgImage('letterpress'))).toBe(digest(generateSiteOgImage('letterpress')));
  });

  it(
    '站点图不与站内任何一页的图相同',
    () => {
      const site = digest(generateSiteOgImage('letterpress'));
      for (const slug of SITE_PAGES) {
        expect(digest(generateOgImage(slug)), `站点图与「${slug}」的图相同`).not.toBe(site);
      }
    },
    15_000,
  );
});
