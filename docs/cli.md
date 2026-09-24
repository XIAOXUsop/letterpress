# 命令行

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（草稿可见） |
| `npm run build` | 构建 + Pagefind 索引（含体检，有错误会中止） |
| `npm test` | **481 项**单元测试，全部离线 |
| `npm run sync:content -- --origin=… --output=…` | 把公开内容同步成本地镜像：首次 NDJSON 导入，后续按 manifest 增量更新，详见[内容镜像同步](content-sync.md) |
| `npm run verify` | 端到端：对着**真实构建产物**验证 200 项契约（条数由脚本自己打印） |
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
| `npm run verify:questions` | 拿 `knowledge/questions.md` 当尺子量检索：23 条问题覆盖精确事实、跨文档组合、冲突、过期、无答案五类。**「无答案」那一类（8 条）是关键**——一个永远给得出答案的检索器只会在它们上面失败。失败时退出码 1 |
| 构建加载期自动跑，无独立命令 | 知识页 frontmatter 里的 **`verify:` 可证伪声明**在构建加载期核对：每条声明查两件事——那句话**还在不在页面上**、以及它对应的**文件在不在**。它管的是 lint 管不到的那一层：**页与仓库之间**。llm-wiki 页原先有三行写着「计划中，尚未实现」而它们全都已落地，没有任何检查会发现 |
| `npm run verify:review` | **`wiki:review` 说的复核状态必须与 frontmatter 一致**。2026-09-24 实测那个命令把 6 个知识页**全报成未复核**——它自己手写的 frontmatter 解析用 `^status:` 匹配**行首**，而状态写在 `review:` 块里缩进两格。这条门禁查两件事：**状态对不对**、**脚本算的摘要与 frontmatter 写的是否一致**（后者正对着「`body` 的 trim 口径只写在调用方注释里，换实现时就丢了」那个坑）。判据是**逐页对账**，不是抽查 |
| `npm run verify:second-site-real` | **读自文件的**异构内容集（`knowledge/fixtures/second-site/`，6 篇，**刻意与本站不同构**：中文 slug、`audience:` 代替 `related:`、`## §1` 编号章节、两篇同名标题、3 篇孤儿页）。它证明「核心不依赖本站的形状」，**证不了**「接入新站点不用改核心」——适配层那 20 行仍然是接新站点时要写的 |
| `npm run verify:second-site-real-mutations` | 上一道的**负向验证**：7 种破坏（不翻译 `audience:` / 缺 summary / 文件名改 ASCII / § 全去掉 / 造断链 / 删歧义引用 / 拆同名标题），每次都必须以**预期的那一条**断言变红。它抓出的最重要一条是：**第一版有四条断言测的是巧合**——「孤儿页恰好 3 篇」是派生结果、「至少一篇是中文」只要求有一个，而它们在实现完全正确时也会变红 |
| `npm run check:site-agnostic` | **核心模块不硬编码本站结构**：知识库 URL 前缀与根层保留路由表必须能由调用方覆盖。判据是**查签名与调用链**（`urlFor` 收不收前缀参数、`lint()` 真的用没用 `opts.reservedPostRoutes`），不是查字面量——因为**写死与「可覆盖的兜底默认值」在字面上完全一样**。对应路线图阶段 4 第 6 项 |
| `npm run verify:site-mutations` | 上一道门禁的**负向验证**：把它依次弄坏四次（删参数、删透传、删注入口、**声明了能力却没接线**），每次都必须真的变红，恢复后必须回绿。**门禁自己绿不算数——它得能被证明是尺子。** |
| `npm run check:exit-codes` | **CLI 错误码都已归类**（阶段 4 第 3 项）。码表在 `src/lib/cli/exit-codes.mjs`：`2` 用法错、`3` 环境错、`4` 语料为空、`5` 查无此项、`6` **内部不变式被破坏**（本工具的 bug，不是用法问题）。`exit(1)` 被明确留给「未归类」，而门禁禁止主动用它——于是**漏归类会表现为退化成 1，可被发现**。门禁脚本的 `exit(1)` 不在管辖内：它们是二元的（红/绿），细分语义只对读输出的人有意义 |
| `npm run verify:exit-codes` | 上一道门禁的**负向验证**：注入三种漏法（字面 `exit(1)`、拼错的常量名、**语法合法但未登记的数字**），每次都必须真红。第三种最要紧——它不会自己暴露 |
| `npm run verify:json-output` | **`--json` 模式的输出契约**（阶段 4 第 3 项剩的一半）。逐个真跑 4 个 CLI 的失败场景，断言四件事：退出码符合码表、stdout 是合法 JSON、`ok` 为 false、**`error.code` 与进程退出码一致**（不一致时消费方与外层 CI 会拿到两个互相矛盾的事实）。并确认成功时也带 `ok`——形状固定，消费方才能写「先解析、再看 `ok`」而不必先判断这次是不是成功 |
| `npm run verify:json-mutations` | 上一道的**负向验证**：注入三类违约（stdout 空 / `ok` 不是 false / `code` 与退出码分叉），每次都必须以**预期的那一条**报红。最后那条是重点：第一次注入改的是调用点的参数，而 `failWithJson` 用同一个 `code` 既写 JSON 又退出，**两边永远一起变**——只有改 `process.exit(code)` 那一行才制造得出分叉 |
| `npm run migrate:manifest -- <v1.json> [-o out.json] [--check]` | 把 `version: 1` 的内容清单迁到 `version: 2`。**`--check` 只验证能否迁移，不写文件**。迁移器**不补任何 `provenance` 默认值**——v1 的 11 篇一条来源信息都没有，补 `pending` 或 `original` 都是撒谎；正确做法是让该键**保持缺席**并在输出里逐条列出。输出**确定性**：不含时间戳，跨时区跑三次逐字节一致。逐字段列举而非 `{...input, version: 2}`——展开会在 v1 日后新增字段时**静默透传**，产出一个「看着像 v2」的假清单 |
| `npm run verify:migrate` | 上一条的**负向验证**：往**真实的线上 v1**（`knowledge/fixtures/manifest-v1.json`）里注入 5 种坏法（缺 `id` / `sha256` 不合法 / ID 重复 / `documentCount` 对不上 / 出现不认识的 v1 字段），每次都必须报出**能定位到具体条目**的诊断。对应路线图退出条件的后半句「**失败时有精确诊断**」 |
| `npm run check:single-source` | **版本号只有一处真值**。`CONTENT_MANIFEST_VERSION` 的真值在 `src/lib/content-manifest.ts`；任何地方再写一遍 `MANIFEST_VERSION = 2` 都会红（注释里的不算）。这条来自一次**真故障**：提交把生产端升到 v2 时同步器与它的测试固件都没跟上，于是**同步器对着本站自己的清单必然报错，而 481 条测试全绿**——因为测试固件也写着旧值，**测的是一个已不存在的格式** |
| `npm run verify:all` | **28 步**依次跑一遍（`check` → `verify:gates` → `test` → `verify` → `verify:testcount` → `verify:search` → `verify:questions` → `verify:impact` → `verify:answers` → `verify:review` → `verify:portability` → `check:site-agnostic` → `verify:site-mutations` → `check:exit-codes` → `verify:exit-codes` → `verify:json-output` → `verify:json-mutations` → `verify:migrate` → `check:single-source` → `verify:second-site` → `verify:second-site-real` → `verify:second-site-real-mutations` → `verify:anchors` → `verify:reproducible` → `verify:base` → `verify:formats` → `check:anchors` → `check:refs`），**不含** `verify:online`（需要外部环境）、`migrate:manifest`（需要显式输入）与三个交互式命令 |
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

### 哪几道验证会改写**源码**

有三道靠「真的改坏再改回来」证明自己不是装饰：

| 命令 | 改哪些文件 | 还原保证 |
|---|---|---|
| `verify:site-mutations` | `src/lib/wiki/graph.ts`、`lint.ts` | 末尾再跑一次门禁，没回绿就退出码 1 |
| `verify:exit-codes` | `scripts/wiki-impact.mjs`（注入点随实现移动过，见脚本注释） | 同上 |
| `verify:migrate` | 只改 `.verify/` 下的**临时副本**，`knowledge/fixtures/` 不动 | 用完即删 |

- 它们在 `verify:all` 里**串行**执行，不会并发踩到彼此；
- 还原失败（比如中途 `Ctrl-C`）会留下被改坏的源码。这种情况下
  `git checkout -- src/lib/wiki/graph.ts src/lib/wiki/lint.ts scripts/wiki-impact.mjs src/lib/cli/json-output.mjs` 即可。
- 跑完必然还原，且脚本末尾会**再跑一次门禁确认已回绿**——
  没回绿就退出码 1，明说「本轮结论不作数」。

> 写成一次不报错、什么都不变的操作，是因为此前把这个脚本放在 `.verify/` 里——
> 而那个目录**被 `.gitignore` 忽略、也被 `npm run clean` 清掉**，
> 于是它既进不了版本库、CI 上也跑不到。**一个跑不到的门禁等于没有。**
>
> 同一类错误本轮还犯过一次：注入变异的函数收到的是 `'graph'`（无 `.ts` 后缀），
> 于是它写出了一个**没有扩展名的文件**，而门禁读的 `graph.ts` **从头到尾没被改过**——
> 四次变异「全部不生效」，症状与「门禁坏了」一模一样。
> 查出来的办法是**打印绝对路径**：逐字比对锚点、验 cwd、验 `writeFileSync`
> 都对，因为它们都在验证前提，而真凶是「**写到了别处**」。

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
