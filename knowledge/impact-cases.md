# 影响分析金标

这份文件是 `wiki:impact` 的**尺子**。`npm run verify:impact` 会拿它跑
`src/lib/wiki/impact.ts`，对不上就红。

它和 `questions.md` 是同一种东西：一个工具声称「能算出影响」，
光看输出没有意义——**得有一份已知的正确答案摆在那里**。

## 怎么写一条

用例是**连续三行**，且**不能被空行或散文隔开**：

```
source: <来源 id>
expectDirect: <slug、slug>
expectCandidates: <slug、slug>
```

- 三个字段**都必须写**，哪怕值是空的（`expectDirect:` 后面什么都不写）。
- **期望值写 slug，不写数量。** 写数量的话，多召回一个或少召回一个
  都可能凑巧对上——「1 个」既可能是对的那一个，也可能是错的另一个。
- 散文、`>` 引用块、代码块里出现这三行**不算用例**——解析器只认
  紧邻的三连行。这一点是踩过的坑，见文末。

## 为什么这份金标同时是一份事实快照

期望值是**从真实内容里读出来的**，不是编的。所以：

- 它一旦与实际不符，要么是 `impact.ts` 算错了，要么是**真的改了引用关系**；
- 两种情况都值得知道，而**只有把它钉下来才能知道**。

改了引用关系却不同步这份文件，门禁会红——**这是故意的**。
那一刻你需要判断：新引用漏登记了，还是金标该更新。

## 这份金标量不到什么（写在前面，免得被它的绿灯误导）

1. **它只量 wiki 层。** `impact.ts` 的输入就是 `src/content/wiki/` 的页面，
   posts 尚未参与来源模型（见 `knowledge/log.md` 迭代 G 的未决项）。
   下面两条 `expectDirect` 为空的用例正是这个边界的直接后果。
2. **它不联网。** 查的是「已登记的这个来源被谁引用」，
   **不是**「远端有没有出新版」。后者是另一件事。
3. **③ 组（仓库辅助载体）不在这里。** 那部分要扫整个仓库文件系统，
   放进金标会让「改一个无关文件」也变成门禁红——而它本来就该宽松。
   它的互不重叠由 `impact.test.ts` 的 `isDisjoint` 量。
4. **② 组只量 wiki 页。** `cjk-web-typography`、`markdown-for-agents` 这些
   post 出现在 ③ 组而**不在** ② 组——**这正是「不相邻不等于不相关」的
   具体例子**，不是漏报。

---

## 有引用的来源

### 中文排版：规范与字体清单（知识页与文章各引一份）

source: css-values-4
expectDirect: cjk-typography、cjk-web-typography
expectCandidates: design-tokens

source: css-fonts-4
expectDirect: cjk-typography、cjk-web-typography
expectCandidates: design-tokens

source: apple-system-fonts
expectDirect: cjk-typography、cjk-web-typography
expectCandidates: design-tokens

> 三个的 ① 都是**两页**——知识页 [[中文排版]] 与文章《中文网页排版》。
> 同一个论断在两处出现，两处都该被登记：只登记一处的话，
> 改那篇文章时影响分析不会叫你。
>
> ② 都是 `design-tokens`（`cjk-typography` 的 `related` 里有它）。
> `cjk-web-typography` 是 **post**，没有 `related` 声明，所以它不进 ②——
> **这是「不相邻不等于不相关」的具体例子**：它在 ① 里，不在 ② 里。

### 内容协商：知识页与文章各引一份

source: rfc9110-accept
expectDirect: content-negotiation、markdown-for-agents
expectCandidates: letterpress、llm-wiki

> ① 两页：[[内容协商]] 与《你的博客该不该给 AI 一份 markdown》。
> ② 的 `letterpress` 是**反向**命中的——它的 `related` 里有 `content-negotiation`。
> 只算一个方向就会漏掉它，而漏掉不会有任何报错。

source: rfc7763-markdown
expectDirect: markdown-for-agents
expectCandidates: content-negotiation

> `text/markdown` 媒体类型的登记。**只有文章引它**，知识页没引——
> 所以 `rfc9110-accept` 有两个直接引用者，它只有一个。

### 那组「别人测的」token 数字

source: cloudflare-markdown-for-agents
expectDirect: markdown-for-agents
expectCandidates: content-negotiation

> Cloudflare 拿自己文档测的 16,180 → 3,150。**本项目从未复现**，
> 文章里也明确这么写了。登记它是为了让「这组数字的测量条件是什么」
> 有处可查，而不是把它当成本站的实测。

### llms.txt 的两个外部依据

source: google-ai-features
expectDirect: markdown-for-agents
expectCandidates: content-negotiation

source: ahrefs-llmstxt-study
expectDirect: markdown-for-agents
expectCandidates: content-negotiation

> **上一版这两条的 `expectDirect` 是空的**，因为当时只量 wiki。
> 扩展到 posts 之后它们都有了引用者——**那个「0」从来不是「没人引用」，
> 是「没看那一层」。** 这是本轮最值得记的一条：
> **一个 0 有两种来源，查不到和不存在，而它们在输出里长得一模一样。**

### LLM 知识库

source: llm-wiki-gist
expectDirect: llm-wiki
expectCandidates: content-negotiation、letterpress

> 这条是 2026-09-24 补登记后新增的：`llm-wiki.md` 此前**没有 `sources` 块**，
> 尽管正文明确引用了这个 gist、而且「10–15 页」那句刚做完逐字勘误。
> **页面引用了来源却没登记**——金标的第一版期望值就是照着「没人引用」写的。

---

## 登记了但还没有页面引用的来源

**目前没有这一类。** 9 个已登记来源全部至少有一个直接引用者。

这一节保留，是因为**它必须存在**：

- 上一版（只量 wiki 时）这里有两条，`expectDirect` 为空，
  注明「引用方是 post，不在图内」。扩展到 posts 之后它们有了引用者，
  于是两条被移到了上面。
- **如果哪天又出现「登记了但没人引用」，这里就该多一条**，
  并且要注明属于哪一种：真的没人引用（如实记录），还是本该有人引用但漏了（要补）。

> **空期望有两种完全不同的含义**，混在一起就看不出是哪一种。

---

## 没有登记、也不该登记的

2026-09-24 曾登记过 `cn-font-split` 与 `pangu.js` 两个 GitHub 仓库
（文章里都有链接），**随后撤掉了**。

原因：它们在文章里只是**顺带提及**——「实在要自托管中文字体时用它做子集化」、
「过去这件事要靠 pangu.js 之类的库」。**它们不支撑任何论断。**

> 登记的含义是「这条结论有据可查」。把顺带提及的链接也登记进去，
> 会让「已登记」这个状态从「我验证过」退化成「我见过这个链接」——
> **而那正是这套东西最容易制造出来的错觉。**
> 保持「只在值得单独治理的结论上标」这条原则，比多登记几个要难。

---

## 写这份金标时踩到的坑（留给下一个人）

**第一版解析器太宽松，把散文当成了用例。**

我最初的正则允许三个字段之间隔着任意内容，于是文档里的
`### source: …` 标题和 `> 引用块` 全被吞进用例，报出
「金标里点名了这个来源，但没登记」——**而那句话根本不是用例**。

**第二次方向相反**：收紧成「三行紧邻」之后，文档开头那段讲格式的
``` 代码块**本身就是一组合法格式的三连行**，于是又被当成一条真用例。

> **两次的教训合成一句：判定条件不能只看形状，还要看位置。**
> 代码块要先剥掉。「格式说明本身就是一种误判来源」——
> 这条不踩过一次想不到。

**第三次：期望值是凭印象写的，三条不对。**

`rfc9110-accept` 我写候选为空，实际有 `letterpress`、`llm-wiki`；
`css-values-4` 等三个我都写候选为空，实际都有 `design-tokens`。

> **写金标第一条规则：期望值必须从实际运行结果导出，不能凭印象写。**
> 我自己那份「正确答案」有三条是错的——**而如果解析器更严格一点、
> 当时又没逐条核对，这三条错会被当成对的钉下来。**
> 那比没有金标更糟：它会把错误答案保护起来，还每次给绿灯。

**第四次：「全过」不等于「都量过」。**

负向验证注入「删掉一条用例」时，检查**照样绿**（6 条全过，退出码 0）——
因为另有两条 `expectDirect` 为空的用例，删掉一条有内容的之后，
**7 个来源里有 1 个从未被检查**，而剩下的都真的对上了。

> 修法：来源登记表与金标**一一对应**。新登记来源却忘写用例，门禁立刻红。
> 扩展到 posts 之后这条断言立刻抓出 4 个新登记却没用例的来源——
> **它不是装饰，它在开工第一天就抓到了东西。**
