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

## 有一份机器可读的 schema

```
/content-manifest.schema.json
```

**JSON Schema（draft 2020-12）**，与产物同源发布。它是给工具用的：
IDE 补全、CI 校验、生成客户端类型。

它最值钱的一条是 `additionalProperties: false`——
**「悄悄给清单加一个字段」因此变成一次显式的决定**，
而不是「反正多一个键没人管」。

`npm run check:manifest-schema` 核三件事：

1. **完整校验产物与 JSON Schema**，再检查文档数等业务不变量；
2. **源码常量、产物、schema 三处的 `version` 一致**——它们各自都能独立改，
   而只有两处改了就没人发现；
3. **文档指路**（消费方找得到它，否则 schema 白写）。

> 构建后的门禁使用 JSON Schema 校验器检查字段类型、格式和嵌套结构；
> `documentCount` 等跨字段关系继续由手写不变量检查。校验器是开发依赖，
> 不进入站点的浏览器脚本。

> ⚠️ **清单里没有 `$schema` 字段指路。**
> 加它会改产物形状，按本项目的判据**就该升版本**——
> 为了一份指路而升版本是本末倒置。所以指路写在这里。

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

### 这份 `provenance` 就是本项目的 Knowledge IR，它的版本号是 `version`

路线图阶段 4 第 1 项写的是「发布 Knowledge IR schema 与**版本策略**」。

**2026-09-24 实测：那个词在仓库里一次都没出现过**——而这份结构
**其实早就在生产里、线上可取**（`content-manifest.json` 的 `documents[].provenance`，
v2 起，11 篇里 8 篇有）。

所以这一项**不需要新造一个 IR，也不需要第二个版本号**。判据：

| 问题 | 答案 |
|---|---|
| 它是什么 | 每篇文档的「依据从哪来 + 有没有被确认过」的结构化表示 |
| 在哪 | `documents[].provenance`（manifest 与 `content.ndjson` 都有） |
| 版本号 | **就是顶层 `version`**——它是 manifest 文档的一部分，不是独立格式 |
| 怎么变版本 | 见下面那条判据 |

**为什么不给它单独的版本号**：`provenance` 不是一个独立格式，
它是 `documents[]` 里的一条文档的**子结构**。
单给它一个号，等于要回答「manifest v2 + IR v1 这个组合是什么」——
而现实中只会出现「manifest 的某个版本」，子结构跟着它走。

### 版本策略：一条可执行的判据

判据写死在 `src/lib/content-manifest.ts` 的 `CONTENT_MANIFEST_VERSION` 上方：

> **产物里已有文档的 JSON 形状变了，就升。**

| 改动 | 升不升 |
|---|---|
| 给 `provenance` 增删字段、改名、改变语义 | **升**（形状变了） |
| 改变同一输入的产出（例如 `manifestId` 推导规则） | **升** |
| 只改内部实现，产物一个字节没变 | 不升 |
| 加一个**对所有文档都恒为缺席**的可选字段 | 不升 |

> ⚠️ **「可选字段」不等于「不用升」。**
> `provenance` 自己是可选的，但它对有来源的页面**真的会出现**，
> 所以加它那次**应该**升版本——而当时没升，是靠这条判据的上一版
> （那句自相矛盾的注释）才发现的。现在判据只有一条，没有第二种解释。

> **理由不是「下游要改代码」**，而是「同一份 `version: 1` 在不同时间
> 会对应两种形状」——那正是版本号要防的事。

由 `check-single-source` 保证**版本号只有一处真值**（同一个事实写两遍已经造成过
一次真故障：生产端升到 2 而同步器停在 1，于是同步器对着本站自己的清单必然报错、
而 453 条测试全绿）。

## 最小同步算法

同步端只需要保存上一次看到的 `id → sha256`：

1. 获取 `/content-manifest.json`，先检查 `format` 与 `version`。
2. 对每个文档比较本地 hash 与 `markdown.sha256`。
3. hash 不同或本地没有该 ID 时，下载 `urls.markdown` 并更新索引。
4. 本地存在、但新清单里已经没有的 ID，应从索引删除。
5. 保存这次清单，供下一次比较。

ID 由内容类型与 slug 组成，例如 `post:hello`、`wiki:content-negotiation`。
只要类型和 slug 不变，ID 就稳定；改 slug 应被同步端视作「删除旧 ID、新增新 ID」。

## `version` 不认识时该怎么办

**不要猜。** 判据只有一条：**`version` 不是 2，就中止并报错**——
不要「尽量读几个认识的字段」，那样会在字段语义已变时静默产出错误索引。

### v1 的情况

`version: 1` **真实存在过**。2026-09-24 实测当时的线上 Demo 返回的就是它
（11 篇文档，**`provenance` 一条都没有**）。
它与 v2 的差异**只有一个字段**：v2 多了 `provenance`。

> ⚠️ **2026-09-24：线上那份仍是 v1，而本仓库已经是 v2。**
>
> 原因是 v2 还在 `test` 分支上、**没合进 `main`**，所以 Demo 部署的还是旧产物。
> **这与格式本身无关**——v2 是当前 `main` 之后的正式格式。
>
> > 对**你**的影响：现在对着 Demo 做同步，拿到的仍是 v1 清单。
> > 合并并重新部署之后，同一个地址会返回 v2——**那时你的消费方需要先处理 v1**
> > （本仓库的 `content-sync` 遇非 v2 会**明确报错并中止**，不会静默降级读 v1）。

| 字段 | v1 | v2 |
|---|---|---|
| 稳定 ID / URLs / sha256 / bytes / relations | ✅ | ✅ |
| `provenance`（来源版本、复核状态、原创声明） | ❌ **整键缺席** | ✅ 可选 |

仓库里带了迁移器，可以直接用**真实线上 v1**（`knowledge/fixtures/manifest-v1.json`）：

```bash
npm run migrate:manifest -- knowledge/fixtures/manifest-v1.json --check
npm run migrate:manifest -- knowledge/fixtures/manifest-v1.json -o v2.json
```

> ⚠️ **迁移不会凭空补出 `provenance`。** v1 的 11 篇一条来源信息都没有，
> 补一个 `status: pending` 是撒谎（没人复核过），
> 补 `original` 也是撒谎（那不是原创实践，是「从未进过治理流程」）。
> 迁移后的正确形态是**整键保持缺席**——它表示「这份数据没经过治理」，
> **不是**「已复核、确认无外部来源」。
> 这两种情况在数据里长得一样，正是本项目此前踩过的坑
> （`provenance` 字段存在的理由就是让它们可区分）。
>
> **所以：如果你要的是「知道每篇的依据与复核状态」，迁移 v1 解决不了**——
> 那些内容需要重新复核，而不是打一个标记。
> 本仓库的 v2 里 8 篇有 `provenance`、3 篇没有，
> **那 3 篇正是「没有来源也没有复核状态」的诚实结果**。
>
> 因此：**如果你的下游依赖 `provenance` 判断内容可信度，
> 迁移 v1 解决不了问题**——那些内容需要重新复核，而不是打一个标记。

内置的[内容镜像同步器](content-sync.md)遇到非 v2 清单会**明确报错并中止**
（`assertManifest` 检查 `format` 与 `version`），不会静默降级读 v1。

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

- 这是 **letterpress 自己的格式**（当前 `version: 2`），不冒充行业标准，
  也不保证被通用爬虫自动发现或采用。
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
