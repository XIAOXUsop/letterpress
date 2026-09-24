# letterpress

> **一个中文排版讲究、开箱即用的静态博客。**
> 零配置就能跑，改一个文件就能上线；文章给人读，markdown 给 AI 读。

<div align="center">

**[▶ 在线 Demo](https://xiaoxusop.github.io/letterpress/)** · **[文档](#深入)** · **[仓库](https://github.com/XIAOXUsop/letterpress)**

![Astro](https://img.shields.io/badge/Astro-7-FF5D01?logo=astro&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)
![JS](https://img.shields.io/badge/外部%20JS-0%20个-2C5E2E)
![tests](https://img.shields.io/badge/测试-481%20项-2C5E2E)

</div>

![首页](docs/home.png)

<details>
<summary><b>English</b></summary>

**A static blog template that gets Chinese typography right — and serves markdown to AI agents.**

- **Zero config.** `npm install && npm run dev` is the whole setup. Change a few
  lines in one file to go live. No database, no env vars.
- **Content negotiation on free static hosting.** Claude Code / Cursor / OpenCode
  send `Accept: text/markdown`; this template answers with markdown
  (RFC 9110 + RFC 7763). Edge shims for Cloudflare Pages, Netlify and Vercel are
  included — the part two existing Astro integrations explicitly skip.
  Estimated saving: **57.7% / 55.1%** of tokens (heuristic estimate, not a real tokenizer — see the note in the docs). → [details](docs/content-negotiation.md)
- **CJK typography, not Western defaults.** Line-height `1.75`, a `34em` measure
  (≈34 Chinese chars ≈ 68 Latin — **approximate**; what's guaranteed is that the
  column tracks font-size, not how many characters fit), native `text-autospace`,
  no synthetic italics.
- **A knowledge layer whose lint fails the build.** `[[wiki links]]` with
  backlinks; a broken link stops the build instead of rotting silently.
- **Conclusions carry their provenance.** Sources are pinned to a dated spec
  revision; editing the body without re-reviewing fails the build, so "reviewed"
  never becomes a stale green checkmark. The same state ships in
  `content-manifest.json` / `content.ndjson`, so a subscriber can tell which
  pages are no longer trustworthy — and pages that are *this project's own
  choices* say so explicitly instead of pretending to cite something.
- **No external JS.** Article pages ship 0 JS files (2.5 KB inlined); only the
  search page on-demand loads same-origin Pagefind. · 481 unit tests · MIT

Everything below is in Chinese. Live demo → <https://xiaoxusop.github.io/letterpress/>

</details>

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

## 三件别人没做的事

### 一、给 AI 读的 markdown，而不是加个 `llms.txt` 交差

Claude Code、Cursor、OpenCode 请求网页时会发 `Accept: text/markdown`。
这是 HTTP 从 1.1 就有的**内容协商**，不是新发明。

**但静态博客做不到**——静态托管只吐文件，不解析请求头。这正是 Cloudflare 的
Markdown for Agents 要 Pro 及以上套餐、Vercel 的实现只在自己平台内生效的原因。
现有的两个 Astro 集成，一个**只在 dev server 里生效**，一个**完全不做协商**。

本项目补上它们跳过的那一段：**三个平台的边缘函数**，转换在构建期完成。
按本项目的启发式估算，同一页面的 markdown 比 HTML 省 **57.7% / 55.1%** 的 token。这不是模型真实用量；页面内容变化后需重新测量。

需要长期同步内容的 Agent / RAG 管线还可以读取
[`/content-manifest.json`](https://xiaoxusop.github.io/letterpress/content-manifest.json)：
它为每篇真实 `.md` 产物提供稳定 ID、SHA-256、字节数与链接关系，先比较 hash，
只下载变化的内容。清单不写构建时间，因此相同源码会得到逐字节相同的结果。

首次接入不必按清单逐篇请求：[`/content.ndjson`](https://xiaoxusop.github.io/letterpress/content.ndjson)
把同一批元数据与完整 Markdown 逐行输出，一次请求即可流式导入；后续再切回 manifest
做增量同步。它只负责可靠交付原文，不假装替消费端决定分块、向量模型或检索策略。

仓库还提供了可直接运行的参考同步器，把首次导入、按 hash 更新、删除传播、本地损坏修复
和失败回滚串成闭环：

```bash
npm run sync:content -- --origin=https://example.com --output=.verify/content-mirror
```

三个会**静默失败**的地方——不报错，只是永远不生效：

1. **Claude Code 不发 q 值，只靠顺序。** 缺省 q 是 1.0，两个候选并列；
   用严格的 `>` 比较会判成「无偏好」而返回 HTML。
2. **通配符 `*/*` 不等于「想要 markdown」**，它意思是「给什么都行」。
3. **`q=0` 是明确拒绝**，不是「偏好为零」。

→ [完整论证、七个 agent 的实测请求头、收益率](docs/content-negotiation.md)

### 二、中文排版按中文的规矩来

![文章页](docs/article.png)

<details>
<summary>暗色模式（同一个页面）</summary>

![文章页 · 暗色](docs/article-dark.png)

</details>

| 参数 | 西文常用 | 本项目的取值 |
|---|---|---|
| 行高 | 1.4–1.5 | **1.75** |
| 行宽 | `66ch` | **`34em`** |
| 强调 | 斜体 | **加粗**（中文没有斜体字形） |
| 中西文间距 | 手动加 / pangu.js | **`text-autospace`**（原生） |

`34em` 是关键：它让内容栏宽度**稳定地跟随字号**（`em` 等于计算后的 font-size，
这一点规范保证且与字体无关），因而能**大致覆盖**中文的 30–40 字
与西文的 45–75 字符两个理想区间。`ch` 连容器宽度都不稳——
它等于**渲染所用字体**里「0」字形的宽度，换个字体这个数就变。

⚠️ 两处都是**近似**，别当成换算式：「34em ≈ 34 字」依赖「汉字约 1em 宽」，
而这**不是规范保证**（规范为此专门定义了 `ic` 来表示全角字形的典型 advance）；
「66ch ≈ 33 字」则额外依赖「0 字形约 0.5em」这个未实测的假设。
**被保证的是容器宽度，不是每行字数。**


### 三、知识层，断链会让构建失败

文章是**流**（按时间排，读过就沉底），知识是**网**。所以有一层独立的
`src/content/wiki/`，用 `[[方括号]]` 互链。

这是 Karpathy 在 2026 年 4 月提出的 LLM-wiki 模式，但做了一处关键改动：

> **体检是确定性的，不是「让 agent 定期看看」。**

后者不可复现、不可回归、进不了 CI。所以会腐烂的机械问题做成了代码：
**断链会使构建中止**，出口写在错误信息里，不用查文档。

还有一处改动在别处：结论的**出处**。

```yaml
sources:
  - sourceId: css-values-4
    revision: WD-20240312        # 钉到具体日期的规范版本
    locator: §5.1.1 长度单位 · ch
review:
  status: reviewed
  contentDigest: 0e700777…        # 复核当时正文的摘要
```

改了正文而没重新复核，`review-stale` 会**让构建失败**——
「已复核」不会变成一个没人更新的永久绿标。
而机器出口（`content-manifest.json` / `content.ndjson`）里带着同一份状态，
**订阅者能知道哪一篇已经过期**。

不是每条结论都要登记：只标**值得单独治理的那些**。
而「这一页讲的是本站自己的设计选择、外部没有对应规范」是**单独一种状态**
（`original`）——否则「没登记来源」就分不清是该补还是正常。

---

## 实测数据

| 项 | 结果 |
|---|---|
| 单元测试 | **481 项**，全部离线，无网络依赖 |
| 内容清单 schema | `/content-manifest.schema.json`（JSON Schema 2020-12，与产物同源发布），`additionalProperties: false` 让「悄悄加字段」变成一次显式决定。门禁核**三处 version 一致**（源码常量 / 产物 / schema）——它们各自都能独立改，而只有两处改了就没人发现 |
| 端到端契约 | **201 项**，打在真实构建产物上（由脚本自己打印；含按内容页数展开的断言，条数随内容浮动） |
| 门禁编排 | **31 步**，`check-gates` 逐条核对「声明了什么、顺序对不对、脚本存不存在、有没有定义了却不在编排里的」。其中五道是**会先弄坏自己再证明能报红**的负向验证 |
| 文档与代码一致 | `AGENTS.md` 的**可证伪声明**逐条核对——它举的 lint 规则名真的存在吗、例子里那个 slug 真的存在吗、「写标题与写 slug 指向同一页」真的是真的吗。那份文件是**给 agent 读的约定**，它若与代码不符，agent 会照着错的改，**而所有门禁都绿** |
| 抽象边界 | 核心模块不硬编码本站结构（知识库 URL 前缀、根层保留路由表均可注入），有**四次变异的负向验证**证明这道检查是尺子而非装饰。另有一份**读自文件的**异构内容集（6 篇：中文 slug、`§1` 编号章节、`audience:` 字段、同名标题、孤儿页），**18 条断言 + 7 种破坏的负向验证**全部成立。⚠️ 但它**只证明「核心不依赖本站的形状」**——适配层那 20 行仍是接新站点时要写的，而「接入确实减少重复维护」这一条**仍无证据**（fixture 是测试语料，不是真的第二站点） |
| 搜索检查 | 页面语言、索引语言、索引覆盖面 3 条产物级断言。真实浏览器里的实测基线见 `scripts/check-search.mjs` 的注释 |
| slug 口径 | CLI / 检索与构建产物**用同一个 `resolveSlug`**（显式 slug > 文件名 > 标题）。这条一致性能在**异构 fixture** 上抓到过一个真缺口：原先 `read-page` 直接用文件名，于是 `docId` 与 `content-manifest.json` 对不上——**而本仓库 0 篇写了 `slug:`，所以它在本站从未发作** |
| 检索金标 | **23 条**问题（精确事实 / 跨文档组合 / 冲突 / 过期 / **无答案**），跑 `npm run verify:questions`。其中 **3 条显式登记为已知局限**、不计为失败——它们的局限被打印出来，而不是被一条绿线盖过去。五道闸每道都有一条**专属**用例，关掉它只有那条会红（见 `docs/retrieval.md`） |
| 可复现构建 | UTC / America/Los_Angeles 两次完整构建，当前 **107 个文件跨时区逐字节一致**；另禁止生产源码读取构建时钟 |
| 构建 | 32 页；`astro build` 自报 **1.21 / 1.21 / 1.23 秒**（三次），整条 `npm run build` **2.94 / 2.98 / 2.96 秒**；Pagefind 自己报 0.136 秒、单独跑 `npx pagefind` 共 0.66 秒。**差值约 1.5 秒是 npm 起 node、连跑两条 npm script 的开销**（本机 Windows 实测；原表写的 1.1 / 2.6 秒偏低，且把差值的成因写成"npm 启动开销 + Pagefind 0.14 秒"，量级对、口径没有出处） |
| 外链 JS | **0 个**（内联也少：首页 2.5 KB） |
| 站内 JS | 文章页 **0 个文件**；只有搜索页按需加载同源 Pagefind 1.5.2，实测运行时资源 **6 个 js**、未压缩共 **431 KB**（441271 bytes；`npm run measure` 的口径，全部 6 个 gzip 合计 **105 KB**）；**访问者真正会加载的是 5 个 js**：`pagefind.js` + `pagefind-worker.js` + 三个 UI 包，未压缩 387 KB、**gzip 93 KB**；其中三个 UI 包单独算是 302 KB / gzip 69 KB。复测日期 2026-09-24；此前写的「17 个文件、146 KB gzip」在当前环境**已无法复现**（pagefind 版本未变而产物结构对不上），故改为可复现的口径 |
| CSS | 单文件 **24.1 KB / gzip 5.1 KB** |
| 字体 | **100 KB**（只含拉丁子集；中文走系统字体，零额外下载） |
| 对比度 | 亮暗双模式，所有文字实测 **≥4.5:1** |

---

## 已知限制

**如实列出，不打算假装这些不存在。**

- **Demo 部署在 GitHub Pages 上，因此跑不了内容协商**（Pages 的响应头不可改）。
  其余功能都可在线验证；内容协商需要 Cloudflare Pages / Netlify / Vercel，
  本地可用 `npm run verify` 复算——它打印的是**启发式估算**（CJK 1 字 1 token、
  其余 4 字符 1 token），不是模型真实用量；真实词表下的对照见 `docs/content-negotiation.md`。
  （对着 Demo 跑 `npm run verify:online` 会在协商那几项上报红——**那是这条限制本身，
  不是部署事故**；同一个脚本会同时证明 Pages 能做到的部分是好的。）

  > **2026-09-24 实测：那 8 项红的完整清单**（此前 README 只提了其中 2 项）。
  > `Vary: Accept` 缺失（实际是 `Vary: Accept-Encoding`）、
  > `Content-Location` 缺失、`Link: rel="alternate"` 缺失——
  > **三项都没登记过**，而它们与协商是**同一件事**（响应头不可改）。
  >
  > 还有第 7 项值得单独说：**线上 `content-manifest.json` 仍是 `version: 1`**，
  > 而本地已是 v2。**Demo 的订阅者至今拿不到 `provenance`**——
  > 迭代 AN 做的 v1→v2 迁移器正是为此准备的，**但主分支还没合并**。
  > 在 `test` 分支合入 main 并重新部署之前，这一条不会变。
  >
  > 顺带一提：**`verify:online` 此前根本跑不起来**（第 0 步就崩），
  > 而它在门禁编排里挂着的理由是「基线本身就是红的」——
  > **那句「基线是红的」从来没被实测过**。它连跑都跑不起来。
  > 修好之后才有上面这份清单。
- **同一个限制还影响 `/content.ndjson` 的 Content-Type。** 源码里设的是
  `application/x-ndjson`，三个平台的配置也都声明了它，但 **Pages 上下不来**——
  2026-09-20 实测线上 Demo 返回的是 `application/octet-stream`
  （`.ndjson` 不在 Pages 认识的扩展名表里，响应头又不可改）。
  **按行解析不受影响**（`fetch(...).text()`、逐行读都照常），
  但按 MIME 分流、把 `octet-stream` 当下载附件的客户端会中招。
  详见 `docs/content-export.md`。
- **内容协商只对三个平台有现成实现。** GitHub Pages 不行；其他平台需自写垫片，
  共享逻辑在 `src/lib/negotiate/edge.ts`，约 40 行。
- **Vercel 的头配置（`vercel.json`）没有在 Vercel 上实际部署验证过**——
  本项目只在 GitHub Pages 上跑 Demo。选 Vercel 请自己 curl 一次确认。
- **七个 agent 里只有三个要 markdown。** Codex、Copilot、Gemini CLI、Windsurf
  目前都只接受 HTML。这个比例会变，但今天的事实就是这样。
- **分享图不含文字。** 给字体做光栅化需要 Satori + resvg 这类几十 MB 的依赖，
  本项目不引。平台会在卡片里单独显示标题，图片承担的是视觉标识。
  要带标题的分享图，在 frontmatter 里写 `cover:` 或 `ogImage:` 指向自制图片。
- **`og:image` 需要配置 `site.url`。** 分享图必须是绝对地址，没有域名时
  宁可不输出——给社交平台一个 `localhost` 地址会变成坏图，比没有更糟。
- **中文搜索的实测行为。** Pagefind 对 zh-cn 不做词干提取（构建时会打印提示），
  但实际召回不差：搜「中文排版」6 条且首条正是那篇文章，「内容协商」7 条，
  不存在的词返回 0 条。真正的边界在**子串**上——「排版」7 条，而「网页排版」
  只有 3 条，包含「排版」的段落不一定能被更长的词组命中。

  **这组数字只能在浏览器里测。** Pagefind 按页面的 `<html lang>` 选择分词器：
  同一份索引、同一个查询，脱离浏览器环境（Node 里没有 document）测出来的结果
  完全不同——「中文排版」在那边只有 1 条，还都是错的。lang 一旦丢失，搜索就会
  静默退回那个模式：文章还在，只是再也搜不到，而构建与测试全都不出声。

  所以 `npm run verify:search` 不去假装能查询，它断言的是这件事的前提：每个页面
  都声明了正确的语言，且**内容清单里的每一条都真的标了 `data-pagefind-body`、
  都进了索引**。真实浏览器里的完整实测基线写在 `scripts/check-search.mjs` 的注释里。

  > 前半句原先写的是「索引覆盖的页面数与标了 `data-pagefind-body` 的页面数一致」——
  > **那条断言是自比自的**：两个数来自同一个属性，页面漏标时两边等量下降，
  > 相等照样成立。实测（2026-09-22）：把知识库模板上的 `data-pagefind-body` 去掉、
  > 干净重建，6 个 wiki 条目整类退出索引（11 → 5），而它打印的是
  > 「✓ 索引覆盖 5 个页面，与标记了 data-pagefind-body 的页面数一致」并**通过**。
  > 现在改成从 `content-manifest.json` 独立推出"应被索引的页面集"（那是按内容层生成的，
  > 与 HTML 上有没有那个属性无关），再逐个页面确认。同一次变异现在会红：
  > `✗ 6/11 个内容页没进索引`，退出码 1。
- **面向 agent 的检索有一条已知软肋：中文提问一个语料里真的没有的主题，
  可能仍然给出「有依据」。** 原因不是没做检查，而是**二元组分不开两种东西**：
  「评论区」这种真的缺席的词，和「式方」（`样式`+`方案` 的接缝）这种分词副产物，
  在结构上完全一样。这一条**写进了金标并显式登记**，跑检查时会打印出来，
  而不是被一条绿线盖过去。详见 `docs/retrieval.md`。

  > 同一份金标里还有一处**自我登记**，而它**被推翻过两次**：
  >
  > 1. 最初写「把覆盖度门槛调成 0，19 条一条都不变红——门槛没被任何金标量到」；
  > 2. 2026-09-24 语料从 6 页扩到 11 页后，调成 0 会红 2 条，**第一条被推翻**；
  > 3. 同一天再测，发现**即便会红，那也是被别的闸「代劳」的**——
  >    把实词闸关掉，两条仍报「无依据」，因为另一道闸先一步拦下了。
  >    **一道闸被另一道闸遮住时，关掉它金标不会红。**
  >    补了专属用例（`OG 图片为什么不含文字？`）之后，五道闸才真正各有一条
  >    「关掉它只有这条会红」的用例。
  >
  > 留这一笔是因为它是个典型：**写在文档里的实测数字也是断言**，
  > 而且是最容易被当成客观事实的那一种——
  > 它当时是真的，两次之后就不是了，而它一直躺在文档里没人怀疑。
- **`llms.txt` 的实际效果被高估。** Ahrefs 实测 13.7 万个域名里 97% 从未被
  请求过。本项目生成它是因为零成本，**但不把它当卖点**。
- **`text-autospace` 与 `text-spacing-trim` 在 Safari / Firefox 上不支持**
  （MDN 兼容数据：Chrome 123+ 支持，Safari 与 Firefox 均不支持）。属渐进增强，
  不支持时版式不坏。
- **搜索的加载器要求 CSP 允许 `unsafe-eval`**，原因见
  [命令行](docs/cli.md#搜索的加载器为什么要求-csp-允许-unsafe-eval)。
- **没有数学公式、流程图、多语言、图片灯箱、评论。**

---

## 深入

| | |
|---|---|
| [内容协商](docs/content-negotiation.md) | 原理、七个 agent、会静默失败的三个地方、收益率 |
| [内容清单](docs/content-manifest.md) | Agent / RAG 如何按 SHA-256 增量同步，以及格式的真实边界 |
| [内容镜像同步](docs/content-sync.md) | 可运行的首次导入、增量更新、删除传播、损坏修复与失败回滚 |
| [全量导出](docs/content-export.md) | NDJSON 首次导入、逐行格式、校验与适用边界 |
| [部署](docs/deploy.md) | 四个平台、子路径、`Vary: Accept`、安全头 |
| [命令行](docs/cli.md) | 每个脚本做什么、两个会咬人的地方 |
| [AGENTS.md](AGENTS.md) | 给 AI agent 读的项目约定（知识层怎么写、检查怎么加） |

---

## License

[MIT](LICENSE) © 2026 XIAOXUsop

字体：[Archivo](https://github.com/Omnibus-Type/Archivo)、
[Public Sans](https://github.com/uswds/public-sans)、
[JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)，均为 SIL OFL 1.1。
