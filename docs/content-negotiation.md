# 给 AI 读的接口：内容协商

> 这是本项目最主要的差异化点。这一页把「为什么别人没做」「必须做对哪几件事」
> 「实际收益多少」讲清楚，证据都能自己复现。

Claude Code、Cursor、OpenCode 请求网页时会发 `Accept: text/markdown`。
这是 HTTP 从 1.1 就有的**内容协商**（现行语义见 RFC 9110 §12.5.1，
媒体类型见 RFC 7763），不是新发明。

**但静态博客做不到**——静态托管只吐文件，不解析请求头。这正是 Cloudflare 的
Markdown for Agents 要 Pro 及以上套餐、Vercel 的实现只在自己平台内生效的原因。

## 现有方案卡在哪

| 现有方案 | 卡在哪 |
|---|---|
| Cloudflare Markdown for Agents | 要 Pro 及以上付费套餐 |
| Vercel 内容协商 | 只在自己的平台内生效 |
| `astro-markdown-for-agents` | 协商**只在 dev server 里生效**，README 直说「不含托管平台垫片」 |
| `astro-markdown-export` | 只复制 `.md` 文件，**完全不做协商** |

后两者的周下载量是 **106 和 17**（主流 Astro 集成是三十万到两百万）。
**不是「已解决只是没人知道」，是「有人碰过就放弃了」。**

这类数字只说明「没人用」，不说明「做不出来」——真正的论据是它们卡在哪。

本项目补上它们跳过的那一段：**三个平台的边缘函数**，转换在构建期完成。

## 七个 agent 的真实请求头

2026-02 实测，固件写在 `src/lib/negotiate/accept.test.ts` 里：

| Agent | 要 markdown |
|---|---|
| Claude Code / Cursor / OpenCode | ✅ |
| Codex / Copilot / Gemini CLI / Windsurf | ❌ |

## 三个必须做对的地方

每一条都对应一个**会静默失败**的实现：

1. **Claude Code 不写 q 值，只靠顺序。** 缺省 q 是 1.0，两个候选并列；
   用严格的 `>` 比较会判成「无偏好」而返回 HTML——**不报错、不警告，只是永远不生效**。
2. **通配符不算「想要 markdown」。** 只发 `*/*` 的客户端意思是「给什么都行」。
3. **`q=0` 是明确拒绝**，不是「偏好为零」。
4. **具体类型先于通配符。** 某个表示同时命中具体类型和通配符时，先用更具体的
   范围确定它的 q；否则通配符会覆盖客户端对 HTML 的明确降权或拒绝。

对应实现见 `src/lib/negotiate/accept.ts`，边界用例在 `accept.test.ts`。

协商成功的响应还会带上 `Content-Location`，明确实际返回的 `.md` 孪生文件；
`Link` 同时声明 HTML canonical 与 markdown alternate，让两种表示可以双向发现。

## 实测收益

`npm run verify` 会打印真实数字：

```
页面                         HTML token   MD token       节省
/markdown-for-agents/            5386       1693    68.6%
/cjk-web-typography/             6102       1847    69.7%
/wiki/content-negotiation/       3681       1106    70.0%
```

> **为什么低于 Cloudflare 的 80% 和 Vercel 的 99.6%？**
> 因为**这个站的 HTML 本来就很干净**——几乎不含 JS（内联合计 2.5 KB、无外链，
> 内容页的 `<script src>` 计数为 0）、极简导航、语义化标签。
> 内容协商的收益与页面冗余度成正比：文档站收益大，精简博客收益小。
> 不打算把这个数字往好看里说。

## 顺带说一句 llms.txt

它的实际效果被严重高估：Ahrefs 2026 年 5 月实测 **137,210 个域名，
97% 的 llms.txt 从未被请求过**；剩下 3% 里 96% 是机器人噪声。
Google 明确不支持。

本项目生成它是因为零成本，**但不把它当卖点**。真正起作用的是内容协商。

## 部署到哪才有用

**Cloudflare Pages / Netlify / Vercel 三个平台可以，GitHub Pages 不行**
（响应头不可改，而这需要一个边缘函数）。详见 [部署](deploy.md)。

GitHub Pages 上站点照常工作，agent 拿到 HTML——`.md` 孪生文件仍在，
通过 URL 加 `.md` 可访问；此外页面里还有
`<link rel="alternate" type="text/markdown">`，这是不做内容协商的 agent
（Codex 那类）发现 markdown 版本的方式。
