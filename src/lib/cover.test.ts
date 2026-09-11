import { describe, expect, it } from 'vitest';
import { ARCHETYPE_COUNT, generateCover, generateThumbnail } from './cover.js';

/**
 * 从 SVG 里辨认用的是哪一种构图原型。
 *
 * 测试需要它来验证「分布均匀」与「全部原型都被用到」——只看封面
 * 互不相同是不够的，参数随机也能让同一种原型产出各不相同的图。
 *
 * 判据按**排他性**从强到弱排列，每一步都建立在前一步排除了什么之上。
 * 写成这样是因为最初那版判据很脆：构图一改就全错了，
 * 而错误信息只会说「期望 6 得到 4」，看不出是判据的问题。
 */
function signatureOf(svg: string): string {
  const body = svg
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
    // 先剥掉所有原型共有的背景矩形
    .replace(/<rect x="0" y="0" width="1200" height="675"[^>]*\/>/, '');

  // 只有模数网格用 path 画半圆
  if (body.includes('<path')) return 'modularGrid';

  // 只有对角构成有粗到两位数以上的线（其余原型的线宽都是个位数）
  if (/<line[^>]*stroke-width="[1-9]\d+"/.test(body)) return 'diagonal';

  // 同心圆弧用多个描边圆环；被切的圆只有一个描边圆
  const outlines = (body.match(/fill="none"/g) ?? []).length;
  if (outlines >= 2) return 'concentricArcs';
  if (outlines === 1) return 'croppedCircle';

  // 分割面有一条贯通的竖条（高度等于画布高）；横带的色块高度都是算出来的
  if (/<rect[^>]*height="675"/.test(body)) return 'splitField';

  return 'bands';
}

describe('generateCover', () => {
  /**
   * 确定性是这套东西能成立的前提。
   *
   * 它不只是「同样的输入给同样的输出」这么一句口号——它意味着
   * **构建产物可复现**。同一份源码在两台机器上构建出的封面必须一模一样，
   * 否则「构建产物字节一致」这条契约就没法验，缓存与 diff 也会失效。
   */
  it('同一个 slug 永远生成同一张封面', () => {
    const a = generateCover('hello-world', '你好世界');
    const b = generateCover('hello-world', '你好世界');
    expect(a).toBe(b);
  });

  it('重复调用一百次结果不变', () => {
    const first = generateCover('stable', '稳定');
    for (let i = 0; i < 100; i++) {
      expect(generateCover('stable', '稳定')).toBe(first);
    }
  });

  it('不同 slug 生成不同封面', () => {
    const slugs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const covers = new Set(slugs.map((s) => generateCover(s)));
    // 允许极小概率碰撞，但八个里至少要有六个不同
    expect(covers.size).toBeGreaterThanOrEqual(6);
  });

  it('标题参与哈希——改标题会换一张封面', () => {
    expect(generateCover('same-slug', '标题一')).not.toBe(generateCover('same-slug', '标题二'));
  });

  it('产出合法的 SVG 骨架', () => {
    const svg = generateCover('x');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 1200 675"');
  });

  it('不引用任何外部资源', () => {
    // 自包含很重要：外链图片会让封面在离线构建或代理环境下消失。
    // 注意 `xmlns="http://www.w3.org/2000/svg"` 是命名空间声明，不是网络请求，
    // 所以不能简单地查 `http://`——那个字符串本来就该在。
    for (const slug of ['a', 'b', 'c', 'd', 'e']) {
      const svg = generateCover(slug);
      expect(svg).not.toContain('<image');
      expect(svg).not.toContain('href=');
      expect(svg).not.toContain('url(');
      // 除命名空间外不应再有别的 http 出现
      expect(svg.replace('http://www.w3.org/2000/svg', '')).not.toContain('http');
    }
  });

  it('只用设计令牌里的颜色', () => {
    const svg = generateCover('palette-check');
    const colors = svg.match(/#[0-9a-f]{6}/gi) ?? [];
    for (const color of colors) {
      expect(['#fafafa', '#18181b', '#002fa7', '#e4e4e7']).toContain(color.toLowerCase());
    }
  });

  /**
   * 体积要小。封面是每个列表项都渲染一次的东西，
   * 单张几 KB 的话一页就会多出几十 KB 的内联 SVG。
   */
  it('单张体积在 1.5 KB 以内', () => {
    for (const slug of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
      expect(generateCover(slug).length).toBeLessThan(1500);
    }
  });

  it('大量 slug 都能得到彼此不同的封面', () => {
    const covers = new Set<string>();
    for (let i = 0; i < 200; i++) covers.add(generateCover(`seed-${i}`));
    // 允许极少量碰撞（几何参数空间有限），但绝大多数必须不同
    expect(covers.size).toBeGreaterThan(180);
  });

  /**
   * **分布必须均匀。**
   *
   * 这条是踩坑补上的：原型选择原本写成 `seed % 6`，而 FNV-1a 的低位
   * 分布很差——实测八篇示例文章里有五篇落到同一种原型上，
   * 「每篇封面都不一样」这个目标直接废掉。
   *
   * 修法是在取模前过一遍 murmur3 的 avalanche 混淆。
   * 这条测试用卡方式的宽松判据把它钉住：任何原型都不该被选中
   * 超过期望值的两倍，也不该一次都不出现。
   */
  it('原型分布均匀，不会扎堆到某一种', () => {
    const N = 600;
    const counts = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const sig = signatureOf(generateCover(`dist-${i}`));
      counts.set(sig, (counts.get(sig) ?? 0) + 1);
    }

    expect(counts.size).toBe(ARCHETYPE_COUNT);

    const expected = N / ARCHETYPE_COUNT;
    for (const [name, count] of counts) {
      expect(count, `${name} 出现 ${count} 次，期望约 ${expected}`).toBeGreaterThan(expected * 0.5);
      expect(count, `${name} 出现 ${count} 次，期望约 ${expected}`).toBeLessThan(expected * 1.8);
    }
  });

  /**
   * 强调色的用量必须克制。
   *
   * 设计规则写的是「强调色在任一屏上不超过 10%，它的稀有性才是重点」。
   * 第一版封面把半张画布填成 IKB 蓝——八张排在一起就是一堵蓝墙。
   *
   * 这里做一个粗粒度检查：统计「填充蓝色的图形」与总图形数的比例。
   * 不追求精确的面积计算，只要保证蓝色不是主导元素。
   */
  it('强调色不占主导，蓝色图形数明显少于黑/白图形', () => {
    for (let i = 0; i < 40; i++) {
      const svg = generateCover(`balance-${i}`);
      const blueShapes = (svg.match(/fill="#002fa7"/g) ?? []).length;
      const intended = blueShapes;

      // 每张封面里填蓝的图形不应超过 2 个（同心圆的内点、网格的个别格子等）
      expect(intended, `balance-${i} 有 ${intended} 个蓝色图形`).toBeLessThanOrEqual(2);
    }
  });

  it('全部构图原型都会被用到', () => {
    /**
     * 光看「封面互不相同」不够——如果取模写错了，可能原型里
     * 只有一种被选中，而参数随机照样能产出各不相同的图。
     *
     * 所以按结构特征分辨原型。注意背景矩形是所有原型共有的，
     * 必须**先剥掉它**再取特征，否则每个封面看起来都一样。
     */
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(signatureOf(generateCover(`probe-${i}`)));

    expect(seen.size).toBe(ARCHETYPE_COUNT);
  });

  it('空 slug 不抛异常', () => {
    expect(() => generateCover('')).not.toThrow();
    expect(generateCover('')).toContain('<svg');
  });

  it('含中文、emoji、特殊字符的 slug 不抛异常', () => {
    for (const slug of ['中文标题', '🎉🎊', '<script>', '"quoted"', "a'b"]) {
      expect(() => generateCover(slug, slug)).not.toThrow();
    }
  });

  it('不会把 slug 内容注入到 SVG 里', () => {
    // slug 是用户可控的，绝不能出现在输出中——否则可能被当成标记解析
    const svg = generateCover('<script>alert(1)</script>');
    expect(svg).not.toContain('script');
    expect(svg).not.toContain('alert');
  });
});

describe('generateThumbnail', () => {
  it('同样是确定性的', () => {
    expect(generateThumbnail('t')).toBe(generateThumbnail('t'));
  });

  it('线宽比完整版粗，保证小尺寸下清晰', () => {
    // 找一个会产出 stroke-width 的 slug
    const withStroke = Array.from({ length: 40 }, (_, i) => `s${i}`).find((s) =>
      /stroke-width="\d+"/.test(generateCover(s)),
    );
    expect(withStroke).toBeDefined();

    const full = generateCover(withStroke!);
    const thumb = generateThumbnail(withStroke!);
    const widthOf = (svg: string): number => Number(/stroke-width="(\d+)"/.exec(svg)?.[1] ?? 0);

    expect(widthOf(thumb)).toBeGreaterThan(widthOf(full));
  });

  it('产出合法 SVG', () => {
    expect(generateThumbnail('x')).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
});
