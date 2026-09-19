# 部署

产物是纯静态的 `dist/`，任何静态托管都能跑。差别只在**内容协商能不能用**。

| 平台 | 构建命令 | 输出 | 内容协商 |
|---|---|---|---|
| **Cloudflare Pages** | `npm run build` | `dist` | ✅ 免费套餐即可用 |
| **Netlify** | 同上 | `dist` | ✅ 免费额度 100 万次/月 |
| **Vercel** | 同上 | `dist` | ✅ |
| **GitHub Pages（项目站）** | `SITE_BASE=/仓库名 npm run build` | `dist` | ❌ 响应头不可改 |

平台垫片分别在：`functions/[[path]].ts`（Cloudflare）、
`netlify/edge-functions/negotiate.ts`（Netlify）、`middleware.ts`（Vercel）。
三者共享 `src/lib/negotiate/edge.ts` 的逻辑。

---

## GitHub Pages 的项目站必须设 `SITE_BASE`

项目站地址形如 `https://<用户名>.github.io/<仓库名>/`，站点跑在子路径下。

```bash
SITE_BASE=/仓库名 npm run build
```

不设这个变量的话，所有以 `/` 开头的链接都会指向域名根，**整站点不动**——
而这个问题在本地 `npm run dev` 下完全看不出来（本地 base 是 `/`，前缀为空）。

一条命令验证：

```bash
npm run verify:base
```

它用一个假 base 重建产物，然后扫**五类载体**：`href`/`src` 属性、
`<script>` 里拼出来的路径、`https://` 开头的绝对 URL、纯文本产物
（`llms.txt` / `robots.txt`），以及 JSON 内容清单。每一类都是踩过之后才补上的。

> ⚠️ 在 Windows 的 Git Bash 里，`SITE_BASE=/仓库名` 会被 MSYS 当成路径转换成
> `D:/App/Git/仓库名`。加 `MSYS_NO_PATHCONV=1` 前缀。

**GitHub Pages 用不了内容协商**（响应头不可改）。站点照常工作，agent 拿到 HTML
——`.md` 孪生文件仍在，通过 URL 加 `.md` 可访问。

---

## `Vary: Accept` 不能省

少了它，CDN 会把 markdown 缓存下来发给浏览器，用户打开博客看到一坨纯文本；
反过来也一样，agent 拿到 HTML，内容协商白做。

**这个 bug 只在缓存命中时出现**，排查时看起来像「网站有时候会坏」。

三个平台的头配置都已备好：

- Cloudflare / Netlify → `public/_headers`（两者都认这个文件）
- Vercel → `vercel.json`（内容与 `_headers` 逐条对应）

> ⚠️ **Vercel 这一份没有在 Vercel 上实际部署验证过。** 本项目只把 Demo 跑在
> GitHub Pages 上（那是唯一一个**不支持**内容协商的平台）。`vercel.json` 是按
> Vercel 文档写的；但「写对了」和「在平台上生效」是两件事。
> 选 Vercel 的话请自己 curl 一次确认头里有 `Vary: Accept`。

---

## 安全头

`_headers` / `vercel.json` 里另有三条默认开启的头：
`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、
`X-Frame-Options: DENY`。

**CSP 刻意没有开启。** 主题恢复脚本是同步内联的，要上严格 CSP 需要给它加 hash。
一个开箱即用的模板不该在用户还没配好时就把自己的脚本拦掉。

另外搜索的加载器要求 CSP 允许 `unsafe-eval`——原因见 [命令行](cli.md) 里
关于 `__VITE_PRELOAD__` 的说明。

---

## 部署完必须验一次：线上烟测

内容协商的成败**全在托管平台**——边缘函数有没有被部署、响应头有没有被平台改写、
CDN 有没有吃掉 `Vary: Accept`。这些在本地一个都测不到：
`npm run dev` 和 `scripts/verify-negotiation.mjs` 的响应头都是本项目自己写的。

所以有一个只打线上、只查少量稳定出口的烟测：

```bash
SITE_ORIGIN=https://your-demo.example npm run verify:online
```

它验的是：同一个页面在两种 `Accept` 下拿到**不同**的 `Content-Type`、两侧都带
`Vary: Accept`、markdown 侧带 `Content-Location` 与 `rel="alternate"` 的 `Link`、
没有 markdown 孪生的页面安全回落到 HTML、静态资源不被重写；还会读取
`content-manifest.json`，从中推导一篇真实文档，确认线上 `.md` 的字节数和
SHA-256 与清单一致。它只抽一篇，不会退化成每次全站抓取。

> **它不会因为线上不可用就退回本地服务器。** 没有配置 `SITE_ORIGIN` 时它直接失败退出。
> 一个能自己找退路的烟测，唯一的作用是把部署事故伪装成绿色。

推送到 `main` 时 CI 也会跑这一条——前提是仓库变量 `DEMO_ORIGIN` 已经配好
（Settings → Secrets and variables → Actions → Variables）。
没配的话这个 job 不会出现，而不是绿着出现。

### 当前状态

| 环境 | 地址 | 内容协商 |
|---|---|---|
| GitHub Pages（项目站） | <https://xiaoxusop.github.io/letterpress/> | ❌ 平台改不了响应头 |
| Cloudflare / Netlify / Vercel | — | **尚未部署**，垫片已备好 |

也就是说：`Accept: text/markdown` 这件事**目前没有公开环境可以直接 curl 验证**。
上面那个烟测是为了让第一次部署之后能立刻验一次，而不是靠"本地跑过了"。
