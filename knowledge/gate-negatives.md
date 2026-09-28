# 门禁的负向验证记录

**每条门禁都记着：它被弄坏过吗？红了没有？**

## 为什么要有这份文件

「这个检查有效吗」这个问题，**光看它绿着无法回答**——
一个永远绿的检查和一个真在守的检查，在正常运行时长得一模一样。

本项目已经吃过好几次同族亏：

- `verify:search` 三项全绿，而它只查「全站 lang 一致」不查「lang 正确」；
- 刚加的「站内 JS 体积」门禁**永远量到 0**（`check-formats` 不跑 pagefind）；
- locator 检查只比章节号，`ch` 与 `ic` 同在 §5.1.1，于是 `ic` 没登记也放过。

**共同点：它们都绿过，而绿是它们没在工作的证据。**

## 怎么读这份表

- **验过 = 我真的注入过故障，并确认它变红。** 不是「理论上会红」。
- 没验过的行写「**未验**」——那不是缺陷，是**已知的空白**。
- 日期是注入的日期，不是脚本的日期。

## 表

| 门禁 | 注入什么 | 结果 | 日期 |
|---|---|---|---|
| `verify:testcount` | 把 README 里的测试条数改成 999 | ✅ 红 | 2026-09-24 |
| `verify:anchors` | 造一个指向不存在锚点的链接 `[[x#不存在]]` | ✅ 红 | 2026-09-24 |
| `verify:base` | 在组件里注入绕过 `path()` 的硬编码 `href` | ✅ 红（32 个页面） | 2026-09-24 |
| `verify:search` | 把全站 `<html lang>` 改成 `xx-YY`（不存在的语言） | ✅ 红 | 2026-09-24 |
| `verify:impact` | 删掉一条金标用例 | ✅ 红（暴露「全过≠都量过」） | 2026-09-24 |
| `verify:impact` | 金标里点名一个未登记的来源 | ✅ 红 | 2026-09-24 |
| `verify:impact` | 把来源登记退回「只覆盖 §2.2.2」 | ✅ 红（`ic` 未覆盖） | 2026-09-24 |
| `verify:impact` | 删掉某版本的 `evidence` | ✅ 红 | 2026-09-24 |
| `verify:questions` | 闸二失效 | ✅ 红 | 2026-09-24 |
| `verify:questions` | 闸一门槛归零 | ✅ 红 | 2026-09-24 |
| `verify:questions` | 接缝识别失效 | ✅ 红 | 2026-09-24 |
| `verify:questions` | 单字母权重闸失效 | ✅ 红 | 2026-09-24 |
| `verify:questions` | 问句壳剔除失效 | ✅ 红 | 2026-09-24 |
| `verify:portability` | 把 `graph.ts` 的 import 改回 `.js` 后缀 | ✅ 红 | 2026-09-24 |
| `verify:portability` | 把 `?.related?.includes` 改回 `?.related.includes` | ✅ 红 | 2026-09-24 |
| `verify:formats` | 让 `provenance` 不进产物 | ✅ 红 | 2026-09-24 |
| `verify:formats` | 把 manifest 源码常量改成 3（期望值不动） | ✅ 红 | 2026-09-24 |
| `verify:formats` | 把 CSS / 字体 / 站内 JS 体积改成错值 | ✅ 红 | 2026-09-24 |
| `verify:formats` | 往 `_astro` 里塞第二份 CSS | ✅ 红 | 2026-09-24 |
| `verify:second-site` | 从异构语料里去掉 `refs` 字段 | ✅ 崩（暴露崩溃 bug） | 2026-09-24 |
| `verify:reproducible` | 在生产源码里读构建时钟 | ✅ 红 | 2026-09-23（此前记录） |
| `verify:only`（契约） | 篡改产物里的 markdown 字节数 / hash | ✅ 红 | 2026-09-23（此前记录） |
| **`verify:online`** | **未验** | 它对线上 Demo 跑，Pages 上 7 项协商必然红——**那是 README 写明的限制，不是缺陷** | — |
| `verify:answers` | 把 `read-page` 的字段名改回 `refs` | ✅ 红（4 条主命中没有依据） | 2026-09-24 |
| `verify:answers` | 让「无依据」类返回段落 | ✅ 红 | 2026-09-24 |
| `verify:gates`（编排检查） | 从 `verify:all` 里删掉 `verify:questions` | ✅ 红（13 步 vs 期望 14 步，并指出第 7 步错位） | 2026-09-24 |
| `verify:portability` | 从 `wiki-review.mjs` 摘掉 `pageToDoc` 的 import 与调用 | ✅ 红（「没有真实调用方」） | 2026-09-28 |
| `check:onboarding-doc` | 把接线文档表①里的断链数从 3 改成 9 | ✅ 红 | 2026-09-28 |
| `check:onboarding-doc` | 删掉表①的两行数据行 | ✅ 红（12 条，报「取不到这个值」） | 2026-09-28 |
| `check:onboarding-doc` | **第一版把期望值硬编码在脚本里、文档读进来却从不使用** | ⚠️ **判据自己错了**——改文档不会红，改代码才会红；而它声称要核的正是文档。重写为「从文档表格里解析数字」，再验上述两条 | 2026-09-28 |
| `check:agents-doc` | 让 `buildGraph` 的标题不进 `lookup`（只坏「写标题」那条路） | ✅ 红，且**分别报出**「只写标题 → 没解析到；只写 slug → 解析成功」 | 2026-09-28 |
| `check:agents-doc` | **第三类断言的 `viaTitle` 与 `viaSlug` 是同一行代码** | ⚠️ **同一个断言写了两遍**——`outbound` 里两个链接落进同一个 `Set`、去重后只剩一个元素，所以单看它区分不出哪条路解析了。拆成两份语料各自只含一个链接，再分别断言 | 2026-09-28 |
| `verify:questions` | 删掉 `relationList` 里「剥方括号」那两行 | ⚠️ **仍绿——它压根不在量这条路径**。原因：语料里的关系都是 `[a, b]`（含分隔符），不剥括号 `split` 照样切得对，**只有单元素时才会坏**。已补 4 条单测覆盖单元素 / 多分隔符 / 字段缺席 / 字段名是参数，变异后 4 条会红 | 2026-09-28 |
| `verify:second-site-real` | 把适配层的字段名从 `audience` 改成 `audiences` | ✅ 红，且**只有那一条**红（其余 18 条不受影响） | 2026-09-28 |
| `verify:second-site-real` | 干脆不传 `relationField` | ✅ 红，且**只有那一条**红 | 2026-09-28 |
| `check:onboarding-doc` | 把 README 里的断言条数改回旧的 18 | ✅ 红（「找不到 20」） | 2026-09-28 |
| `check:two-paths`（新） | 撤掉 `pageToDoc` 里 `post` 丢 `wikiKind` 的对齐 | ✅ 红 | 2026-09-28 |
| `check:two-paths`（新） | 撤掉 `post` 丢 `declaredRelations` 的对齐 | ✅ 红 | 2026-09-28 |
| `check:two-paths`（新） | 撤掉 `post` 丢 `review` 的**外层**守卫 | ✅ 红 | 2026-09-28 |
| `check:two-paths`（新） | **只撤内层条件展开那一道锁** | ⚠️ **仍然绿——因为外层 `const review = isWiki ? … : undefined` 挡住了**。同一个约束写了两道锁，**它们互为掩护** | 2026-09-28 |
| `read-page` 的 `original` 解析 | 把「先切出 `original:` 块」换成「全文扫 `reason:`」 | ✅ 红（`不会串到别的块里的 reason:` 与 `空 reason` 两条都红） | 2026-09-28 |
| `read-page` 的 `original` 解析 | 我第一版那条测试的固件用 `locator:` 而不是 `reason:` | ⚠️ **测不到 ≠ 测过**——那个固件压根触发不了串味，换成「`review:` 块里有一行 `reason:`」才真正验到 | 2026-09-28 |
| `check:two-paths` | 把构建侧 `related` 那处判定删掉（4 → 3 处） | ✅ 红（**修好之前它绿**——第一版只判 `gates === 0`，「基准还在」被当成了「基准没变过」） | 2026-09-28 |
| `check:two-paths` | 给构建侧加第 5 处判定 | ✅ 红 | 2026-09-28 |

## 读路径与构建路径的「post 口径」曾经三处分歧（2026-09-28）

本仓库有**两条**从内容到 `Doc` 的路：构建期 `src/lib/content.ts` 的 `toDoc`
（拿 `astro:content`），与读源码 `readContentDirs` + `pageToDoc`（裸 Node，供 `scripts/*.mjs`）。
**它们必须给出同一个 `Doc`**，否则同一页在构建产物与 CLI 回答里形状不同，
而 `wiki:ask` 的 `docId` 正是订阅者做增量同步的键。

`content.ts` 里有 **4 处** `kind === 'wiki' ? … : …`（`related` / `review` /
`original` / `wikiKind`），而 `pageToDoc` 起初**一处都没对齐**。

**为什么一直没发作**：本站 posts 里 **0 篇**写这些字段（实测无 `^related:`、无 `^kind:`）。

> **「本站没有这种数据」与「这条路径正确」是两件事**——
> 前者让后者从未被测过，而两者在输出里长得一样。

修完三处，并加 `check:two-paths` 门禁：数构建侧有几处判定当基准，
**真跑** `pageToDoc` 两种 `docKind` 逐项断言（不 grep 两边源码有没有同样的字符串——
写法可以完全不同，**行为一致才是契约**）。

⚠️ 加 `post` 那一侧时踩过一次「键在、值是 `undefined`」：
`{ a: undefined }` 与省略键在 `doc.a` 上一样，但 `Object.keys()` 与
`JSON.stringify` 不同——而 `content-manifest` 正是把 `Doc` 序列化出去的。
所以 `post` 侧是**整个键都不出现**。

⚠️ 同日还发现：给 `knowledge-gates` 的摘要加门禁时，我加了第 14 道却忘了改
写死的 `/ 13`，它打印「通过 14 / 13」。**与「少一步不会有任何报错」同家族**，
已改成从步骤列表自己数（`total="$(printf '%s\n' "$steps" | grep -c .)"`）。

### 一条**被我夸大过、后来实测推翻**的说法（2026-09-28）

我在 `page-to-doc.ts` 的注释里写过：「`post` 侧的键整个不出现，而不是给
`undefined`——因为 `JSON.stringify` 会不同，manifest 会不一致」。

**实测：两边序列化后逐字节相同。** `JSON.stringify` 会丢掉值为 `undefined`
的属性，所以「键在、值 undefined」与「键不出现」**在产物上完全一样**。
差别只在**内存里那个对象**的 `Object.keys()` / `hasOwnProperty`。

已改成实测口径，并加了一条断言把这件事钉住
（`省略键与给 undefined 在 JSON 产物上完全相同——差别只在键集合`）。

> 教训与本文件里那条「本地绿 CI 红」同源：
> **我先写下一个听起来很严重的后果，再去核实它。**
> 而核实只需一行 `JSON.parse(JSON.stringify(x))`。
>
> 顺带说明「为什么要统一写法」这个决定**仍然成立**——
> 但成立的理由是「同一约束散在多处会互为掩护」，
> **不是**「产物会不一致」。理由变了，结论碰巧没变，但那是因为我先做对了收敛。

## CI 现状（2026-09-28 收尾时）

最后一次实测：`4a20448` 与 `f865a30` 两次推送，**GitHub Actions 全部 success**。
job：`完整门禁`（`verify:all` 全 33 步）、`构建与测试`、`知识层门禁（纯计算）`、
`知识层门禁（子进程）`、`内容体检`、`密钥扫描` 全绿；
`线上内容协商烟测` 按设计 skip（需要 `SITE_ORIGIN`，Pages 跑不了内容协商）。

> 这是**第一次**有 CI 证据表明那 26 道门禁真的在把关——
> 而在此之前，它们「在 `verify:all` 里」这件事没有任何东西在核。

## 门禁存在、编排里有、**CI 不跑**（2026-09-28）

`verify:all` 有 **33 步**，而 CI 的 `build` job 只显式调用了其中 **7 个**。
**剩下 26 道在 CI 上从来没跑过**——包括本仓库最核心的那批（检索金标、
影响分析、答案可定位性、复核状态、核心可移植性、错误码与 JSON 输出契约、
异构站点、迁移器、文档一致性）。

**为什么难发现**：`check-gate-list.mjs` 守着「没有『定义了却不在编排里』的门禁」，
而这些门禁**确实在 `verify:all` 里**——缺的那一环是 CI 没调 `verify:all`。
**每一道门禁单独看都是绿的，缺口在它们与 CI 之间的接缝。**

此前有人注意到过一次（`ci.yml` 里 `verify:testcount` 那段注释写着
「**但 CI 从来没调用过它**」）——**只补了那一条**。

已加 `knowledge-gates` job，串行跑 21 道不依赖 `dist` 的门禁。验收方式：
① YAML 用 `yaml` 包解析确认合法；② 导出 `run` 脚本用 `bash -e` 实跑，21 步全绿
（16.7 秒）；③ 注入一道必红（只改文档、不动源码）→ 报
`::error::以下门禁在 CI 上是红的： check:onboarding-doc`、退出码 1、
**21 步全部执行完**（证明失败不提前终止）。

## `verify:migrate` 靠「别人已经建过目录」而绿（2026-09-28）

CI 上「知识层门禁（子进程）」连续三次红。定位过程本身值得记：

1. **读不到失败详情**：job 日志要 admin 权限（匿名 API `403 Must have admin rights`）；
   `::error::` 只出现在日志里、不映射到 check annotation；
   `GITHUB_STEP_SUMMARY` 的内容也不在 check-run output 里。
   **唯一匿名可读的是「哪个 step 红了」**。
2. 靠这一点把 21 道拆成两个 job（纯计算 / 起子进程）→ 定位到子进程组；
   再把 8 道拆成 8 个 step → 定位到 `verify:migrate`；
   再把 5 条坏法拆成 5 个 step（为此给脚本加 `--only N`）→ **定位到第 ① 条「缺 id」**。
3. 已排除且**都不是**原因：单独跑绿、组合跑绿、`full-gates` 的 `verify:all` 里也绿、
   `.verify/` 被 gitignore、无 locale / 排序 / 时区依赖、
   从 git 对象读的字节与工作区逐字节相同、`e.stdout`/`e.stderr` 实测都是 string。

**根因**：`TMP = .verify/manifest-mutated.json`，而脚本**从不建那个目录**。
`.verify/` 在 `.gitignore` 里，所以：

| 环境 | `.verify/` 在吗 | 结果 |
|---|---|---|
| 本地 | 在（**别的门禁留下的**） | 绿 |
| CI 全新 checkout | **不在** | `ENOENT` → 红 |
| `full-gates` 的 `verify:all` | 在（第 5 步 `verify:testcount` 刚写过报告） | 绿 |

> **同一批门禁，因为前面的步骤做过什么而结果不同。**
> 而「本地绿、CI 红」这个症状指向的却是「平台差异」——方向完全错。

修法是一行 `mkdirSync(…, { recursive: true })`（已存在时不报错，不改变任何已有行为）。
**变异验证**：删掉 `.verify/` 后绿；撤掉 `mkdirSync` 后红（退出码 1）。

⚠️ 这一条与 [[comment_planned_not_implemented]] 是同一个家族：
**依赖一个没人声明的前置条件**。区别是那次写在注释里，
这次**连注释都没有**——它只是「碰巧在本地成立」。

## 一个**被推翻的发现**：`full-gates` job「生下来就是红的」（2026-09-28，已推翻）

`origin/test` 上有一个 2026-09-26 的提交 `4f75c77`「ci: 在 test 分支运行完整门禁」，
加了个 `full-gates` job 直接跑 `npm run verify:all`，并带了 `scripts/ci-wiring.mjs`
守着接线（含三条自测）。**与本轮我做的 `knowledge-gates` 是同一个问题的两种解法。**

合并后我**断定那个 job 从被加上那天起就是红的**，理由是：
「`verify:all` 第 4 步 `npm run verify` 打在 `dist` 上，而 CI 是全新 checkout」。
我据此给它补了 `npm run build`，又给 `ci-wiring.mjs` 加了一条判据
「`verify:all` 之前必须存在一次 build」，并配了两条自测。

**⚠️ 那个判断是错的，2026-09-28 当天推翻：**

- `package.json` 里 `verify` = `npm run clean && npm run build && node scripts/bundle-and-verify.mjs`
  ——**它自己先 clean 再 build**。我**没读那条定义**就下了结论。
- 证据：加之前 `full-gates` 在 CI 上就是 **success**（run 36171364455，
  job「完整门禁」）。

已撤销：build 步骤、`ci-wiring.mjs` 里那条判据、`check-gate-list.mjs` 里那两条自测，
三处都留下了「不要重新加」的记述。

> **症状是「本地绿 / CI 红」，而我当时先假设了平台差异。**
> 方向错，害我查了六类全都不是原因的东西（行尾、大小写、`/tmp`、locale/排序/时区、
> `e.stdout` 类型、git 对象与工作区的字节）。
>
> 而真正的原因在另一处：`verify:migrate` 依赖一个**被 `.gitignore` 掩盖的目录**
> （见上一节）。**假设先定，证据后找——被推翻的几乎总是假设。**
>
> 记在这里而不是删掉，因为**「我曾这么想过、并且是错的」本身就是有用的**：
> 下次看到「本地绿 CI 红」，先问「我这次假设的是什么」，而不是直接开始排查。

## 剩下的一条「未验」

**`verify:online`**：它对着 GitHub Pages 上的 Demo 跑，而 Pages 跑不了内容协商
（响应头不可改）——实测那 7 项会红，**README 已写明这是限制**。
所以它**不适合做注入式负向验证**：基线本身就是红的。

（原以为「编排本身」也未验——**2026-09-24 已补上 `verify:gates`**，
它检查 `verify:all` 的步骤数、顺序、脚本存在性，以及
「有门禁定义了却不在编排里」。后一条在建成当场抓到 3 个：
`wiki:review` / `wiki:impact` / `wiki:ask`——它们**确实**是人工触发的，
但理由此前只存在于我脑子里。现已写进脚本的 `NOT_IN_ALL`。）

> **「故意不加」与「忘了加」在输出里长得一样。**
> 所以不进的门禁必须**在代码里写明理由**，而不是靠「门禁没报」蒙混。

## 怎么补一条

1. 找一个**能被制造出来的故障**（改一个值、注入一个文件）；
2. 跑那个门禁，**确认退出码非 0**；
3. 恢复，**确认退出码回到 0**；
4. 在上面表里加一行，**写清注入的是什么**。

⚠️ **只做第 1、2 步是不够的**——
本项目发生过「注入后红了，但恢复后仍红」（忘了重建 `dist`），
以及「恢复的 `cp` 失败、文件其实被改坏了」。
**第 3 步与第 4 步同样重要。**

---

## 阶段 4 退出条件：逐条核对（2026-09-24）

> 原本记在 `knowledge/log.md`，而那个文件被删了两次（理由是「移除与站点使用无关的
> 设计与过程记录」）。**把结论挪到这里**，因为它和这份台账是同一类东西：
> **哪些有证据、哪些没有。** 过程可以删，**结论不该跟着一起消失**。

判据是「**有证据**」与「**没证据**」，不是「做了一些」——**部分达成必须写成部分达成**。

| # | 退出条件（路线图原文） | 状态 | 证据 / 缺口 |
|---|---|---|---|
| 1 | 一个**全新的真实内容集**能在不复制内部代码的情况下使用核心流程 | **部分达成** | `verify:second-site-real` 读 `knowledge/fixtures/second-site/` 的异构内容。<br>⚠️ **但「不复制内部代码」只做到一半**：适配层仍有站点专属部分，**它仍是接新站点时要写的东西**。<br>**2026-09-28 再收一块**： `readContentDirs` 加 `relationField` 参数——站点把关系声明叫 `audience` 时，核心**只收一个字符串**，不认识任何站点的字段名。<br>**适配层从 27 行降到 3 行**（`pageToDoc` 22 行 + `readContentDirs` 补 summary 8 行 + `relationField` 5 行 → 现存 3 行，且**没有一句是「适配」**，只有「目录在哪」与「字段叫什么」）。<br>两种变异（字段名改错 / 干脆不传）**各只有一条断言红**，其余 18 条不受影响——说明新参数走的是独立路径。<br><br>**2026-09-28 补一条此前漏掉的证据**：`pageToDoc` 抽出来之后，**全仓库只有一个调用方，而那个调用方是验证它可复用的测试脚本**——即「没有任何真实路径在用它」。<br>已处置：① 用它替换掉 `wiki-review.mjs` 里手写的第二份 `digestDoc`（**摘要 926 字节逐字节未变**）；② `check:portability` 加第三条断言「核心模块必须有真实调用方」，并做了变异验证。<br>**教训**：抽公共函数不等于复用了它——**没人调用的公共函数只是一段没人验证的承诺**。

**同日续做**（把文档教的那 12 行接线收进核心）：

| 改动 | 依据 |
|---|---|
| `readContentDirs` 顺带补 `summary` | 此前每个要摘要的调用方都得自己重走「遍历 → 读文件 → `frontmatterField`」，**而那段代码里最容易漏的是 `.sort()`**——本机 NTFS 恰好已排序，漏了也看不出（同型：「本站 0 篇写 `slug:`，所以那个 bug 从未发作」） |
| `readContentDirs` 的返回类型从 `ReturnType<typeof readContentPage>` 改成 `& { summary: string }` | ⚠️ **类型签名与运行时形状脱节**：运行着没问题、类型上却报「Property 'summary' does not exist」，于是调用方只能加 `as any` 或干脆不读它——**编译器成了摆设**。`astro check` 抓到 |
| 接线从 12 行降到 2 行；`wiki:review` 的 6 页 `contentDigest` **926 字节逐字未变** | 摘要是写进 frontmatter 的，改一个字就意味着 6 页复核状态全部失效 | |
| 2 | v1 数据可确定性迁移到 v2，**失败时有精确诊断** | **✅ 达成** | `migrate-manifest.mjs` + `verify:migrate`（5 种坏法）。<br>**确定性**：跨时区跑三次 `cmp` 逐字节一致。<br>**诊断**：5 种坏法全部报出**能定位到具体条目**的诊断。输入是**真实线上 v1**。 |
| 3 | schema、CLI 和输出契约都有**兼容性测试** | **部分达成** | CLI 错误码：`check:exit-codes` + 5 种变异。<br>输出契约：`check-json-output` + 3 类变异。<br>schema：`public/content-manifest.schema.json`（JSON Schema 2020-12，与产物同源发布）+ `check:manifest-schema`（**双向**核对 + **源码/产物/schema 三处 version 一致**）。<br>⚠️ **「兼容性测试」这个词仍偏重**：现在测的是「**当前形状被守住**」，不是「**旧形状仍被接受**」——后者要有真实的旧消费方才能测。 |
| 4 | 第二个站点的接入**确实减少重复维护**，而非只做演示 | **❌ 未达成** | fixture 是**测试语料**，不是**真的第二站点**。<br>「减少重复维护」要有一个真站点用起来才知道。<br>探针输出末尾印着这句话，是刻意的。 |

### 结论

**1 条达成、2 条部分、1 条未达成。**

路线图原文：「**只有达到这些条件，才考虑拆分**」
（`@letterpress/knowledge-core` / `@letterpress/astro` / `@letterpress/mcp`）。

**现在不该拆。** 理由不是「没做完」，而是三条具体的：

1. 适配层仍是每次都要写的——**那正是拆分要解决的重复**；
2. 第 4 条**完全没有证据**；
3. 第 3 条表明现在的契约是「守住当前形状」，
   而**拆分的前提正是「下游已经依赖了某个形状」**。

> **「四项做完」与「可以拆」是两件事。**
