---
title: 中文排版
summary: 行高、字重、行宽、中西文间距——四个参数直接套西文的值，中文读者看到的是「能读但别扭」的页面。
kind: concept
related: [cjk-web-typography, design-tokens]
---

中文网页排版最常见的病因：**参数沿用了西文的值。**

| 参数 | 西文常用 | 中文应用 | 为什么 |
|---|---|---|---|
| 行高 | 1.4–1.5 | **1.6–1.8** | 方块字笔画铺满字面，没有升降部带来的天然空隙 |
| 标题字重 | 600–700 | **600** | 伪合成的开关是 `font-synthesis-weight`，不是字重数值；关掉后由字体挑最近的真实字重 |
| 行宽 | 66ch | **34em** | `ch` 按渲染字体的「0」字形算、随字体浮动；`em` 等于字号，跨字体可预测 |
| 中西文间距 | 手动加 | **`text-autospace`** | 2025 起浏览器原生支持，pangu.js 时代结束 |
| 强调 | 斜体 | **加粗** | 中文无斜体字形，强制倾斜即笔画变形 |

## `34em` 这个数字

它同时满足两种文字的舒适区，因为：

- 一个汉字 ≈ 1em 宽 → 34em 排约 **34 个汉字**（理想 30–40）
- 一个西文字母平均 ≈ 0.5em 宽 → 34em 排约 **68 个字符**（理想 45–75）

用 `ch` 做不到这一点：它按**渲染字体的「0」字形**计算
（[CSS Values 4](https://www.w3.org/TR/css-values-4/#ch) 原文是
"the used advance measure of the "0" (ZERO, U+0030) glyph in the font used to render it"），
所以「66ch 排几个汉字」**随字体变**。粗估一个汉字约 2 `ch`，66ch ≈ 33 字——
其实也不差，但它是粗估，`em` 不是估算。

> **勘误（2026-09-22）**：这里原先写「`66ch` 排中文会变成约 **130 字**一行」。
> 按它自己的前提（1 汉字 ≈ 2 `ch`）应当除以 2 得 33，而不是乘以 2。
> 而且 33 落在舒适的 30–40 里——原句想说的「太宽」并不成立。
> 顺带：66ch ≈ 33em，与本站的 34em **宽度几乎相同**，这个改动换的是可预测性而非行宽。

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

- [CSS Values and Units Level 4 §ch](https://www.w3.org/TR/css-values-4/#ch)
- [CSS Fonts Level 4 §2.2.2 Missing weights](https://www.w3.org/TR/css-fonts-4/#font-style-matching)
