# 命令行

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（草稿可见） |
| `npm run build` | 构建 + Pagefind 索引（含体检，有错误会中止） |
| `npm test` | **385 项**单元测试，全部离线 |
| `npm run sync:content -- --origin=… --output=…` | 把公开内容同步成本地镜像：首次 NDJSON 导入，后续按 manifest 增量更新，详见[内容镜像同步](content-sync.md) |
| `npm run verify` | 端到端：对着**真实构建产物**验证 196 项契约（条数由脚本自己打印） |
| `npm run verify:base` | 子路径部署检查（属性 / 脚本 / 绝对 URL / 纯文本产物 / 内容清单 / NDJSON 全量导出） |
| `npm run verify:formats` | 内容发布探针：真的放入 `.md`、`.mdx`、草稿和占用 `/about/` 的文章，验证格式产出、草稿隔离与系统路由冲突 |
| `npm run verify:search` | 搜索可用性：页面语言一致性、索引语言，以及**内容清单里的每一条都真的标了 `data-pagefind-body` 并进了索引**。**不查结果**——查询行为只能在浏览器里测，原因见脚本注释 |
| `npm run verify:anchors` | 站内链接与锚点契约：产物里**每个站内链接**都要指向存在的文件，**每个带片段的**还要在目标页里找得到那个 `id`。在产物上查而不是从源码再推一遍——小节 ID 是渲染期用 `github-slugger` 生成的，重复标题还带 `-1` 后缀，从源码推算等于再造第三套解析器。**它同时是"两套解析漂开"的探测器**：链接图与 remark 查找表只要对 URL 有分歧，这里就会出现死链 |
| `npm run verify:reproducible` | 扫描生产源码的构建时钟读取，并在 UTC / America/Los_Angeles 做完整构建、逐文件比较 SHA-256；覆盖 Astro 产物与 Pagefind 索引 |
| `npm run verify:online` | **线上烟测**：只打线上地址，验内容协商、NDJSON 全量导出与增量清单真的生效。需要 `SITE_ORIGIN`，没配就直接失败（不退回本地） |
| `npm run verify:testcount` | 单元测试**条数**对账：`npm test` 写出的 JSON 报告 vs README 与 `docs/` 里抄的四个数。读不到报告就失败（读不动 ≠ 通过） |
| `npm run wiki:review -- --slug <名字>` | 取一条知识页的**当前**正文摘要，并打印可粘进 frontmatter 的复核片段。**不自动写回**——"我复核过了"是一个承诺，不该由一次回车作出。`--list` 列出全部条目与状态 |
| `npm run wiki:impact -- --source <id>` | 来源变更的影响分析，输出**三组且互不重叠**：直接引用者（必然要复查）、可能受影响者（一跳邻居，**只是候选**）、仓库辅助载体（docs 与代码注释，不在发布集合里所以最容易漏）。**不联网**——只读已登记的事实，不判断远端有没有出新版 |
| `npm run wiki:ask -- "问题"` | 把一个自然语言问题编译成**带元数据的 context pack**：文档 ID、小节、来源版本、复核状态、与主命中的关系路径。**只挑材料，不下结论**——选错了能对照金标查出来，结论错了只能靠人读，混在一起就没法自动验证。`--json` 给机器读，`--all` 不截断 |
| `npm run verify:questions` | 拿 `knowledge/questions.md` 当尺子量检索：19 条问题覆盖精确事实、跨文档组合、冲突、过期、无答案五类。**「无答案」那一类（5 条）是关键**——一个永远给得出答案的检索器只会在它们上面失败。失败时退出码 1 |
| 构建加载期自动跑，无独立命令 | 知识页 frontmatter 里的 **`verify:` 可证伪声明**在构建加载期核对：每条声明查两件事——那句话**还在不在页面上**、以及它对应的**文件在不在**。它管的是 lint 管不到的那一层：**页与仓库之间**。llm-wiki 页原先有三行写着「计划中，尚未实现」而它们全都已落地，没有任何检查会发现 |
| `npm run verify:all` | 十道依次跑一遍（`check` + `test` + `verify` + `verify:testcount` + `verify:search` + `verify:questions` + `verify:anchors` + `verify:reproducible` + `verify:base` + `verify:formats`），**不含** `verify:online` |
| `npm run check` | 类型检查（Astro + TypeScript） |
| `npm run clean` | 删掉 `.astro/`、`node_modules/.astro/` 与 `dist/`，包括 Astro 7 的持久内容缓存 |

---

## 两个会咬人的地方

### 改了 markdown 配置或插件后必须 `npm run clean`

Astro 7 把内容集合持久化在 `node_modules/.astro/`，不清理会让你以为改动没生效。
只删除根目录 `.astro/` 也不够。这个坑我们踩过——当时所有
`[[链接]]` 都没渲染出来，而**全部测试全绿、构建成功、lint 通过**。

原因：Astro 7 把默认 Markdown 处理器换掉后，`markdown.remarkPlugins`
这个老写法**会被接受但不会执行**，只打印一条弃用警告。正确写法是
`markdown.processor: unified({ ... })`，见 `astro.config.mjs` 里的注释。

### 哪些验证会改写 `dist`

- `verify:base` 会**重建** `dist`，而且用的是假 base
- `verify:formats` 跑完会**清空** `dist`
- `verify:reproducible` 会在两个时区重建，并保留 America/Los_Angeles 下的完整默认产物

两者都是检查。跑完想要可部署的产物，请重新 `npm run build`。

而且 `verify:base` 只跑 `astro build`、**不生成 Pagefind 索引**——
它留下的那份产物是**没有搜索**的。若此时部署或本地预览，搜索会静默缺失。

---

## 为什么 `verify` 要先打包再跑

`scripts/bundle-and-verify.mjs` 会用 esbuild 把验证脚本打成一个包再执行。

原因：验证脚本要 `import` 项目里的 TypeScript 源码（协商逻辑），
这样验的才是**真正跑在生产上的那份代码**，而不是复制一份。
但 Node 的类型剥离只做语法层面的擦除，**不做 `.js` → `.ts` 的路径重写**，
而项目里的 import 写的是 `./accept.js`（TS + ESM 的标准写法）——
于是 Node 找不到文件。esbuild 懂这个约定，打包就绕过了。

## 搜索的加载器为什么要求 CSP 允许 `unsafe-eval`

Vite 会把 `import()` 包成 `__vitePreload(…, __VITE_PRELOAD__)`，
而 Pagefind 的索引是**构建之后**才生成的，Vite 替换不了那个占位符。
结果是运行时报 `ReferenceError`，而且**不发出任何网络请求**——
看起来像「搜索框永远转圈」，排查时不会怀疑到打包器头上。

绕开办法是用 `new Function` 构造导入（`src/pages/search.astro`），
代价就是这条 CSP 要求。若你启用了严格 CSP，需要为搜索页开例外，
或改用其他加载方式。
