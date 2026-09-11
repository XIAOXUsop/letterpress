---
title: 内容协商
summary: 用 HTTP 的 Accept 头决定返回 HTML 还是 markdown。算法只有四十行，难的是静态托管不解析请求头。
kind: concept
related: [markdown-for-agents, llm-wiki]
---

同一个 URL，对人和对 agent 返回不同格式的同一份内容。

标准依据是 RFC 7231 §5.3.2（Accept 头）与 RFC 7763（`text/markdown`）。
**这是 HTTP 从 1.1 就有的能力，不是新发明。**

## 判定算法

```
markdown = Accept 里显式声明的 text/markdown 或 text/x-markdown 中最优的
html     = Accept 里 text/html、application/xhtml+xml 或通配符中最优的

若 markdown 不存在          → 返回 HTML
若 markdown 的 q 为 0       → 返回 HTML（q=0 是明确拒绝）
若 html 不存在              → 返回 markdown
若两者 q 不同               → 返回 q 大的那个
若 q 相同                   → 返回在头里排得更靠前的那个
```

## 三个会把实现写错的地方

**一、q 缺省为 1.0，平局比顺序。**

Claude Code 发 `text/markdown, text/html, <通配符>`，**不写 q 值**。
两者都是 q=1.0。用严格 `>` 比较会判定为「无偏好」从而返回 HTML——
不报错、不警告、日志干净，只是永远不生效。

**二、通配符不算「想要 markdown」。**

只发通配符的客户端（Gemini CLI、Windsurf）意思是「给什么都行」。
若把通配符算作 markdown 偏好，它们会被塞 markdown。
所以 markdown 一侧**只认显式声明**。

**三、`text/plain` 不是 markdown 请求。**

OpenCode 会带 `text/plain;q=0.8`，那是它的降级选项。
宁可漏给（客户端仍拿到可用的 HTML），不可错给。

## 在静态托管上怎么实现

静态托管只吐文件，不解析请求头。所以需要两层：

1. **构建期**：为每个页面生成 `.md` 孪生文件（零运行时成本）
2. **边缘函数**：读 `Accept`，决定回哪个文件

项目里带了三个平台的实现：Cloudflare Pages Functions、Netlify Edge Functions、
Vercel Middleware。不用这一层站点照常工作，只是 agent 拿到 HTML。

## 必须做的两件事

- **`Vary: Accept`**——否则 CDN 会把 markdown 缓存下来发给浏览器。
  这个 bug 只在缓存命中时出现，会让人以为「有时候网站会坏」。
- **只在 markdown 是显式偏好时才返回**——见上面第二点。

## 效果数据

| 来源 | 结果 |
|---|---|
| Cloudflare（自己的文档） | 80% token 减少 |
| Vercel（自己的博客） | 500 KB → 2 KB，99.6% |
| Checkly（自己的文档） | 615.4 KB / 180,573 token → 2.3 KB / 478 token |

## 回到本项目的代码

`src/lib/negotiate/accept.ts`。真值表用七个 agent 的**真实 Accept 原文**做回归，
固件在 `accept.test.ts` 里，注释写明了每一条的判定理由。
