---
title: 中文网页排版，多数主题都做错了
summary: 行高、字重、行宽、中西文间距——这四个参数直接套西文的值，中文读者看到的是一份「能读但别扭」的页面。2026 年有三个原生 CSS 属性可以修好其中一半。
date: 2026-09-12
# 修订时间：搜索引擎与 RSS 靠它区分「刚发布」与「发布后大改过」
updated: 2026-09-24
tags: [排版, css, 中文]

# 本文四条核心论断（行高/字重/行宽/中西文间距）各自的规范出处。
# `ch` 与 `ic` 两条刻意分开登记：它们支撑的是**两个不同的论断**——
# 前者说「ch 随字体浮动」，后者说「em 也不保证汉字宽度」。
# 合成一条会让人以为它们是同一件事的重复引用。
sources:
  - sourceId: css-values-4
    revision: WD-20240312
    locator: §5.1.1 长度单位 · ch
  - sourceId: css-values-4
    revision: WD-20240312
    locator: §5.1.1 长度单位 · ic
  - sourceId: css-fonts-4
    revision: WD-20260913
    locator: §2.2.2 Missing weights
  - sourceId: css-fonts-4
    revision: WD-20260913
    locator: §5 Font Matching Algorithm · 字重匹配
  - sourceId: css-fonts-4
    revision: WD-20260913
    locator: §2.8.1 Controlling synthesized bold
  - sourceId: apple-system-fonts
    revision: online-2026-09-24
    locator: System Fonts 表格 · PingFang SC 条目
---

中文网页排版有个奇怪的现象：**大家都觉得别扭，但很少有人能指出哪里别扭。**

原因多半是这四个参数被直接沿用了西文的值。它们单独看都不致命，
叠在一起就是那种说不清的「不对劲」。

## 一、行高

西文正文的常用行高是 1.4 到 1.5。这个值搬到中文上会显得挤。

因为汉字是**方块字**：笔画在字面内铺得很满，字与字之间没有西文那种
由升降部带来的天然空隙。同样行高下，中文的行间留白视觉上更少。

中文正文的行高应当在 **1.6 到 1.8** 之间。本站用的是 1.75。

还有个细节：行高要用**无单位数值**（`line-height: 1.75`），不要用 `px` 或 `em`。
无单位值是相对于元素自身字号计算的，继承时不会出乱子。

## 二、字重

这条最容易被忽略，但效果立竿见影。

**很多中文字体只有两个真实字重：400 和 700。** 苹方有 Ultralight 到 Semibold，
思源黑体有 300 到 900 的完整字重；微软雅黑主要就是 400 和 700。
（Apple 官方系统字体清单里列有 `PingFang SC Semibold`，
见 [System Fonts](https://developer.apple.com/fonts/system-fonts/)。）

这里的通行说法是「写 600 会触发伪合成，所以只能写 500」。**这话只说对了一半。**

伪合成的开关不是字重数值，而是 **`font-synthesis-weight`**。至于字重本身——
写一个字体没有的字重时，规范要求的是**去找最接近的真实字重**，不是伪造一个：

> When a weight is specified for which no face exists, a face with a
> nearby weight is used.
> —— [CSS Fonts Level 4 §2.2.2](https://www.w3.org/TR/2026/WD-css-fonts-4-20260913/#font-style-matching)

**「最接近」具体朝哪边找，规范给了确定规则**（§5 字重匹配）：
请求的字重**大于 500** 时，先按升序检查**不小于**目标的字重
（600 → 700 → 800 → 900），都找不到再向下找。于是：

- 苹方这类**确有 600** 的字体 → 请求 600 **直接命中 600**，不会跳到 700；
- 微软雅黑这类**只有 400/700** 的字体 → 请求 600 先查 700，**落到 700**。

两条路径**都不会伪造粗体**（前提是没开伪合成）：开着合成时它才会把 400
算法加粗——笔画发虚、字形走样，而且每个浏览器合成得还不一样。

本站的做法是把合成直接关掉：

```css
html {
  font-synthesis-weight: none;
}
```

于是标题可以写 `font-weight: 600`：拉丁部分拿到 Archivo 的真实 600，
中文部分落到**自己字体里最接近 600 的真实字重**（苹方约 600、雅黑 700），
两者视觉重量相当。
（反过来，写 500 的话中文更容易掉到 **400**——比正文还轻，标题反而立不住。）

更重要的是：**层级主要靠字号和颜色建立，不要靠字重硬拉。**
一段 17px/400 的正文和一段 21px/600 的小标题，层级已经足够了。

> **勘误（2026-09-22）**：这一节原先写的是「正确做法：标题字重写 500，
> 让字体自己去挑最接近的真实字重」。**结论和建议都改掉了**：把伪合成归因到
> 字重数值本身是错的——开关是 `font-synthesis-weight`；而在关掉合成的实现里，
> 写 500 会让中文落到 400，比 600 更糟。
> 依据见 [CSS Fonts Level 4 的字重匹配](https://www.w3.org/TR/2026/WD-css-fonts-4-20260913/#font-style-matching)
> 与本站 `src/styles/base.css` 的 `font-synthesis-weight`。

## 三、行宽

这是四个里最麻烦的一个，因为中西文的最优值**在同一个单位下对不齐**。

西文的理想行宽是 45 到 75 个字符，66 是经典值。而 `ch` 这个单位
是为西文设计的——按规范，它等于**渲染所用字体**里「0」字形的宽度：

> `ch` — Represents the typical advance measure of **European** alphanumeric
> characters, and measured as the used advance measure of the "0" (ZERO,
> U+0030) glyph **in the font used to render it**.
> —— [CSS Values and Units Level 4](https://www.w3.org/TR/2024/WD-css-values-4-20240312/#ch)

两个要点：它是**欧洲字符**的度量，而且**取决于字体**。所以 `ch` 换算不出一个
跨字体稳定的汉字数——换个字体，「66ch 能排几个汉字」这个数就变了。

粗估的话，一个汉字约等于两个 `ch`，66ch 大约排 **33 个汉字**。
（顺带一提，这个数其实落在中文舒适的 30–40 字里——但它是粗估，且随字体浮动。）

本站改用 `em`，图的是**可预测**：

```css
.prose {
  max-width: 34em;
}
```

`em` 等于元素的字号，这是规范保证的，且**不依赖字体**。
但「一个汉字正好 1em 宽」**不是规范保证**——汉字的 advance 取决于具体字体，
规范为此专门定义了一个 `ic` 单位来表示「字体中全角字形的典型 advance」，
并规定在无法确定时**假设为 1em**：

> The `ic` unit is … a typically exact measure (in the few fonts with proportional
> fullwidth glyphs, an approximation) of a single fullwidth glyph's advance measure.
> In the cases where it is impossible or impractical to determine the ideographic
> advance measure, it must be assumed to be `1em`.
> —— [CSS Values and Units Level 4 §5.1.1](https://www.w3.org/TR/2024/WD-css-values-4-20240312/#ic)

**这一句本身就说明「容器宽度单位」和「实际字形宽度」不能混为一谈**——
如果规范能保证两者相等，就不必再定义 `ic` 了。

所以准确的说法是：34em 让内容栏宽度**稳定地跟随字号**；
对常见全角汉字可**近似**理解为约 34 字，但**实际每行字数仍受字体、标点、
字距和混排影响**。于是：

- 中文：约 34 个字（近似，落在 30–40 的理想区间）✅
- 西文：约 68 个字符（近似，落在 45–75 的理想区间）✅

**一个值同时覆盖两种文字的舒适区，而且容器宽度不随字体变。** 这是
`--measure: 34em` 的由来。**注意被保证的是「宽度稳定」，不是「字数确定」。**

> **勘误（2026-09-22）**：这一节原先写的是「一个汉字大约等于两个 `ch`，
> 所以按 66ch 排中文，每行会排出约 130 个汉字——远超出中文舒适的 30 到 40 字」。
> **两处都错**：按它自己的前提应当除以 2 得 33，而不是乘以 2 得 130；
> 而 33 本来就落在它自己说的舒适区间内，所以「远超」这个结论也不成立。
>
> 这句话还遮住了一个更关键的事实：**66ch ≈ 33em，与本题采用的 34em 宽度几乎相同**
> （这一步依赖「0 字形约 0.5em」这个假设，是推算而非实测）。
> 也就是说这个改动换来的是**容器宽度的可预测性**，不是行宽。
> **结论（用 em）不变，论证方式改了。**
>
> 依据：[CSS Values and Units Level 4 §ch](https://www.w3.org/TR/2024/WD-css-values-4-20240312/#ch)、
> [§ic](https://www.w3.org/TR/2024/WD-css-values-4-20240312/#ic)。
>
> **勘误（2026-09-24）**：上一条勘误之后，本节仍留着
> 「`em` 等于字号、与字体无关。一个汉字约 1em 宽……**而且不随字体变**」，
> 并据此把 `34em` 说成确定的字数换算。**前半句对，后半句越界了**：
> 规范保证的是 `em` 等于**计算后的 font-size**，
> 不保证**每个汉字的 advance 恒等于 1em**——所以「34em ≈ 34 字」是近似，
> 而「**每行字数确定**」这句话是不成立的。详见上面引的 `ic` 那段。

## 四、中西文间距与标点

中文和英文、数字之间应该有一个小间隙：「共 500 条记录」比「共500条记录」好读。

过去这件事要靠 [pangu.js](https://github.com/vinta/pangu.js) 之类的库在
客户端跑一遍正则，找到边界然后插空格。它有一堆边缘情况（全角标点前后不加、
`90°` 不加、`15%` 不加），而且要在 DOM 加载后重写文本。

**2026 年浏览器原生做了这件事：**

```css
html {
  text-autospace: normal;
  text-spacing-trim: trim-start;
}
```

- `text-autospace: normal` 自动在中西文之间插入约 1/4 个空格。2025 年进入 Baseline。
- `text-spacing-trim: trim-start` 做中文标点的字距调整——行首的逗号句号
  之类不再占满一格。Chrome / Edge 123+ 已默认开启。

两个前提：**`<html lang>` 必须设置正确**，否则浏览器不会应用对应语言的规则；
代码块里要关掉自动间距，因为代码里的空格是有意义的：

```css
pre, code, kbd, samp { text-autospace: no-autospace; }
```

**只有 Chromium 系支持**：MDN 的浏览器兼容数据（2026-09-24 查）
记 Chrome 自 123 起支持，**Safari 与 Firefox 均为「不支持」**——
`caniuse` 上还没有这个特性（太新）。
所以它是**渐进增强**——不支持的浏览器只是少了那一点调整，版式不会坏。

> **本项目此前在这里写的是「全球覆盖约 72%」，现已删除。**
> 那个数字**没有任何来源**（caniuse 抓不到、本项目也没实测过），
> 而它写在一个「实测」味道很重的段落里。
> **一个查不到来源的覆盖率，比不写更糟**——读者会以为它是量出来的。

## 五、一条容易漏的：中文没有斜体

中文字体不提供斜体字形。`font-style: italic` 对中文的结果是浏览器
**合成倾斜**——把笔画整体拉斜，字形变形、笔画糊在一起。

而 CSS 没法问「这段 `<em>` 里是中文还是西文」。所以务实的选择是：
**统一把强调处理成加粗**，这也是中文排版的通行做法。

```css
em, i {
  font-style: normal;
  font-weight: 600;
}
```

## 六、字体栈的顺序

最后一条，顺序不能反：

```css
font-family: 'Archivo', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
```

**拉丁字体必须排在前面。** 如果中文字体排在前面，英文也会用中文字体渲染——
而中文字体里的拉丁字母是等宽的（为了和汉字对齐），排版上很难看。

顺序对了之后，英文用 Archivo 渲染，汉字自动落到苹方/雅黑，各取所长。

## 那要不要自托管中文字体

**默认不要。** 中文字体单文件 5–20 MB，哪怕做了子集化，一个博客站也不该
为此付出首屏时间。而中文系统字体（苹方、微软雅黑、思源黑体）质量本身就很好——
知乎、Medium 中文版这类大站的内文都用系统字体。

实在需要自定义时，用 [cn-font-split](https://github.com/KonghaYao/cn-font-split)
做子集化，并且务必用 `unicode-range` 限定覆盖面。

## 小结

| 参数 | 西文常用 | 中文应用 |
|---|---|---|
| 行高 | 1.4–1.5 | **1.6–1.8** |
| 标题字重 | 600–700 | **600**（配 `font-synthesis-weight: none`） |
| 行宽 | 66ch | **34em**（≈34 汉字 / ≈68 西文字符，**均为近似**） |
| 中西文间距 | 手动加 | **`text-autospace`** |
| 强调 | 斜体 | **加粗** |

这些细节单独看都很小。但它们同时出现时，读者的感受就是「这个站读起来舒服」
而说不出为什么——那正是排版该有的样子。

相关条目：[[中文排版]]、[[内容协商]]。

## 参考

- [CSS Values and Units Level 4 §ch](https://www.w3.org/TR/2024/WD-css-values-4-20240312/#ch) —— `ch` 的定义
  （W3C Working Draft, 12 March 2024）
- [CSS Fonts Level 4 §2.2.2 Missing weights](https://www.w3.org/TR/2026/WD-css-fonts-4-20260913/#font-style-matching) —— 缺少字重时如何匹配
- [CSS Fonts Level 4 §font-synthesis-weight](https://www.w3.org/TR/2026/WD-css-fonts-4-20260913/#font-synthesis-weight) —— 伪合成的开关
  （W3C Working Draft, 13 September 2026）

> **为什么链接带日期而不是 `/TR/css-values-4/`**：后者是"最新版"，
> 会随规范修订移动——半年后回看，不知道当时引的是哪一版。
> W3C 自己推荐的引用方式就是带日期的固定 URL。

---

**修订记录**

- **2026-09-12** 发布。
- **2026-09-22** 勘误：行宽一节把「一个汉字 ≈ 2 `ch`」算反了（应除以 2 得 33，
  原写作乘以 2 得 130），连带「远超舒适区」的结论也不成立；字重一节把伪合成
  归因到字重数值上，而开关其实是 `font-synthesis-weight`，且在关掉合成的实现里
  写 500 会让中文落到 400。两处的**结论都保持不变**（用 `em`、标题用 600），
  改的是论证与依据。同步修订了 [[中文排版]]。
- **2026-09-24** 勘误：上一轮只改了那句算错的算式，**却留下了更大的越界**——
  「`em` 等于字号、与字体无关」被推广成「一个汉字正好 1em 宽、每行字数确定」。
  规范保证的只是 `em` 等于**计算后的 font-size**；它为此专门定义了 `ic`
  来表示全角字形的典型 advance，无法确定时假设 1em。
  同时**苹方字重结论与 Apple 官方清单冲突**（清单里确有 `PingFang SC Semibold`），
  且「请求 600 必落 700」是条件句：匹配算法对 >500 的请求**先向上找**，
  有真 600 的字体直接命中 600。
