# 内容镜像同步：把发布出口真正接进下游

仓库自带一个零依赖参考同步器，用来证明 `/content.ndjson` 与
`/content-manifest.json` 不只是“看起来能用”的两个文件，而是可以完成首次导入、增量更新、
删除传播和损坏修复的一条闭环。

```bash
npm run sync:content -- \
  --origin=https://example.com \
  --output=.verify/content-mirror
```

`--origin` 可以包含部署子路径，例如 `https://example.github.io/letterpress`。`--output`
必须显式提供；示例使用已经被 Git 忽略的 `.verify/`，避免把远端镜像误提交进仓库。

## 第一次与后续同步

第一次运行固定发送两个请求：

1. 流式读取 `content.ndjson`，一次拿到全部正文；
2. 读取小型 `content-manifest.json`，确认记录数量、顺序和每条元数据完全一致。

第二个请求不是重复下载正文。它解决的是一个真实完整性问题：如果传输恰好在一条完整
NDJSON 记录后中断，剩下的每一行依然都是合法 JSON，仅凭文件结尾无法知道后面还有内容。
用 manifest 对账可以发现这种“语法正确但内容不完整”的截断，同时仍把首次导入从
`1 + N` 次请求降为固定两次。

后续运行只请求 manifest，并按 SHA-256 分类：

- hash 未变且本地文件完好：从旧镜像复制，不发网络请求；
- 新增或 hash 变化：只下载对应 `.md`；
- 状态未变但本地文件损坏或丢失：重新下载并计入“修复”；
- 旧状态存在、新 manifest 消失：从新镜像删除。

命令结束时会打印新增、更新、修复、未变和删除数量，可直接放进定时任务或索引流水线。

## 镜像结构

```text
content-mirror/
├── content-manifest.json      # 本轮已验证的清单副本
├── .letterpress-sync.json     # 同步器自己的状态与文件映射
└── documents/
    ├── post%3Ahello.md
    └── wiki%3Aconcept.md
```

文件名使用完整文档 ID 的 URI 编码。这样嵌套 slug、反斜杠或 `..` 都不能逃出
`documents/`；真实 ID 和元数据仍保留在两份 JSON 中，下游不需要从文件名反推语义。

## 失败时会怎样

同步器不会在原目录上逐个覆盖。它先在同级临时目录构建一份完整新镜像，所有正文通过
UTF-8、字节数与 SHA-256 校验后才整体替换旧目录。下载失败、hash 不符、NDJSON 截断、
重复 ID 或非法格式都会让命令非零退出，旧镜像保持可用。

另外有三条明确的安全边界：

- 非空目录如果没有同步器状态文件，拒绝覆盖；
- 已属于另一个站点的镜像，拒绝换源覆盖；
- manifest 里的正文 URL 必须位于它声明的站点根下，不能借同步器抓取第三方地址。

## 为什么没有直接做 MCP Server

MCP 的 Resource 很适合把内容提供给模型，但远程 MCP 使用 JSON-RPC 与 Streamable HTTP，
需要处理 POST、协议版本和服务端生命周期。把它硬塞进纯静态站会破坏 Letterpress 的
“零后端、任意静态托管”边界，也无法在 GitHub Pages 上运行。

这里选择保留静态发布出口，再提供一个可移植同步器。需要 MCP 的团队可以让自己的 MCP
Server 读取这个本地镜像；博客本身不因此承担常驻服务、鉴权和协议升级成本。

JSON Schema 也有价值，但它只能验证结构，不能完成差异下载、删除传播或失败回滚。
仓库现已提供 `public/content-manifest.schema.json` 验证清单结构；Schema 是同步链路的补充，
仍需由同步器负责差异下载、删除传播和失败回滚。

这次取舍依据的是协议本身，而不是二手功能对比：

- [NDJSON 1.0](https://github.com/ndjson/ndjson-spec) 规定 UTF-8、逐条换行与
  `application/x-ndjson`，同时允许解析器自行决定是否忽略空行；本同步器明确忽略空行。
- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12)适合描述和验证 JSON 结构，
  但不定义同步、删除或事务语义。
- [MCP Transport](https://modelcontextprotocol.io/specification/draft/basic/transports)要求客户端与
  服务端交换协议消息；它不是“放一个静态 JSON 文件”就能成立的能力。
- [RFC 9110 条件请求](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2)里的 ETag / 
  `If-None-Match` 很适合缓存验证，但 ETag 由托管平台控制，不能作为跨平台内容 ID；因此同步
  契约继续使用构建期生成、可跨环境复核的 SHA-256。
- [RFC 9530](https://www.rfc-editor.org/rfc/rfc9530.html)定义了 `Content-Digest`，但静态站能否
  添加该响应头仍取决于托管平台。正文 hash 放在 manifest 中，对 GitHub Pages 同样可用。

## 自动验证覆盖

测试会真实创建临时镜像并覆盖以下场景：

- 首次 NDJSON 导入与 manifest 对账；
- 后续只请求新增和变化正文；
- 删除传播；
- 本地损坏自动修复；
- 错误 hash 下旧镜像不受影响；
- 完整记录边界上的 NDJSON 截断；
- 跨站正文 URL 拒绝；
- 非空、非本工具目录拒绝覆盖。
