# letterpress

> **一个把中文排版做对、同时写给人和 AI 读的静态博客。**
> 文章给学生时间读的人，知识层给来查概念的人，markdown 给 agent。

<div align="center">

![Java](https://img.shields.io/badge/Astro-7-FF5D01?logo=astro&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)
![static](https://img.shields.io/badge/output-100%25%20static-2C5E2E)

</div>

![首页](docs/home.png)

---

## 30 秒开始

```bash
npm install
npm run dev
```

打开 http://localhost:4321 就是上面那样。**不用改任何配置，不用建数据库，不用填环境变量。**

上线只改一个文件——`src/config.ts` 里的 `site`、`author`、`nav` 三项：

```ts
export const site: SiteConfig = {
  title: '你的站名',
  url: 'https://example.com',   // 部署前填
  // …
};
```

---

## 它和别的博客模板有什么不同

不是「功能更多」。是三件**有证据表明现有方案没做好**的事。

### 一、对 AI agent 真的可读（不是加个 llms.txt）

Claude Code、Cursor、OpenCode 请求网页时会发 `Accept: text/markdown`，
表示「我更想要 markdown，不行的话 HTML 也行」。这是 HTTP 从 1.1 就有的
内容协商，标准依据是 RFC 7231 与 RFC 7763。

**但静态博客做不到这件事**——静态托管只吐文件，不解析请求头。
这正是 Cloudflare 的 Markdown for Agents 要 Pro 及以上套餐、
Vercel 的实现只在自己平台内生效的原因。

| 现有方案 | 卡在哪 |
|---|---|
| Cloudflare Markdown for Agents | **要 Pro 及以上付费套餐** |
| Vercel 内容协商 | 只在自己的平台内生效 |
| `astro-markdown-for-agents` | 协商**只在 dev server 里生效**，README 直说「不包含托管平台垫片」 |
| `astro-markdown-export` | 只复制 `.md` 文件，**完全不做协商** |

后两者的周下载量分别是 **106 和 17**。主流 Astro 集成是三十万到两百万。
**这不是「已经解决了只是没人知道」，是「有人碰过就放弃了」。**

本项目补上的正是它们跳过的那一段：**三个平台的边缘函数实现**。

```
Cloudflare Pages →  functions/[[path]].ts           （免费套餐即可用）
Netlify         →  netlify/edge-functions/negotiate.ts
Vercel          →  middleware.ts
```

转换在**构建期**完成（生成 `.md` 孪生文件），边缘只负责「给哪个」——
零运行时转换成本，边缘函数挂了站点照常工作。

<details>
<summary><b>实测数据与踩过的坑</b></summary>

**七个 agent 的真实请求头**（2026-02 实测，固件在 `accept.test.ts` 里）：

| Agent | 要 markdown | 结果 |
|---|---|---|
| Claude Code | ✅ | `text/markdown, text/html`, 通配符 |
| Cursor | ✅ | `text/markdown`, `text/html;q=0.9` |
| OpenCode | ✅ | `text/markdown;q=1.0`, `text/x-markdown;q=0.9` |
| Codex / Copilot | ❌ | 只提 `text/html` |
| Gemini CLI / Windsurf | ❌ | 只发通配符 |

**三个必须做对的地方**（每一条都对应一个会静默失败的实现）：

1. **Claude Code 不写 q 值，只靠顺序。** 缺省 q 值是 1.0，于是 markdown 与
   html 并列。用严格的 `>` 比较会判定为「无偏好」而返回 HTML——**不报错、
   不警告、日志干净，只是永远不生效**。正确做法是平局时比顺序。
2. **通配符不算「想要 markdown」。** Gemini CLI 与 Windsurf 只发通配符，
   意思是「给什么都行」。误判会把 markdown 塞给它们。
3. **`q=0` 是明确拒绝，不是「偏好为零」。** 漏掉这条会把客户端的拒绝读成要求。

**实测收益（`npm run verify` 会打印）：**

```
页面                         HTML token   MD token       节省
/markdown-for-agents/            3562       1654    53.6%
/cjk-web-typography/             4249       1796    57.7%
/wiki/content-negotiation/       2448        887    63.8%
```

> **为什么比 Cloudflare 的 80% 和 Vercel 的 99.6% 低？**
> 因为**这个站的 HTML 本来就很干净**——零 JS、极简导航、语义化标签。
> 内容协商的收益与页面冗余度成正比：文档站收益大，精简博客收益小。
> 我们不打算把这个数字往好看里说。

</details>

### 二、中文排版按中文的规矩来

![文章页](docs/article.png)

多数主题（包括中文圈的）直接套用为西文调好的参数：

| 参数 | 西文常用 | 本项目的取值 | 为什么 |
|---|---|---|---|
| 行高 | 1.4–1.5 | **1.75** | 方块字笔画铺满字面，没有升降部带来的天然空隙 |
| 标题字重 | 600–700 | **500** | 多数中文字体只有 400/700，写 600 会触发伪合成 |
| 行宽 | 66ch | **34em** | `ch` 按西文「0」宽算；一个汉字约等于两个 `ch` |
| 强调 | 斜体 | **加粗** | 中文无斜体字形，强制倾斜即笔画变形 |

`34em` 这个值是关键：一个汉字约 1em 宽、一个西文字母平均约 0.5em 宽，
于是 34em 同时满足中文的 30–40 字与西文的 45–75 字符两个理想区间。
**一个值，两种文字都对。**

还开了 2026 年的两个原生属性：

```css
html { text-autospace: normal; text-spacing-trim: trim-start; }
```

前者自动在中西文之间插入约 1/4 空格（过去要靠 pangu.js 在客户端跑正则），
后者做中文标点的字距调整。前提是 `<html lang>` 正确——**写错了不会报错，
只是所有中文排版规则静默失效**。

### 三、知识不会腐烂

文章是**流**，按时间排，读过就沉底。但知识是**网**：
你写过三篇关于排版的文章，它们之间的共性不会自动浮现。

所以有一层独立的 `src/content/wiki/`，用 `[[方括号]]` 互链。
这是 Karpathy 在 2026 年 4 月提出的 LLM-wiki 模式，但做了一个关键改动：

> **体检是确定性的，不是「让 agent 定期看看」。**

后者不可复现、不可回归、进不了 CI。所以会腐烂的机械问题做成了代码：

```bash
npm run build
```

```
知识库体检：1 个错误
  [broken-wikilink] 「体检探针」引用了 [[这个页面不存在]]，但没有这个页面。
  要么新建它，要么把引用改成已有的页面——留着断链会将「知识库」退化成「一堆文件」。
知识库体检发现 1 个错误，构建已中止。
```

**断链会让构建失败。这是刻意的**——没有这条，
「知识库」会慢慢退化成「一堆文件」。

语义级的检查（「这两页说法矛盾」）仍然留给 agent。
`AGENTS.md` 就是写给它的约定文件——这是 Karpathy 三层架构里的 schema 层。

---

## 命令行

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run build` | 构建（含知识库体检，有错误会中止） |
| `npm test` | 145 项单元测试，全部离线可跑 |
| `npm run verify` | 端到端验证：对着**真实构建产物**跑协商与链接渲染 |
| `npm run clean` | 删掉 `.astro/` 与 `dist/` |

**改了 `astro.config.mjs` 里的 markdown 配置后必须 `npm run clean`。**
内容层有缓存，不清理会让你以为改动没生效——这个坑我们踩过，
当时所有 `[[链接]]` 都没渲染出来，而 145 项测试全绿、构建成功、lint 通过。

---

## 目录结构

```
├── src/
│   ├── config.ts              ← 你唯一必须改的文件
│   ├── content/
│   │   ├── posts/             文章（按时间排）
│   │   └── wiki/              知识层（按主题互链）
│   ├── lib/                   纯逻辑，不依赖 Astro，可离线测试
│   │   ├── negotiate/         Accept 头解析 —— 唯一的差异化技术点
│   │   └── wiki/              链接图、体检、llms.txt 生成、remark 插件
│   ├── pages/                 路由
│   └── styles/
│       ├── tokens.css         三层设计令牌
│       ├── base.css           基线排版（含中文的那些修正）
│       └── site.css           布局与组件
├── functions/                 Cloudflare Pages Functions
├── netlify/edge-functions/    Netlify Edge Functions
├── middleware.ts              Vercel Edge Middleware
├── AGENTS.md                  ← 给 AI agent 看的维护约定
└── scripts/verify-negotiation.mjs
```

---

## 部署

静态产物，任何静态托管都能跑。

| 平台 | 命令 | 内容协商 |
|---|---|---|
| Cloudflare Pages | 构建 `npm run build`，输出 `dist` | ✅ 免费套餐即可用 |
| Netlify | 同上 | ✅ 免费额度 100 万次/月 |
| Vercel | 同上 | ✅ |
| GitHub Pages | 同上 | ❌ 无法设置响应头 |

**GitHub Pages 用不了内容协商**，因为它的响应头不可改。
站点照常工作，只是 agent 拿到 HTML——`.md` 孪生文件仍然存在，
通过 URL 加 `.md` 可以访问，`rel="alternate"` 也仍然有效。

> **`Vary: Accept` 不能省。** 少了它，CDN 会把 markdown 缓存下来发给浏览器，
> 用户打开博客看到一坨纯文本。这个 bug 只在缓存命中时出现，
> 排查时看起来像「网站有时候会坏」。三个平台的头配置都已备好。

---

## 实测数据（不是估算）

| 项 | 结果 |
|---|---|
| 单元测试 | **145 项**，全部离线可跑，无网络依赖 |
| 构建 | 20 页约 **0.9 秒** |
| 首屏 JS | **0 KB**（只有主题切换一小段内联脚本） |
| 字体 | 拉丁子集共约 **102 KB**，中文走系统字体（0 额外下载） |
| markdown 收益 | **53.6% / 57.7% / 63.8%**（见上文，比同类方案低，原因已说明） |

---

## 已知限制

**如实列出。不打算假装这些不存在。**

- **内容协商只对三个平台有现成实现。** GitHub Pages 不行（响应头不可改）。
  其他平台需要自己写垫片，共享逻辑在 `src/lib/negotiate/edge.ts`，约 40 行。
- **七个 agent 里只有三个要 markdown。** Codex、Copilot、Gemini CLI、Windsurf
  目前都只接受 HTML。这个比例会变，但今天的事实就是这样。
- **`llms.txt` 的实际效果被严重高估。** Ahrefs 2026 年 5 月实测 137,210 个域名，
  **97% 的 llms.txt 从未被请求过**；剩下 3% 里 96% 是机器人噪声，
  真正来自 AI 检索爬虫的只占 1.1%。Google 明确不支持。
  本项目生成它是因为零成本，**但不把它当卖点**。
- **同形字折叠表不完备。** 中文排版部分只覆盖常见的西里尔/希腊/全角替换。
- **`text-autospace` 与 `text-spacing-trim` 在 Safari / Firefox 上不支持**
  （后者全球覆盖约 72%）。属渐进增强，不支持时版式不坏，只是少了那一点调整。
- **`summary` 字段是必填的。** 它进 llms.txt、进 meta description、进列表页。
  省略会被 schema 拦下——这是刻意的，缺摘要的条目在 llms.txt 里只是一行标题。
- **中文标题会生成中文 URL。** 合法且可读，但复制出去是 `%E8%AE%BA...`。
  想固定成英文，在 frontmatter 加 `slug:` 即可。
- **没有 Demo 站点。** 上面的截图是本地预览。部署一个在线 demo 对采用率影响很大
  （`awesome-selfhosted` 明确要求可交互的 demo），这是下一步该做的事。
- **没做评论系统与图片管线。** 这两件事在静态博客里都没有好答案，
  与其塞一个凑合的方案，不如留给使用者按需接（giscus / Waline / 图床）。

---

## 设计取舍

**为什么不用 Tailwind。** 这套版式靠的是精确的网格与字体控制，
手写 CSS + 自定义属性 + `@layer` 能完全控住，依赖面也更小。
一个博客模板要活十年，依赖少是优势。

**为什么字体只自托管拉丁子集。** 中文字体单文件 5–20 MB。
配合 `unicode-range`，中文自动落到系统字体（苹方/雅黑/思源黑体）——
**这不是回退，是分工。**

**为什么内容协商的转换在构建期做。** 运行时转换意味着每次请求都要现算，
而静态产物直接命中 CDN 缓存：零运行时成本、零冷启动、源站挂了也不受影响。

**为什么 lint 失败会让构建中止。** 一个不会失败的检查等于没有检查。
出口是在 `src/config.ts` 里把 `lint.failOnError` 设为 `false`，或者修好它。

---

## 开发中由实测发现并修复的问题

全部已补回归测试。

1. **块注释里的 `*/*` 会提前闭合注释**，让后面的中文变成代码并触发解析错误
2. **`q=0` 被误判为「要 markdown」**——按 RFC 7231 它是明确拒绝，方向正好相反
3. **CommonMark 围栏规则**：` ```` ` 开的代码块不能被 ` ``` ` 闭合。少了这条，
   演示嵌套代码块的文章会把后面的正文当成代码
4. **`html { font-size }` 把所有 rem 令牌放大 6.25%**——间距与字号阶梯全部偏离刻度。
   这个偏差小到看不出来，却让所有相邻两级的比例都对不上
5. **正文标题的节奏规则泄漏到结构性标题**，首页某处间距达到设计值的两倍多
6. **`??` 不认空字符串**：`site.url` 未配置时是 `''` 而非 `null`，
   导致 RSS 构建失败——而零配置必须能构建成功
7. **`fetchAsset` 抛异常会让边缘函数 500**——一个可有可无的增强不该拖垮主路径
8. **unified 的 `.use()` 要的是工厂函数不是它返回的 transformer**，
   写错会抛一个完全看不出原因的 `Cannot use 'in' operator ...`
9. **Astro 7 把 `markdown.remarkPlugins` 换成了 `markdown.processor`**，
   老写法被接受但**不执行**，只发一条弃用警告——所有 `[[链接]]`
   因此静默失效，而测试全绿
10. **内容层有缓存**，改了 markdown 配置不 `clean` 就不生效
11. **`fonts.css` 写好了但没人 import**——三条 `@font-face` 一条都没进构建，
    三个字体文件一个都不会下载。而字体栈写成 `'Archivo', -apple-system, ...`
    时找不到就静默用下一个，**页面上没有任何异常**，
    只是排版的「声音」悄悄变成了系统默认字体

第 9、10、11 条是同一类问题：**失败的形态是「看起来还行」，不是「报错」**。
第 9 与第 10 条合起来，让「所有 wiki 链接都不渲染」这件事在
**145 项测试全绿、构建成功、lint 通过**的情况下发生了。

所以 `npm run verify` 里有两组打在**构建产物**上的契约检查
（`[1b]` 链接渲染、`[1c]` 字体加载）——单元测试测不到
「插件有没有接进管线」「CSS 有没有被 import」这类问题。

---

## License

[MIT](LICENSE) © 2026 XIAOXUsop

字体：[Archivo](https://github.com/Omnibus-Type/Archivo)、
[Public Sans](https://github.com/uswds/public-sans)、
[JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)，
均为 SIL Open Font License 1.1。
