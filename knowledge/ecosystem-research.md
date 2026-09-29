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

---

## 2026-09-29（第二轮）：性能、缓存、可访问性与产物契约

### ⚠️ 先记一条方法论：**这一轮里有一条结论经不起核实**

子 agent 报告：「`netlify/` 目录下没有 `_headers` 文件，
所以同一份产物在 Netlify 上部署，`_astro/*` 拿不到一年缓存」。

**复核结果：不成立。** `public/_headers` 存在（2086 字节），
最后一段明确是：

```
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
```

而且我清过 `dist` 再构建，**`dist/_headers` 在产物里**——
所以 Cloudflare Pages 与 Netlify 两边都拿得到，**三平台是对称的**。

> ⚠️ **「我没找到」与「它不存在」在输出上完全一样**——
> 而这一条是**「它不在那个目录」**，而正确的位置是 `public/`。
> **这与本项目记过的「查不动 ≠ 没有」是同一族。**

**所以：这一轮的其他结论也不能直接采信。** 下面每条都标了我复核到哪一步。

### 复核过、成立的部分

**① gzip 会把强 ETag 降级为弱 ETag**（在本项目线上地址实测）

```
无 Accept-Encoding：   ETag: "6ab6ba2d-d2f"      ← 强
Accept-Encoding: gzip: ETag: W/"6ab6ba2d-d2f"    ← 弱，opaque-tag 完全相同
```

对应 RFC 9110 §8.8.3.3：内容编码后的表示应与未编码的用**不同的强 ETag**。

> **对本项目的含义**：「ETag 存在且稳定」这类断言**必须显式固定请求头**，
> 否则**自己跟自己不一致**。
> ⚠️ 而本项目目前**没有 ETag 断言**——这是「先记着，不急做」的那一类。

**② GitHub Pages 那个「10 分钟」是 publish 延迟，不是 CDN TTL**

官方文档原文（`docs.github.com` 的 Creating a GitHub Pages site）：

> "It can take up to 10 minutes for changes to your site to **publish** after
> you push… If you don't see… after **an hour**, see About Jekyll build errors…"

而实测响应头是 `Cache-Control: max-age=600`——**恰好也是 600 秒，
但纯属巧合，两件事独立**。措辞是 "to publish"、兜底是 "an hour"（部署语境）、
全文只出现这一次——三条都指向「部署延迟」。

> **同一句话被两种读法都当成证据**——而这正是本项目记过的那个坑。
> **分辨它靠的是「兜底那句话是什么语境」，不是靠数字对不对。**

**③ 四个平台的默认缓存头差异**（子 agent 实测，我未逐条复核）

| 平台 | HTML | 带指纹资源 |
|---|---|---|
| GitHub Pages | `max-age=600` | 同左（**不区分路径**） |
| Netlify | `max-age=0, must-revalidate` | 一年 immutable |
| Vercel | `max-age=0, must-revalidate` | 仅 `/_next/static/immutable/*` 一年 |
| **Cloudflare Pages** | `max-age=0, must-revalidate` | **同样 `max-age=0`** |

最反直觉的是 Cloudflare Pages：**对自己生成的哈希资源也不给长缓存**，
必须手写 `_headers`（withastro/astro#16692 佐证）。
**而本项目的 `public/_headers` 正是为此存在的**——它同时服务
Cloudflare Pages 与 Netlify（Vercel 走 `vercel.json`）。

### ⚠️ 复核后不成立 / 未能核实的

- **「Netlify 缺 `_headers`」**——不成立，见上。
- **两个「GitHub Pages 缓存住旧内容」的具名 issue 引用**
  （`MikeVeerman/dailydoom#16`、`AustinSiu/mtgAssistantBrewer#40`）——
  子 agent 自己标了「未能核实」，我同样**无法确认它们存在或其内容**。
  同类现象在 GitHub 上确有大量（cache busting / stale assets），
  **但不要引用这两个链接**。
- **Gatsby Cloud（已下线）/ Firebase Hosting 默认头 / 自定义域名的缓存头** ——
  均无官方文字支撑，**属推断**。

### 由此得出的两条可做判据（都还没做）

| 判据 | 能核什么 | 会漏什么 |
|---|---|---|
| **孤儿资源检测**（`dist` 文件集合 ⇄ HTML/CSS 引用集合求双向差集） | 未引用的原图、构建死 chunk、sitemap 里的幽灵 URL。**纯静态、零依赖** | 运行时按需加载的资源（`import()` 的目标）容易误判 |
| **跨部署文件名一致性**（不同目录 / 不同 TZ 各构建一次，**只比文件路径集合**） | Astro #17377 那类「字体哈希含绝对路径 → 换目录构建产物名不同」 | **只比文件名不比内容**是有意的——内容含时间戳是正常的，比内容会永远红 |

### 本项目**已做对**、而生态里 0/N 做对的（第一轮已记，这里补一条）

- `search.astro` 的两个 pagefind 坑（base 前缀 + 不用裸 `import()`）

---

## 2026-09-29：把调研建议的两条判据逐条实测，其中一条**不能照做**

调研建议加两道门禁：① **孤儿资源检测**（`dist` 文件集合 ⇄ HTML/CSS 引用集合
求双向差集）；② **跨部署文件名一致性**（不同目录 / 不同 TZ 各构建一次，
只比文件路径集合）。**这一节是照做之后的实测结论。**

### ① 孤儿资源检测：**噪声远大于信号，不能做**

在子路径构建（`SITE_BASE=/letterpress`）的产物上实跑：

```
产物 108 个文件 ｜ 归一化引用 170 条 ｜ 孤儿候选 68 个
```

**而那 68 个全是假阳性**，三类各有正当成因：

| 孤儿候选 | 数量 | 为什么它不是孤儿 |
|---|---|---|
| `pagefind/**` | 24+ | **运行时按 `pagefind-entry.json` 动态加载**，不写在任何 HTML 里 |
| `*/index.html` | 14 | **页面自己是入口**，本就不该被别处引用 |
| `tags/*`、`wiki/*` | 30 | **在 `sitemap-0.xml` 里**——而 sitemap 是第三方生成的，扫引用时容易只扫 HTML |

> **而 sitemap 那条我又量错了一次**：第一遍归一化时**没解码百分号**，
> 得出「14 个 tags URL 只有 6 个对得上产物」——
> **那是个假差异**（`tags/中文/` 在 sitemap 里是 `tags/%E4%B8%AD%E6%96%87`）。
> 解码后 **14/14 全对上，零幽灵**。
>
> ⚠️ **这已经是 2026-09-29 第三次「量法错了」**：
> Git Bash 把 `/letterpress` 转成 `D:/App/Git/letterpress`（pagefind 那次）、
> 百分号编码（这次）、用出现次数当代理（canonical 判据前两版）。
> **三次里有两次产出了一个看起来像缺陷的结果。**

**结论：这道门禁会长期红，而它红的时候没有一条是真的。**
「未引用资源」在静态站里**天然是个高噪声集合**——
**要做得准，就得知道每类资源的加载方式**，而那正是判断题。
⚠️ **误报的代价是逼人删掉有用的文件或加一堆白名单**——
**那比不做更坏**（与本项目「判据太宽会逼人写废话」同一条）。

**所以不做。** 而「不做的理由」必须写下来，
**否则下一个人会照着调研建议再提一次**（形态四的变体：查过且否决 ≠ 没人查）。

### ② 跨部署文件名一致性：**值得做，且本项目已经有 3/4 了**

直击 Astro #17377 那类缺陷：**字体或其他资源的哈希里含绝对路径**，
于是「在 A 目录构建」与「在 B 目录构建」产出的**文件名不同**，
部署到 Cloudflare 就会 404。

**本项目现有的 `verify:reproducible` 已经核跨时区**（同一目录、不同 TZ），
而 `check-base` 核子路径。**缺的是「不同目录」这一维**。

⚠️ **而「只比文件名不比内容」是有意的**——
`content-manifest.json` 之类含时间戳，**比内容会永远红**。
