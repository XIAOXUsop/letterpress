# 全量导出：一次请求拿到可逐行处理的原文

`/content.ndjson` 是首次接入 Agent / RAG 管线时使用的全量快照。它与
`/content-manifest.json` 分工明确：

- 第一次同步：下载一份 NDJSON，一行一篇，顺序读取并写入自己的存储；
- 后续同步：读取 manifest，比较 `sha256`，只下载变化的 `.md` 文件并删除消失的 ID。

这避免了首次导入时“先下载清单，再为每篇内容发送一次请求”的 N+1，同时没有把
增量同步也绑到一个越来越大的全量文件上。

## 为什么是 NDJSON

普通 JSON 数组通常要等整个文件解析完才能开始处理。NDJSON（Newline Delimited JSON）
让每一行都是一个独立 JSON 对象，消费端可以边下载边验证、边写入数据库；某条失败时
也能直接报告它的 `id`，不必丢弃已经处理好的前面部分。

响应使用业界常见但未冒充正式通用标准的 `application/x-ndjson`。Cloudflare Pages、
Netlify 与 Vercel 的仓库配置都显式声明了这个 MIME，不依赖托管平台按扩展名猜测。

> ⚠️ **GitHub Pages 是例外，而且是实测出来的。** 2026-09-20 对线上 Demo
> （README 里给的就是它）curl 一次 `/content.ndjson`，拿到的是
>
> ```
> HTTP/2 200
> content-type: application/octet-stream      ← 不是 application/x-ndjson
> ```
>
> 原因是 Pages **不允许自定义响应头**，而 `.ndjson` 又不在它认识的扩展名表里，
> 于是退回默认的二进制类型。这与「Pages 上跑不了内容协商」是同一个限制，
> 只是那条已经在 README 与 `docs/deploy.md` 里写过、这条此前没写。
>
> **影响与不影响的**：按行解析不受影响——`fetch(...).text()` / 逐行读都照常，
> 消费端不该按 Content-Type 拒绝它。真正会受影响的是那些**按 MIME 分流**的客户端
> （例如某些抓取器把 `application/octet-stream` 当成下载附件）。
> 要在意的话：换三个平台之一，或自己给响应补头。
>
> 另外 Pages 也不会下发源码里那行 `X-Content-Type-Options: nosniff`——同样因为它
> 不可改响应头。

## 一条记录包含什么

下面只展示结构，示例值不对应仓库中的真实文章：

```json
{
  "format": "letterpress-content-record",
  "version": 1,
  "site": {
    "name": "示例站",
    "language": "zh-CN",
    "home": "https://example.com/"
  },
  "id": "post:hello",
  "kind": "post",
  "slug": "hello",
  "title": "你好",
  "summary": "这篇文章讲什么。",
  "urls": {
    "html": "https://example.com/hello/",
    "markdown": "https://example.com/hello.md"
  },
  "tags": ["示例"],
  "relations": {
    "outgoing": [],
    "backlinks": []
  },
  "content": {
    "mediaType": "text/markdown",
    "bytes": 328,
    "sha256": "…",
    "text": "# 你好\n\n完整 Markdown……\n"
  }
}
```

知识库条目还会带 `wikiKind`；日期只有在 frontmatter 确实存在时才输出。`content.text`
与对应 `.md` 端点逐字节一致，`bytes` 按 UTF-8 计算，`sha256` 可在写入索引前复核。

### `provenance`：来源与复核状态（可选）

登记了来源或复核过的条目会多一个 `provenance` 块：

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

**两件事值得下游注意：**

1. **整个 `provenance` 键在页面既没登记来源、也没标复核时是缺席的**，
   不是空对象。空数组读起来像「查过了，没有来源」，
   而缺席是「没标」——**这两种含义不能混**。
2. **`review.status` 是 `stale` 时，这篇的结论已经不再被确认过。**
   它仍然会出现在出口里（内容没有消失），但**不该被当成新鲜证据**。
   `contentDigest` 是复核当时的正文摘要：它变了就说明正文在复核之后被改过。

这个字段与 HTML 页面上显示的「来源与复核状态」是**同一份数据**——
页面能看见的，订阅者也必须能看见，否则机器侧会比人侧更信任一篇过期内容。

## 最小导入示例

Node.js 22 可以直接按行处理响应，不需要安装 SDK：

```js
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';

const response = await fetch('https://example.com/content.ndjson');
if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

const lines = createInterface({
  input: Readable.fromWeb(response.body),
  crlfDelay: Infinity,
});

for await (const line of lines) {
  if (!line) continue;
  const record = JSON.parse(line);
  console.log(record.id, record.content.sha256, record.content.text.length);
  // 在这里写入对象存储、全文索引或后续分块队列。
}
```

生产消费端应先检查 `format` 与 `version`，再校验 `content.bytes` / `sha256`。不要把
`text.length` 当字节数：JavaScript 字符串长度不是 UTF-8 字节数，中文会算错。

仓库里的 [`sync:content`](content-sync.md) 是这段最小示例的完整版本：它还会用 manifest
检测全量传输截断、传播删除、修复本地损坏，并保证失败时旧镜像不被半成品覆盖。

## 它刻意不做什么

- **不替你分块。** 不同嵌入模型的上下文窗口、重叠策略和标题保留规则不同；模板预切
  一套“万能 chunk”只会把未经验证的策略强加给消费端。
- **不生成 embedding。** 向量模型、维度与计费属于部署侧选择，静态站不该绑定。
- **不负责鉴权与租户隔离。** 这里导出的本来就是公开内容；私有知识不应进入静态产物。
- **不替代 manifest。** 每次更新都重新下载全文会浪费带宽，增量同步仍应比较 hash。

## 构建期保证

导出不是把几份数据“看起来差不多”地再拼一次。构建会验证：

- 记录 ID 与顺序和 manifest 完全一致；
- 每条正文与真实 `.md` 文件逐字节一致，字节数和 SHA-256 同时匹配；
- Markdown、MDX 都能进入导出，草稿不会进入；
- 所有 URL 在子路径部署下只带一次 base；
- 两个时区的完整构建产物逐字节一致；
- Cloudflare Pages / Netlify / Vercel 都显式配置 NDJSON MIME。

这些约束让它适合作为可靠输入。至于如何分块、检索和回答，仍由真正了解目标模型与
业务数据的消费端决定。
