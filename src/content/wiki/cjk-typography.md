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
| 标题字重 | 600–700 | **500** | 多数中文字体只有 400/700，写 600 会触发伪合成 |
| 行宽 | 66ch | **34em** | `ch` 按西文「0」宽算，一个汉字约等于两个 `ch` |
| 中西文间距 | 手动加 | **`text-autospace`** | 2025 起浏览器原生支持，pangu.js 时代结束 |
| 强调 | 斜体 | **加粗** | 中文无斜体字形，强制倾斜即笔画变形 |

## `34em` 这个数字

它同时满足两种文字的舒适区，因为：

- 一个汉字 ≈ 1em 宽 → 34em 排约 **34 个汉字**（理想 30–40）
- 一个西文字母平均 ≈ 0.5em 宽 → 34em 排约 **68 个字符**（理想 45–75）

用 `ch` 做不到这一点：`66ch` 排中文会变成约 130 字一行。

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

在浏览器 DevTools 里如果看到 `Rendered Fonts` 显示的字重与你写的不一致，
就是在合成。表现是笔画边缘发虚、与相邻字号比粗细不自然。

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
