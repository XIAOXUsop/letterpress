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
| 站内 JS 体积 | 文章页 **0 个文件**；搜索页按需 **146 KB**（gzip） | 少量 + Pagefind | Swup + Svelte | 少量 + Fuse.js |

**如实说明本项目缺什么**：数学公式、流程图、多语言、图片灯箱、页面转场、评论。
这些都不是「做不到」，是没做——与其塞一个凑合的实现，不如让使用者按需接
（KaTeX / Mermaid / PhotoSwipe / giscus 都有成熟的接入方式）。

## 关于「站内 JS」这一行

它原先写作「外部 JS | **0 个文件**」——**那句话不算错，但读起来会得出错误结论。**

「外部」指第三方域名，这一项确实是 **0**：全站 HTML 里 `<script src>` 一个都没有，
脚本要么内联、要么同源。**但对面的三列写的都是它们站内自带的脚本**
（`少量 + Pagefind`、`Swup + Svelte`、`少量 + Fuse.js`），于是同一行里
**左列在答「有没有外链」、右列在答「带了多大 JS」**——口径不同却并排放着，
读出来的就是「本项目不加载 JS，它们加载」。不是这样。

实测（2026-09-22，`npm run build` 后的 `dist/`，由 `npm run verify:search` 每次打印）：

| 口径 | 结果 |
|---|---|
| 外链（第三方域名）JS | **0 个**（全站；`<script src>` 计数为 0） |
| 首页内联 JS | **2.45 KB**（4 段；另有 1 段 583 B 的 JSON-LD，那不算 JS） |
| 内容页 JS 文件 | **0 个** |
| 搜索页内联 | **4.24 KB**（加载器就在里面） |
| 搜索页**实际会取**的 Pagefind | **17 个文件 / 206 KB → gzip 146 KB**，其中索引分片 12 个 54 KB（按查询取） |

所以准确的说法是：**文章页零 JS 文件，搜索页有且只有 Pagefind，且只在搜索页加载，
代价是 gzip 146 KB。**

> 这个数**量错两次**，两次都是"看着挺对"：
> ① 只数 `dist/pagefind/` 顶层 → 漏掉 `index/` 与 `fragment/` 两个子目录，**整个索引没算**；
> ② 改成按顶层全算 → 又把三套本站根本不用的 Pagefind UI 包算进了访问者的下载量
> （`pagefind-ui.js` 120 KB、`pagefind-component-ui.js` 175 KB、`pagefind-modular-ui.js` 14 KB
> ——确凿：`pagefind.js` 正文里只出现 `pagefind-entry.json` 与 `pagefind-worker.js`，
> 三个 UI 包名一个都没有）。多算的那部分是 410 KB，它与访问者无关，只影响产物体积。
>
> 这也说明**数 `<script src>` 的检查永远给不出这个数**：Pagefind 由内联 loader +
> 动态 `import()` 拉取，全站 HTML 的 `src=` 计数恒为 0。
> 现在 `npm run verify:search` 按运行时文件集分组打印，两个数分开列。

> 对面那三列的数字**不是本项目实测的**，是写这一页时按各自仓库的默认配置估的
> （Fuwari 的 Swup 与 Svelte 来自它的默认依赖，AstroPaper / PaperMod 的
> Pagefind / Fuse.js 同理）。**要用它们做决策就自己构建一次再数**——
> 本项目没有把它们逐个 clone 下来跑过。

---

## 关于「中文排版」这一栏

上表里「唯一做到」指的是这些，都是可以逐条验证的：

- `text-autospace: normal` —— 中西文之间自动插约 1/4 空格
- `text-spacing-trim: trim-start` —— 中文标点字距调整
- 行宽 `34em` 而不是 `66ch`（`ch` 等于渲染字体「0」字形的宽度、**随字体浮动**；
  `em` 等于字号，跨字体可预测）
- `em, i { font-style: normal }` —— 中文没有斜体字形，强制倾斜即笔画变形
- `font-synthesis-weight: none` —— 关掉伪合成字重

取值理由见 [中文排版取值](cjk-typography.md)，实测数字见 `npm run verify`。

## 关于「周下载量」那类论据

README 里提到过 `astro-markdown-for-agents` 与 `astro-markdown-export` 的周下载量
（106 与 17）。**这类数字只说明「没人用」，不说明「做不出来」**——真正的论据是
它们的实现卡在哪，见 [内容协商](content-negotiation.md)。
