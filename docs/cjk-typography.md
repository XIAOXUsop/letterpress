# 中文排版取值

> 多数主题（包括中文圈的）直接套用为西文调好的参数。这一页列出本项目改了哪些、
> 为什么，以及怎么自己验证。

## 四个核心参数

| 参数 | 西文常用 | 本项目的取值 | 为什么 |
|---|---|---|---|
| 行高 | 1.4–1.5 | **1.75** | 方块字笔画铺满字面，没有升降部带来的天然空隙 |
| 标题字重 | 600–700 | **600**（配 `font-synthesis-weight: none`） | 关掉伪合成后由字体自己挑真实字重：拉丁拿到真 600，中文落到 700 |
| 行宽 | 66ch | **34em** | `ch` 按渲染字体的「0」字形算、**随字体浮动**；`em` 等于字号，跨字体可预测 |
| 强调 | 斜体 | **加粗** | 中文无斜体字形，强制倾斜即笔画变形 |

### `34em` 是怎么来的

一个汉字约 1em 宽、一个西文字母平均约 0.5em 宽，于是 34em
**同时满足**中文的 30–40 字与西文的 45–75 字符两个理想区间。

用 `ch` 会怎样：按规范它等于**渲染所用字体**里「0」字形的 advance measure
（[CSS Values 4 §ch](https://www.w3.org/TR/css-values-4/#ch)），
所以「66ch 是几个汉字」**取决于字体**，换字体就变。
粗估一个汉字约 2 `ch`，66ch ≈ **33 字**——其实也在舒适区间里，但它是估算。
`em` 等于字号、与字体无关，所以能写成上面那种确定的换算式。

> **勘误（2026-09-22）**：这一段原先写「每行会排出约 **130 个汉字**——远超中文舒适的
> 30–40 字」。**算反了**：按它自己的前提（1 汉字 ≈ 2 `ch`）应当除以 2 得 33，
> 而不是乘以 2；而 33 本就在舒适区间内，「远超」不成立。
> 另注：66ch ≈ 33em，与本站的 34em 宽度几乎相同——这个改动换的是**可预测性**，不是行宽。

取值定义在 `src/styles/tokens.css` 的 `--measure`。

## 2026 年的两个原生属性

```css
html {
  text-autospace: normal;
  text-spacing-trim: trim-start;
}
```

- `text-autospace: normal` 自动在中西文之间插入约 1/4 空格。
  过去这件事要靠 [pangu.js](https://github.com/vinta/pangu.js) 在客户端跑正则，
  而且它有一堆边缘情况（全角标点前后不加、`90°` 不加、`15%` 不加）。
- `text-spacing-trim: trim-start` 做中文标点的字距调整。

两个前提：

1. **`<html lang>` 必须正确**——写错了不会报错，只是所有中文排版规则**静默失效**。
   本项目由 `src/config.ts` 的 `lang` 字段控制。
2. **代码块里要关掉**自动间距，因为代码里的空格是有意义的：

```css
pre, code, kbd, samp { text-autospace: no-autospace; }
```

浏览器支持：`text-autospace` 2025 年进入 Baseline；`text-spacing-trim`
全球覆盖约 72%。Safari 与 Firefox 目前都不支持这两者——属**渐进增强**，
不支持时版式不坏。

## 字体栈的顺序不能反

```css
font-family: 'Archivo', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
```

**拉丁字体必须排在前面。** 中文字体里的拉丁字母是等宽的（为了和汉字对齐），
排在前面会让英文也用中文字体渲染，排版上很难看。顺序对了之后，
英文用 Archivo，汉字自动落到苹方 / 雅黑，各取所长。

## 为什么只自托管拉丁子集

中文字体单文件 5–20 MB，哪怕做了子集化，一个博客站也不该为此付出首屏时间。
而中文系统字体（苹方、微软雅黑、思源黑体）质量本身就很好。

配合 `unicode-range`，中文自动落到系统字体——**这不是回退，是分工**。

实在需要自定义中文字体时，用 [cn-font-split](https://github.com/KonghaYao/cn-font-split)
做子集化，并务必用 `unicode-range` 限定覆盖面。

## 怎么验证

- `npm run verify` 会检查 `@font-face` 是否真的进了产物、字体总量是否失控
  （实测 100 KB，只含拉丁子集）
- `src/lib/contrast.test.ts` 解析 `tokens.css`，逐对验算亮暗双模式的对比度
- 站点自身有一篇更完整的中文说明：在线 Demo 的
  [`/cjk-web-typography/`](https://xiaoxusop.github.io/letterpress/cjk-web-typography/)

## 依据

- [CSS Values and Units Level 4 §ch](https://www.w3.org/TR/css-values-4/#ch) —— `ch` 的定义
- [CSS Fonts Level 4 §2.2.2 Missing weights](https://www.w3.org/TR/css-fonts-4/#font-style-matching) —— 字重匹配
- [CSS Fonts Level 4 §font-synthesis-weight](https://www.w3.org/TR/css-fonts-4/#font-synthesis-weight) —— 伪合成的开关
