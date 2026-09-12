# 竞品对照

> 这一页只回答一个问题：**同样的需求，为什么不选 AstroPaper / Fuwari / PaperMod。**

先说结论：**如果你的首要需求是「功能越多越好」，选 [Fuwari](https://github.com/saicaca/fuwari)**
——它有 KaTeX、Mermaid、多语言、图片灯箱、页面转场，这些本项目都没做。

**如果你在乎下面任何一条，本项目是更合适的选择：**

| | letterpress | AstroPaper | Fuwari | PaperMod |
|---|---|---|---|---|
| 中西文自动间距、中文不用斜体 | ✅ 唯一做到 | ❌ | ❌ | ❌ |
| 行高 1.75 / 行宽按中文调 | ✅ | ⚠️ 行高同为 1.75，行宽随卡片浮动 | ⚠️ 同左 | ⚠️ 只修 `hasCJKLanguage` 的截断 |
| **给 AI 读的 markdown 接口** | ✅ 内容协商 + `.md` 孪生 | ❌ | ❌ | ❌ |
| **双向链接（`[[…]]` + 反向链接）** | ✅ | ❌ | ❌ | ❌ |
| 断链让**构建失败** | ✅ | 部分（zod schema） | ❌ | ❌ |
| 分享图 | ✅ 自动生成 | ✅ 自动生成（Satori） | ❌ | ✅ 静态 |
| 搜索 | ✅ Pagefind | ✅ Pagefind | ✅ Pagefind | ✅ Fuse.js |
| 目录 / 分页 / 上下篇 / 按年归档 | ✅ 全部 | ✅ 全部 | ✅ 全部 | ✅ 全部 |
| 跳转链接 / 可见焦点 / reduced-motion | ✅ 三项齐全 | ✅ | ⚠️ 缺前两项 | ❌ 三项都缺 |
| 数学公式 / 流程图 | ❌ | ❌ | ✅ | ✅ |
| 多语言 | ❌ 单语言 | ⚠️ 架构就绪 | ✅ 10 种 | ✅ 46 种 |
| 评论 | ❌ | ❌ | ❌ | ❌ |
| 外部 JS | **0 个文件** | 少量 + Pagefind | Swup + Svelte | 少量 + Fuse.js |

**如实说明本项目缺什么**：数学公式、流程图、多语言、图片灯箱、页面转场、评论。
这些都不是「做不到」，是没做——与其塞一个凑合的实现，不如让使用者按需接
（KaTeX / Mermaid / PhotoSwipe / giscus 都有成熟的接入方式）。

---

## 关于「中文排版」这一栏

上表里「唯一做到」指的是这些，都是可以逐条验证的：

- `text-autospace: normal` —— 中西文之间自动插约 1/4 空格
- `text-spacing-trim: trim-start` —— 中文标点字距调整
- 行宽 `34em` 而不是 `66ch`（中文按 `ch` 算会排出约 130 字一行）
- `em, i { font-style: normal }` —— 中文没有斜体字形，强制倾斜即笔画变形
- `font-synthesis-weight: none` —— 关掉伪合成字重

取值理由见 [中文排版取值](cjk-typography.md)，实测数字见 `npm run verify`。

## 关于「周下载量」那类论据

README 里提到过 `astro-markdown-for-agents` 与 `astro-markdown-export` 的周下载量
（106 与 17）。**这类数字只说明「没人用」，不说明「做不出来」**——真正的论据是
它们的实现卡在哪，见 [内容协商](content-negotiation.md)。
