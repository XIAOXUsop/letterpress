---
title: 中文排版
summary: 行高、字重、行宽、中西文间距——四个参数直接套西文的值，中文读者看到的是「能读但别扭」的页面。
kind: concept
updated: 2026-09-24
related: [cjk-web-typography, design-tokens]
# 本页三条核心论断各自对应一个已登记来源。
# `ch` 那条用来纠正「一个汉字约两个 ch，所以 66ch 排 130 字」的旧算式；
# `ic` 那条用来纠正「em 等于字号所以字数确定」这个更大的越界；
# 字重那条用来纠正「写 600 会伪合成」的旧归因，并钉住匹配算法的查找方向。
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
  - sourceId: apple-system-fonts
    revision: online-2026-09-24
    locator: System Fonts 表格 · PingFang SC 条目
# 摘要对不上就是 stale——构建会报错，不会静默沿用旧状态。
review:
  status: reviewed
  checkedAt: 2026-09-24
  contentDigest: 02d5a0a303099e0f4dbb6f68a437a7a7209b24a8167c77c66c7c36067ef824c1
---

中文网页排版最常见的病因：**参数沿用了西文的值。**

| 参数 | 西文常用 | 中文应用 | 为什么 |
|---|---|---|---|
| 行高 | 1.4–1.5 | **1.6–1.8** | 方块字笔画铺满字面，没有升降部带来的天然空隙 |
| 标题字重 | 600–700 | **600** | 伪合成的开关是 `font-synthesis-weight`，不是字重数值；关掉后由字体挑真实字重——请求 >500 时**先向上找**（600→700→800），故有真 600 的字体直接命中 600 |
| 行宽 | 66ch | **34em** | `ch` 按渲染字体的「0」字形算、随字体浮动；`em` 等于计算后的 font-size，**容器宽度**跨字体可预测 |
| 中西文间距 | 手动加 | **`text-autospace`** | 2025 起浏览器原生支持，pangu.js 时代结束 |
| 强调 | 斜体 | **加粗** | 中文无斜体字形，强制倾斜即笔画变形 |

## `34em` 这个数字

它大致同时覆盖两种文字的舒适区，因为：

- 一个汉字 ≈ 1em 宽 → 34em 排**约** 34 个汉字（理想 30–40）
- 一个西文字母平均 ≈ 0.5em 宽 → 34em 排**约** 68 个字符（理想 45–75）

⚠️ **保证的是容器宽度，不是字数。** `em` 等于**计算后的 font-size**，
规范保证且与字体无关；但**汉字 advance 是否恰好 1em，规范并不保证**——
它为此定义了 `ic`（全角字形的典型 advance，无法确定时假设 1em，见
[CSS Values 4 §ic](https://www.w3.org/TR/2024/WD-css-values-4-20240312/#ic)）。
**如果两者相等就不必再定义 `ic`**——这正是那句话存在的理由。

用 `ch` 连容器宽度都不稳：它按**渲染字体的「0」字形**计算
（[CSS Values 4](https://www.w3.org/TR/2024/WD-css-values-4-20240312/#ch) 原文是
"the used advance measure of the "0" (ZERO, U+0030) glyph in the font used to render it"），
所以「66ch 排几个汉字」**随字体变**。粗估一个汉字约 2 `ch`，66ch ≈ 33 字——
其实也不差，但它多了一层未实测的假设（「0 字形约 0.5em」），且容器宽度本身也随字体浮动。

> **勘误（2026-09-22）**：这里原先写「`66ch` 排中文会变成约 **130 字**一行」。
> 按它自己的前提（1 汉字 ≈ 2 `ch`）应当除以 2 得 33，而不是乘以 2。
> 而且 33 落在舒适的 30–40 里——原句想说的「太宽」并不成立。
> 顺带：66ch ≈ 33em，与本站的 34em **宽度几乎相同**，这个改动换的是容器宽度的可预测性而非行宽。
>
> **勘误（2026-09-24）**：上一条之后本页仍写着「**`em` 不是估算**」。
> **这句话是错的，而且错得最彻底**——它把「容器宽度不随字体变」推广成了
> 「字数可确定」。`em` 的定义里根本没有「汉字宽度」这一项；
> 上面那段 `ic` 的原文就是规范自己承认这件事无法从 `em` 推出。已改写。

## 2026 年的两个原生属性

```css
html { text-autospace: normal; text-spacing-trim: trim-start; }
pre, code, kbd, samp { text-autospace: no-autospace; }
```

- `text-autospace`：中西文之间自动插入约 1/4 空格。2025 进入 Baseline。
- `text-spacing-trim`：中文标点字距调整，行首标点不再占满一格。
  Chrome / Edge 123+ 默认开启，全球覆盖约 72%。

**前提是 `<html lang>` 正确。** 语言标签不对，浏览器不应用对应语言的断行
与标点规则。代码块里必须关掉——代码里的空格是有意义的。

Safari / Firefox 尚不支持，属渐进增强，不支持时版式不坏。

## 字重伪合成的识别

**先看 `font-synthesis-weight` 是不是 `none`。** 是 `none` 的话浏览器不会合成，
写 600 而字体没有 600 时它会去挑最近的真实字重（规范 §2.2.2：*a face with a
nearby weight is used*）——本站就是这一档。

若合成开着，表现才是笔画边缘发虚、与相邻字号比粗细不自然；
在 DevTools 的 `Rendered Fonts` 里能看到实际用到的字体与字重。

## 字体栈顺序

```css
font-family: 'Archivo', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
```

**拉丁字体必须在前。** 反了的话英文也会用中文字体渲染，
而中文字体里的拉丁字母是等宽的（为与汉字对齐），排版很难看。

配合 `unicode-range` 限定 webfont 只覆盖拉丁区，中文字符就不会触发
webfont 下载——**这不是回退，是分工。**

## 相关

- 完整论述与实测：[[cjk-web-typography]]
- 本站的具体取值：[[设计令牌]]

## 参考

- [CSS Values and Units Level 4 §ch](https://www.w3.org/TR/2024/WD-css-values-4-20240312/#ch)
- [CSS Fonts Level 4 §2.2.2 Missing weights](https://www.w3.org/TR/2026/WD-css-fonts-4-20260913/#font-style-matching)
