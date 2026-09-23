# 内容清单：让 Agent 只抓变化的内容

`/content-manifest.json` 是 letterpress 自己定义、带版本号的内容清单。它不冒充
行业标准，也不替代 sitemap、RSS 或 `llms.txt`。它只解决一个明确问题：

> 已经同步过本站的 Agent / RAG 管线，怎样知道哪些 markdown 真的变了？

如果没有清单，同步器通常只能遍历所有页面，再逐篇下载和比较。清单把每篇内容的
稳定 ID、HTML / Markdown URL、UTF-8 字节数和 SHA-256 放在一处；同步器先取一份
JSON，就能只下载发生变化的 `.md` 文件。

若是第一次接入、还没有本地基线，直接读取 [`/content.ndjson`](content-export.md)
可以用一次请求拿到同一批元数据和完整 Markdown；完成首轮导入后再切回本清单。
如果不想自己实现状态与失败回滚，可直接使用仓库的[内容镜像同步器](content-sync.md)。

## 它包含什么

下面是字段结构示意；示例值只用于说明字段，不对应仓库里的某篇文章：

```json
{
  "format": "letterpress-content-manifest",
  "version": 2,
  "site": {
    "name": "此间札记",
    "language": "zh-CN",
    "home": "https://example.com/"
  },
  "documentCount": 1,
  "edgeCount": 0,
  "documents": [
    {
      "id": "post:hello",
      "kind": "post",
      "slug": "hello",
      "title": "你好",
      "summary": "这篇文章讲什么。",
      "urls": {
        "html": "https://example.com/hello/",
        "markdown": "https://example.com/hello.md"
      },
      "publishedAt": "2026-01-02T00:00:00.000Z",
      "tags": ["示例"],
      "relations": {
        "outgoing": [],
        "backlinks": []
      },
      "markdown": {
        "mediaType": "text/markdown",
        "bytes": 328,
        "sha256": "…"
      }
    }
  ]
}
```

知识库条目还会有 `wikiKind`。`publishedAt`、`updatedAt` 只在内容确实提供相应字段时
出现；清单不会编造日期。草稿不会进入清单。

### `provenance`：来源与复核状态（可选）

登记了来源、或标了复核状态（或声明了「原创实践记录」）的条目会多一个
`provenance` 块：

```json
"provenance": {
  "sources": [
    { "sourceId": "css-values-4", "revision": "WD-20240312", "locator": "§5.1.1 长度单位 · ch" }
  ],
  "review": {
    "status": "reviewed",
    "checkedAt": "2026-09-24",
    "contentDigest": "0e700777…"
  }
}
```

**为什么它在机器出口里**：2026-09-24 实测发现它原先只在 HTML 页面上
（`Provenance` 组件），manifest 与 NDJSON 都没有。于是
**订阅者按 manifest 同步时，无从知道哪一篇已经过期**——
而「`stale` 内容不得在机器接口里被当成新鲜内容」恰好就是这条路径要防的事。
**页面看得见、机器看不见，是最坏的一种不一致。**

三件事值得下游注意：

1. **整个 `provenance` 键在既无来源也无复核时是缺席的**，不是空对象。
   空对象读起来像「查过了，没有」，而缺席是「没标」——**这两种含义不能混**。
2. **`review.status` 是 `stale` 时，这篇的结论已经不再被确认过。**
   它仍然出现在出口里（内容没有消失），但**不该被当成新鲜证据**。
3. **`original.reason` 表示「这一页讲的是本站自己的实践，没有外部来源」。**
   它让「没登记来源」有两种**可区分**的含义：该补的 vs 正常的。

`contentDigest` 是复核当时的正文摘要：它变了就说明正文在复核之后被改过
（那种情况会让**构建失败**，所以出现在产物里的清单里时它必然是对得上的）。

## 最小同步算法

同步端只需要保存上一次看到的 `id → sha256`：

1. 获取 `/content-manifest.json`，先检查 `format` 与 `version`。
2. 对每个文档比较本地 hash 与 `markdown.sha256`。
3. hash 不同或本地没有该 ID 时，下载 `urls.markdown` 并更新索引。
4. 本地存在、但新清单里已经没有的 ID，应从索引删除。
5. 保存这次清单，供下一次比较。

ID 由内容类型与 slug 组成，例如 `post:hello`、`wiki:content-negotiation`。
只要类型和 slug 不变，ID 就稳定；改 slug 应被同步端视作「删除旧 ID、新增新 ID」。

## hash 到底覆盖什么

SHA-256 针对 `.md` 端点实际返回的 UTF-8 字节计算，而不是仅针对源文件正文。
因此这些变化都会改变 hash：

- 标题、摘要或正文变化；
- 文章日期、标签变化；
- 新增或移除指向该页的反向链接；
- markdown 孪生格式本身升级。

页面路由与清单共用同一个 markdown 生成函数。端到端检查还会重新读取 `dist` 中的
每个 `.md` 文件计算 hash，防止两条生成路径悄悄分叉。

## 为什么没有 `generatedAt`

清单刻意不写构建时间。否则源码完全没变，两次构建也会得到不同字节：CDN 的 ETag、
Git 产物比较与可复现构建都会产生无意义变化。相同输入应产生逐字节相同的清单。

`updatedAt` 也不会自动填成构建时间；只有 frontmatter 明确提供 `updated` 时才输出。

## 边界

- 这是版本为 `1` 的项目格式，不保证被通用爬虫自动发现或采用。
- 清单提供变更检测，不负责鉴权、调度、向量化或删除策略之外的索引生命周期。
- hash 能证明「内容是否相同」，不能证明内容可信；信任边界仍是站点与 HTTPS。
- `relations` 只描述 letterpress 的 `[[wiki-link]]` 图，不扫描普通 Markdown 外链。
- 大多数普通读者不需要请求它；`llms.txt` 仍适合快速浏览目录，
  `llms-full.txt` 仍适合一次性获取全文。

## 构建期保证

`npm run verify:all` 会验证：

- 每个清单条目都存在真实 `.md` 文件，hash 与字节数逐项匹配；
- 所有出链和反向链接都指向清单中的已知 ID；
- Markdown 与 MDX 都进入清单，草稿不进入任何发布出口；
- `SITE_BASE` 子路径只出现一次，清单 URL 不会漏前缀或重复前缀；
- 输入顺序改变不会改变序列化结果；
- `verify:reproducible` 会在两个时区做完整构建，确认清单与其余产物逐字节一致。

这几条才是清单能用于自动同步的基础；只生成一份 JSON 而不验证它，与手写一份会过期
的目录没有本质区别。
