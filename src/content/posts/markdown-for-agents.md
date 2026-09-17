---
title: 你的博客该不该给 AI 一份 markdown
summary: 内容协商是 HTTP 自带的能力，但博客圈几乎没人用。三个 agent 会主动要 markdown，四个不会——而现有工具都跳过了最难的那一步。
date: 2026-09-12
tags: [web, agent, http]
featured: true
coverAlt: 蓝底白色几何构图
---

一个 AI agent 抓取你的网页时，看到的东西和你看到的不一样。它看到的是两万个
token 的导航栏、页脚和 `<div>` 嵌套，而正文可能只占其中百分之几。

这不是比喻。Cloudflare 实测自己的文档：同一页 HTML 要 16,180 token，
markdown 版只要 3,150 token——**省 80%，内容一模一样**。

HTTP 从 1.1 起就有解决这个问题的机制：内容协商。客户端在 `Accept` 头里说
「我更想要 markdown，不行的话 HTML 也行」，服务端照办。

问题是：**博客圈几乎没人用。**

## 谁在要 markdown

拿七个常见 agent 去请求 `httpbin.org/headers`，
看它们各自发出的 `Accept` 头。结果是这样的：

| Agent | 要 markdown 吗 | Accept 头 |
|---|---|---|
| Claude Code | 是 | `text/markdown, text/html, */*` |
| Cursor | 是 | `text/markdown`, `text/html;q=0.9`, … |
| OpenCode | 是 | `text/markdown;q=1.0`, `text/x-markdown;q=0.9`, … |
| OpenAI Codex | 否 | `text/html`, `application/xhtml+xml`, … |
| GitHub Copilot | 否 | `text/html`, `application/xhtml+xml`, … |
| Gemini CLI | 否 | 通配符 |
| Windsurf | 否 | 通配符 |

七个里三个主动要。**而这七行数据本身就是一份测试用例**——见
[[内容协商]] 里关于怎么把它钉成回归测试的部分。

## 一个安静失败的实现细节

Claude Code 那一行值得单独说。

它发的是 `text/markdown, text/html, */*`——**没有 q 值**。在 HTTP 里，
缺省 q 值等于 1.0，于是 markdown 和 html 并列。这时按 RFC 的规定，
服务端应当认为**靠前的那个优先**。

但如果实现里写的是严格的 `>` 比较：

```js
if (markdown.q > html.q) return 'markdown';
return 'html';
```

那么 `1.0 > 1.0` 为假，判定落到 HTML 上。**Claude Code 永远拿不到 markdown，
而服务端不报错、不警告、日志里什么都没有。** 你只会觉得「这功能好像没用」。

正确写法是平局时比顺序：

```js
if (markdown.q !== html.q) return markdown.q > html.q;
return markdown.index < html.index;
```

这类 bug 的可怕之处在于它**不会以错误的形式出现，只会以「没效果」的形式出现**。

## 为什么现成的工具都不太行

Astro 生态里已经有两个包在做这件事，但都停在半路：

- **astro-markdown-for-agents**：在构建期生成 `.md` 文件，但协商**只在 dev server 里生效**。
  它的 README 直说：「不包含托管平台运行时垫片；静态托管环境下的服务时协商
  应由使用方自行实现。」也就是说**上生产就没了**。
- **astro-markdown-export**：把源 `.md` 复制进产物目录，**完全不做协商**。
  要访问 `/slug/index.md` 才拿得到，而且导出的是未渲染的源文件。

两者的周下载量分别是 106 和 17。而主流 Astro 集成是三十万到两百万。
**这不是「已经解决了只是没人知道」，是「有人碰过就放弃了」。**

## 难在哪

难的不是算法——算法上面已经写完了，四十行。

难的是**静态托管不解析请求头**。静态站就是一堆文件，CDN 把文件原样吐出来，
它不会因为你 `Accept` 写了什么就换一个文件给你。所以你需要一层边缘函数。

这也是为什么 Cloudflare 的 Markdown for Agents 要 Pro 及以上套餐——
它是在边缘替你做了转换。而 Vercel 的实现只在自己的平台内生效。
**跑在免费静态托管上的博客，两头都够不着。**

出路是：构建期生成 `.md` 孪生文件，再用一层几十行的边缘函数做选择。
转换在构建期完成（零运行时成本），边缘只负责「给哪个」。
Cloudflare Pages Functions、Netlify Edge Functions、Vercel Middleware
的免费额度都够用。

## 两件必须做对的事

**一、`Vary: Accept` 不能省。** 少了它，CDN 会把 markdown 版本缓存下来
发给浏览器——用户打开博客看到一坨纯文本。这是个会让人当场关掉标签页的 bug，
而它只在缓存命中时出现。

**二、`*/*` 不算「想要 markdown」。** Gemini CLI 和 Windsurf 只发通配符，
意思是「给什么都行」。如果把通配符也算作 markdown 偏好，这两家会被塞
markdown——它们本来接受 HTML，你硬给别的格式，属于自找麻烦。

## 顺带说一句 llms.txt

你可能想问为什么不提 `llms.txt`。因为它的实际效果被严重高估了：

- Ahrefs 2026 年 5 月实测 **137,210 个域名：97% 的 llms.txt 从未被请求过**。
  剩下 3% 里 96% 是机器人噪声，真正来自 AI 检索爬虫的只占 **1.1%**。
- Google 明确不支持，2026 年 6 月的 Search Central 指南写明不需要这类文件。
- 多个独立实验都没测到可归因的效果。

它**零成本、无下行风险**，而且确实有 agent 会抓（Claude Code 抓取 llms.txt
的频率高于任何 AI 搜索机器人），所以本站在生成它。但把它当卖点是误导。

真正的杠杆是**干净的内容协商**和**语义化的 HTML**——后者对静态站来说是白送的。

## 参考文献

- RFC 9110 §12.5.1（Accept 头）、RFC 7763（`text/markdown` 媒体类型）
- Cloudflare, *Markdown for Agents*（含 80% token 节省的实测与「七个 agent 要什么」的原始统计）
- Ahrefs, *We Analyzed 137K Sites: 97% of llms.txt Files Never Get Read*, 2026-05
