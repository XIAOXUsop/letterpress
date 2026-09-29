# 生态调研记录

**为什么要留这份文件**：README 里那些「本项目做了、别人没做」的断言，
**只有配上可核的数据才不是自我评价**。这份文件是那些数字的出处。

---

## 2026-09-29：中文排版与 AI 供给的生态对比

**方法**：拿 6 个同类项目的**全部 CSS/SCSS 源码**（约 44 万字符）做属性级检索，
不是读 README 的自述。检索口径只覆盖 `.css` / `.scss`，
**未覆盖文档里的排版说明** —— 这是这份统计的已知边界。

**样本**：`fuwari` / `astro-paper` / `Firefly` / `retypeset` / `erudite` / `Frosti`

### 中文排版属性的命中率

| 属性 | 6 个项目里命中的 | 本项目 |
|---|---|---|
| `text-autospace`（中西文自动间距） | **1/6** | ✅ |
| `text-spacing-trim`（标点挤压） | **0/6** | ✅ |
| `line-break: strict`（标点避头尾） | **0/6** | ✅ |
| `font-synthesis`（禁合成斜体） | **0/6** | ✅ |
| CJK 字体名（Noto SC / 思源 / 苹方 / 雅黑…） | **0/6** | ✅ |
| 覆盖 CJK 的 `unicode-range` | **0/6** | ✅ |

**唯一命中的那个**（retypeset）是一行 `text-autospace: normal`，
而它的 `unicode-range` 只覆盖 `U+0020-007E` 等**纯拉丁区段**——
**也就是说那 1/6 在 CJK 上等于 0/6。**

`Firefly` 有字体子集化管线（`scripts/subset-fonts.ts`），
但它处理的是用户上传的**本地字体**，字库扫描命中的是西文（Inter），
**没有 CJK 字体名**——**有管线 ≠ 处理中文**。

### 这解释了 issue 的形态

同一批项目的 **28 条中文相关 issue** 里，**绝大多数是「字体加载失败」
而不是「排版难看」**：

- `astro-paper#644` — `getFontPathByWeight` 不支持多字重
- `astro-paper#349` — 动态字体下载 400
- `astro-paper#499` — Noto Sans 字体规格无效
- `Firefly#654` — 本地导入不支持多字重

**根因是这些项目的中文走系统 fallback**，字形与度量都不可控，
所以连「加载成功」都做不到。

### AI 供给：几乎没有人在做

**707 条 issue**（5 个仓库全量，GitHub search API `is:issue`）
按 AI/LLM 关键词聚类：**命中 1 条**——
`CuteLeaf/Firefly#627`「Add Atom feed and llms.txt support」（仍在 open）。

对比同批数据：导航/分类 55 条、图片/OG 47 条、部署 38 条。
**AI 供给的 issue 密度比部署低两个数量级。**

> ⚠️ **这既是好消息也是坏消息**：没人抢这个位子（竞争≈0），
> **但也说明终端用户还没把它当成需求**（自发需求≈1 条 issue）。
> **本项目的定位判断是对的，但不能靠「用户已经在要」来论证。**

### 内容协商：生态 0/8，但基础设施厂商在投票

- 最接近的竞品 `astro-llms-md`（**月下载 10,525**，这条线上最高的 Astro 包）
  靠 `turndown` + `node-html-parser` **在构建后生成静态文件**，
  **原理上做不了请求期协商**。
- **Cloudflare Markdown for Agents 已在生产运行**，
  官方文档逐字写明需要 **Pro 或 Business 套餐**。
  实现细节：请求头 `Accept: text/markdown`、
  响应头 `x-markdown-tokens`、`Content-Signal: ai-train=yes, search=yes, ai-input=yes`。
- 消费端已在适配：openclaw PR **#15419**、**#16590**。
- 同一模式在别处被独立实现：Next.js PR #90956、Ghost PR #28931、
  WordPress/ai PR #194。GitHub 全站相关检索命中 **3,098** 条。

**llms.txt 的争议是真的**：llmstxt.org 现行 v2（`AnswerDotAI/llms-txt`，2,638 star）。
争议在 `AnswerDotAI/llms-txt#40`——维护者 jph00 两次否决把 llms.txt
与 `Accept` 头关联（「它不是一个内容类型，是另一份文档」），
而实际实现者 janwilmake 主张用 accept 头。

> **结论（推断）**：本项目**同时提供 llms.txt 与内容协商，等于同时站两边**
> ——这是规避争议的合理位置，不是需要选边的赌注。

### 生态里排前列的需求（707 条 issue，带编号）

| 类别 | 条数 | 覆盖仓库 |
|---|---|---|
| 导航/菜单/分类/标签 | **55** | 3/5 |
| 图片/媒体/OG | **47** | 4/5 |
| 部署（base path / 平台） | **38** | 5/5 |
| MDX/Mermaid/admonition | 32 | 3/5 |
| 中文/CJK 排版 | 28 | 3/5 |
| 搜索（Pagefind） | 21 | 5/5 |
| 评论系统 | 14 | 4/5 |
| **AI/LLM** | **1** | 1/5 |

**前四名全是「基础设施没做扎实」型，不是「想要新功能」型。**
其中两条与本项目直接相关，且本项目**已做对**：

1. **Pagefind 在特定部署平台失效**（5 条 / 3 仓库 / 4 种环境）
   —— fuwari#696、#774、#705；Firefly#311；Frosti#79
2. **子路径 / base path 部署**（5 条）
   —— astro-paper#493、#312；Firefly#450；retypeset#84、#15

⚠️ **而 `search.astro` 那个页面两个坑都处理了**（base 前缀 + 不用裸 `import()`），
**0/6 竞品做对**。核实方式见台账里「我以为它坏了而其实是我的测量方式错了」那一节。

### Mermaid（本项目 1.0.0 加的那项）

5 条 issue / 4 个仓库：fuwari#671、#564；astro-paper#326；Firefly#608；erudite#88。
**属于「不落后」清单，不是差异化**——但生态里它是标配，不做就是落后。

---

## ⚠️ 这份调研的已知局限

1. **GitHub 未认证限流**：core 60 次/小时、search 10 次/分钟。
   聚类跑完 5 个仓库后触发 403，`erudite` / `Frosti` / `Twilight`
   **在聚类表中是 0，不是 0 命中**——它们的 issue 总量另行测得为 37 / 23 / 57，
   **但未参与聚类**。**提高置信度需用 token 重跑这三家。**
2. **`/repos/{repo}/issues` 端点是混的**——它同时返回 PR，
   会系统性高估「PR 密集型」仓库的 issue 密度。
   改用 search API `is:issue` 后数字才对上（fuwari 284）。
3. **两处未独立核实**：Vercel 内容协商「只在自己平台内生效」；
   Cloudflare 的 Pro/Business 门槛**已核实**（官方文档逐字写明）。
4. **本项目 star 数在调研时为 1**（`XIAOXUsop/letterpress`，创建 2026-09-11）。
   生态 star 排第 1 的是 astrowind（6,000），排第 3 的是 fuwari（5,045）。
   **star 反映历史积累而非活跃度**——fuwari 有 102 个 open issue 而 astrowind 只有 2 个。
