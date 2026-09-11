# letterpress

> **一个中文排版讲究、开箱即用的静态博客。**
> 零配置就能跑，改一个文件就能上线；文章给人读，markdown 给 AI 读。

<div align="center">

**[▶ 在线 Demo](https://xiaoxusop.github.io/letterpress/)** · **[仓库](https://github.com/XIAOXUsop/letterpress)**

![Astro](https://img.shields.io/badge/Astro-7-FF5D01?logo=astro&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)
![JS](https://img.shields.io/badge/外部%20JS-0%20个-2C5E2E)
![tests](https://img.shields.io/badge/测试-215%20项-2C5E2E)

</div>

![首页](docs/home.png)

---

## 30 秒开始

```bash
npm install
npm run dev     # → http://localhost:4321
```

**不用改配置、不用建数据库、不用填环境变量。** 你现在看到的就是完整站点。

上线只改 `src/config.ts` 里的几行：

```ts
export const site: SiteConfig = {
  title: '你的站名',
  url: 'https://example.com',      // 部署前填，不留斜杠
  lang: 'zh-CN',                   // 别改错，浏览器的中文标点规则依赖它
  author: { name: '你的名字', bio: '一句话介绍自己。' },
};
```

没配完也没关系——**关于页会列出还差哪些字段**，改完提示自动消失。

---

## 你拿到什么

| | |
|---|---|
| 📝 **写作** | Markdown / **MDX**，草稿在 `dev` 下可见、构建时自动排除；置顶、标签 |
| 🔍 **搜索** | Pagefind 全文检索，构建期建索引，零后端。**零 JS 依赖**——不搜索就不加载 |
| 🧭 **导航** | 目录（锚点与渲染器逐字对齐）、上一篇/下一篇、分页、按年归档、标签索引 |
| 🖼️ **配图** | 封面图可选；**不提供也有**——由 slug 确定性生成几何封面，与站点设计同源 |
| 🔗 **分享** | 1200×630 分享图（PNG，由构建生成）、Open Graph、Twitter 卡片、JSON-LD |
| 📡 **订阅** | RSS **全文输出**（含分类与作者）、sitemap、robots.txt |
| 🌏 **中文** | 行高 1.75、标题字重按中文字体特性选、行宽 `34em`、`text-autospace` 中西文自动间距、中文不用斜体 |
| ♿ **无障碍** | 跳转链接、100% 可见焦点、`prefers-reduced-motion`；**对比度有自动化测试**（解析 `tokens.css` 逐对验算，亮暗双模式） |
| 🤖 **给机器** | 每个页面有 `.md` 孪生文件；`Accept: text/markdown` 直接返回 markdown；`llms.txt` 与 `llms-full.txt` |
| 🧠 **知识层** | 用 `[[方括号]]` 互链的独立知识库；断链**会让构建失败**；每次构建出体检报告 |
| 🌗 **主题** | 三态（跟随系统 / 亮 / 暗），无闪烁（恢复脚本在 `<head>` 同步执行） |
| 📦 **交付** | 纯静态，零外部 JS 文件；CSS 单文件 21.1 KB（gzip 4.5 KB）；字体只含拉丁子集 100 KB |
| 🚀 **部署** | Cloudflare Pages / Netlify / Vercel / 任何静态托管；三个平台的内容协商垫片已写好 |

---

## 为什么用它，而不是 AstroPaper / Fuwari / PaperMod

先说结论：**如果你的首要需求是「功能越多越好」，选 Fuwari**——它有 KaTeX、Mermaid、多语言、图片灯箱、页面转场，这些本项目都没做。

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

## 三件别人没做的事

### 一、给 AI 读的接口，而不是加个 `llms.txt` 交差

Claude Code、Cursor、OpenCode 请求网页时会发 `Accept: text/markdown`。
这是 HTTP 从 1.1 就有的**内容协商**（RFC 7231 + RFC 7763），不是新发明。

**但静态博客做不到**——静态托管只吐文件，不解析请求头。
这正是 Cloudflare 的 Markdown for Agents 要 Pro 及以上套餐、
Vercel 的实现只在自己平台内生效的原因。

| 现有方案 | 卡在哪 |
|---|---|
| Cloudflare Markdown for Agents | 要 Pro 及以上付费套餐 |
| Vercel 内容协商 | 只在自己的平台内生效 |
| `astro-markdown-for-agents` | 协商**只在 dev server 里生效**，README 直说「不含托管平台垫片」 |
| `astro-markdown-export` | 只复制 `.md` 文件，**完全不做协商** |

后两者的周下载量是 **106 和 17**（主流 Astro 集成是三十万到两百万）。
**不是「已解决只是没人知道」，是「有人碰过就放弃了」。**

本项目补上它们跳过的那一段：**三个平台的边缘函数**，转换在构建期完成。

**七个 agent 的真实请求头**（2026-02 实测，固件在 `accept.test.ts` 里）：

| Agent | 要 markdown |
|---|---|
| Claude Code / Cursor / OpenCode | ✅ |
| Codex / Copilot / Gemini CLI / Windsurf | ❌ |

三个必须做对的地方，每一条都对应一个**会静默失败**的实现：

1. **Claude Code 不写 q 值，只靠顺序。** 缺省 q 是 1.0，两个候选并列；
   用严格的 `>` 比较会判成「无偏好」而返回 HTML——**不报错、不警告，只是永远不生效**。
2. **通配符不算「想要 markdown」。** 只发 `*/*` 的客户端意思是「给什么都行」。
3. **`q=0` 是明确拒绝**，不是「偏好为零」。

**实测收益**（`npm run verify` 会打印）：

```
页面                         HTML token   MD token       节省
/markdown-for-agents/            4495       1654    63.2%
/cjk-web-typography/             5206       1796    65.5%
```

> **为什么低于 Cloudflare 的 80% 和 Vercel 的 99.6%？**
> 因为**这个站的 HTML 本来就很干净**——零 JS、极简导航、语义化标签。
> 内容协商的收益与页面冗余度成正比：文档站收益大，精简博客收益小。
> 不打算把这个数字往好看里说。

<details>
<summary><b>顺带说一句 llms.txt</b></summary>

它的实际效果被严重高估：Ahrefs 2026 年 5 月实测 **137,210 个域名，
97% 的 llms.txt 从未被请求过**；剩下 3% 里 96% 是机器人噪声。
Google 明确不支持。

本项目生成它是因为零成本，**但不把它当卖点**。真正起作用的是内容协商。

</details>

### 二、中文排版按中文的规矩来

![文章页](docs/article.png)

<details>
<summary>暗色模式（同一个页面）</summary>

![文章页 · 暗色](docs/article-dark.png)

</details>

多数主题（包括中文圈的）直接套用为西文调好的参数：

| 参数 | 西文常用 | 本项目的取值 | 为什么 |
|---|---|---|---|
| 行高 | 1.4–1.5 | **1.75** | 方块字笔画铺满字面，没有升降部带来的天然空隙 |
| 标题字重 | 600–700 | **600**（配 `font-synthesis-weight: none`） | 关掉伪合成后由字体自己挑真实字重：拉丁拿到真 600，中文落到 700 |
| 行宽 | 66ch | **34em** | `ch` 按西文「0」宽算；一个汉字约等于两个 `ch` |
| 强调 | 斜体 | **加粗** | 中文无斜体字形，强制倾斜即笔画变形 |

`34em` 是关键：一个汉字约 1em 宽、一个西文字母平均约 0.5em 宽，
于是它**同时满足**中文的 30–40 字与西文的 45–75 字符两个理想区间。

还开了 2026 年的原生属性：

```css
html { text-autospace: normal; text-spacing-trim: trim-start; }
```

前者自动在中西文之间插入约 1/4 空格（过去要靠 pangu.js 在客户端跑正则），
后者做中文标点字距调整。**前提是 `<html lang>` 正确**——写错了不会报错，
只是所有中文排版规则静默失效。

### 三、知识层，以及让体检拦住构建

文章是**流**（按时间排，读过就沉底），知识是**网**。
所以有一层独立的 `src/content/wiki/`，用 `[[方括号]]` 互链。

这是 Karpathy 在 2026 年 4 月提出的 LLM-wiki 模式，但做了一处关键改动：

> **体检是确定性的，不是「让 agent 定期看看」。**

后者不可复现、不可回归、进不了 CI。所以会腐烂的机械问题做成了代码：

```
知识库体检：1 个错误
  [broken-wikilink] 「某篇文章」引用了 [[不存在的页面]]，但没有这个页面。
  → 要保留知识层：在 src/content/wiki/ 下建这个页面。
  → 不要知识层：在 src/config.ts 里把 wiki.enabled 设为 false，检查会自动关闭。
```

**断链会让构建失败——这是刻意的。** 出口写在错误信息里，不用查文档。

语义级的检查（「这两页说法矛盾」）留给 agent，约定写在 `AGENTS.md`。

---

## 命令行

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（草稿可见） |
| `npm run build` | 构建 + Pagefind 索引（含体检，有错误会中止） |
| `npm test` | **215 项**单元测试，全部离线 |
| `npm run verify` | 端到端：对着**真实构建产物**验证 56 项契约 |
| `npm run check` | 类型检查（Astro + TypeScript） |
| `npm run clean` | 删掉 `.astro/` 与 `dist/` |

> **改了 `astro.config.mjs` 里的 markdown 配置后必须 `npm run clean`。**
> 内容层有缓存，不清理会让你以为改动没生效。这个坑我们踩过——
> 当时所有 `[[链接]]` 都没渲染出来，而全部测试全绿、构建成功、lint 通过。

---

## 部署

| 平台 | 构建命令 | 输出 | 内容协商 |
|---|---|---|---|
| **Cloudflare Pages** | `npm run build` | `dist` | ✅ 免费套餐即可用 |
| **Netlify** | 同上 | `dist` | ✅ 免费额度 100 万次/月 |
| **Vercel** | 同上 | `dist` | ✅ |
| **GitHub Pages（项目站）** | `SITE_BASE=/仓库名 npm run build` | `dist` | ❌ 响应头不可改 |

> ⚠️ **部署到 GitHub Pages 的项目站必须设 `SITE_BASE`。**
> 项目站地址形如 `https://<用户名>.github.io/<仓库名>/`，站点跑在子路径下。
> 不设这个变量的话，所有以 `/` 开头的链接都会指向域名根，**整站点不动**——
> 而这个问题在本地 `npm run dev` 下完全看不出来（本地 base 是 `/`，前缀为空）。
> 一条命令验证：`npm run verify:base`。

**GitHub Pages 用不了内容协商**（响应头不可改）。站点照常工作，
agent 拿到 HTML——`.md` 孪生文件仍在，通过 URL 加 `.md` 可访问。

> **`Vary: Accept` 不能省。** 少了它，CDN 会把 markdown 缓存下来发给浏览器，
> 用户打开博客看到一坨纯文本。这个 bug 只在缓存命中时出现，
> 排查时看起来像「网站有时候会坏」。三个平台的头配置都已备好。

---

## 实测数据

| 项 | 结果 |
|---|---|
| 单元测试 | **215 项**，全部离线，无网络依赖 |
| 端到端契约 | **56 项**，打在真实构建产物上 |
| 构建 | 23 页约 **1.4 秒** |
| 外部 JS | **0 个文件**（首页仅 2.4 KB 内联） |
| CSS | 单文件 **21.1 KB / gzip 4.5 KB** |
| 字体 | **100 KB**（只含拉丁子集；中文走系统字体，零额外下载） |
| 对比度 | 亮暗双模式，所有文字实测 **≥4.5:1** |

---

## 已知限制

**如实列出，不打算假装这些不存在。**

- **Demo 部署在 GitHub Pages 上，因此跑不了内容协商**（Pages 的响应头不可改）。
  其余功能都可在线验证；内容协商需要 Cloudflare Pages / Netlify / Vercel，
  本地可用 `npm run verify` 实测——它会打印真实的 token 节省数字。
- **内容协商只对三个平台有现成实现。** GitHub Pages 不行（响应头不可改）；
  其他平台需自写垫片，共享逻辑在 `src/lib/negotiate/edge.ts`，约 40 行。
- **七个 agent 里只有三个要 markdown。** Codex、Copilot、Gemini CLI、Windsurf
  目前都只接受 HTML。这个比例会变，但今天的事实就是这样。
- **分享图不含文字。** 给字体做光栅化需要 Satori + resvg 这类几十 MB 的依赖，
  本项目不引。平台会在卡片里单独显示标题，图片承担的是视觉标识。
  要带标题的分享图，在 frontmatter 里写 `cover:` 或 `ogImage:` 指向自制图片。
- **`og:image` 需要配置 `site.url`。** 分享图必须是绝对地址，没有域名时
  宁可不输出——给社交平台一个 `localhost` 地址会变成坏图，比没有更糟。
- **中文搜索没有词干处理。** Pagefind 对 zh-cn 不做词干提取（中文本来也没有
  词形变化），但**会影响召回**：「排版」能搜到，「网页排版」不一定能命中
  包含「排版」的段落。这是静态站搜索的固有限制。
- **`llms.txt` 的实际效果被高估**（见上文数据），生成它是因为零成本。
- **`text-autospace` 与 `text-spacing-trim` 在 Safari / Firefox 上不支持**
  （后者全球覆盖约 72%）。属渐进增强，不支持时版式不坏。
- **搜索的加载器要求 CSP 允许 `unsafe-eval`。** Vite 会把 `import()` 包成
  `__vitePreload(…, __VITE_PRELOAD__)`，而 Pagefind 的索引是构建后生成的、
  Vite 替换不了那个占位符 → 运行时报 `ReferenceError` 且**不发出任何网络请求**。
  绕开办法是 `new Function` 构造导入，代价是这条 CSP 要求。
  若你启用了严格 CSP，需要为搜索页开例外或改用其他加载方式。
- **没有数学公式、流程图、多语言、图片灯箱、评论。** 见上文对比表。

---

## 设计取舍

**为什么不用 Tailwind。** 这套版式靠精确的网格与字体控制，手写 CSS +
自定义属性 + `@layer` 能完全控住，依赖面也更小。一个博客模板要活十年，
依赖少是优势。

**为什么字体只自托管拉丁子集。** 中文字体单文件 5–20 MB。配合
`unicode-range`，中文自动落到系统字体（苹方/雅黑/思源黑体）——
**这不是回退，是分工。**

**为什么内容协商的转换在构建期做。** 运行时转换意味着每次请求都要现算；
静态产物直接命中 CDN 缓存：零运行时成本、零冷启动、源站挂了也不受影响。

**为什么体检失败会让构建中止。** 一个不会失败的检查等于没有检查。

**为什么配色刻意避开了「米色 + 衬线体 + 鼠尾草绿」。** 那是 2026 年新的
AI 默认值——看起来「有品味」，但换掉的只是默认值本身。瑞士国际主义
（一个强调色、网格、几何、全直角）是一个有据可依的选择，不是反射。

---

## License

[MIT](LICENSE) © 2026 XIAOXUsop

字体：[Archivo](https://github.com/Omnibus-Type/Archivo)、
[Public Sans](https://github.com/uswds/public-sans)、
[JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)，均为 SIL OFL 1.1。
