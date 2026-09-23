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

### 规范与字体清单（都由 cjk-typography 引用）

source: css-values-4
expectDirect: cjk-typography
expectCandidates: design-tokens

source: css-fonts-4
expectDirect: cjk-typography
expectCandidates: design-tokens

source: apple-system-fonts
expectDirect: cjk-typography
expectCandidates: design-tokens

> 三个的 ② 都是 `design-tokens`，因为 `cjk-typography` 的
> `related: [cjk-web-typography, design-tokens]` 里有它。
> `cjk-web-typography` 是 **post**，不在 wiki 图里，所以**不算候选**。

### 内容协商

source: rfc9110-accept
expectDirect: content-negotiation
expectCandidates: letterpress、llm-wiki

> `content-negotiation` 的 `related: [markdown-for-agents, llm-wiki]`
> 里 `markdown-for-agents` 是 post（不在图里），`llm-wiki` 在。
> 而 `letterpress` 的 `related` 里有 `content-negotiation`，反向命中。
> **两个方向都要算**——只算一个方向会漏掉 `letterpress`。

### LLM 知识库

source: llm-wiki-gist
expectDirect: llm-wiki
expectCandidates: content-negotiation、letterpress

> 这条是 2026-09-24 补登记后新增的：`llm-wiki.md` 此前**没有 `sources` 块**，
> 尽管正文明确引用了这个 gist、而且「10–15 页」那句刚刚做完逐字勘误。
> **页面引用了来源却没登记**，属于本该被抓到而没抓到的一类。

---

## 登记了但还没有 wiki 页引用的来源

**这些必须显式写出来，且期望是空集。**

期望为空有两种完全不同的含义，混在一起就看不出是哪一种：

- 「**真的**没人引用」——如实记录；
- 「**本该**有人引用但漏了」——需要补。

所以下面每条都注明了属于哪一种。

source: google-ai-features
expectDirect:
expectCandidates:

> 引用它的 `markdown-for-agents.md` 是 **post**，不在 wiki 图里。
> 属于「真的没人（在本图范围内）引用」。等 posts 参与来源模型后要更新。

source: ahrefs-llmstxt-study
expectDirect:
expectCandidates:

> 同上：引用方是 post。属于「真的没人引用」。
> 这条是 2026-09-24 新登记的，`wiki:impact` 对它报「直接引用者 0」——
> 那个 0 是**正确**的，不是漏报。

---

## 写这份金标时踩到的坑（留给下一个人）

**第一版解析器太宽松，把散文当成了用例。**

我最初的正则允许三个字段之间隔着任意内容，于是这一段散文：

```
> `css-values-4` 目前只有 `cjk-typography` 一页引用它（两条：`ch` 与 `ic`）。
```

后面的 `### source: apple-system-fonts` 之类全被吞进用例里，
报出「金标里点名了这个来源，但没登记」——**而那句话根本不是用例**。

**更糟的是：我第一版的期望值是凭印象编的。**
`rfc9110-accept` 我写了候选为空，实际是 `letterpress、llm-wiki` 两个；
`css-values-4` 我写了候选为空，实际有 `design-tokens`。

> **写金标第一条规则：期望值必须从实际运行结果导出，不能凭印象写。**
> 我自己写的那份「正确答案」有三条是错的——**而如果解析器更严格一点、
> 当时又没逐条核对，这三条错会被当成对的钉下来。**
> 那比没有金标更糟：它会把错误答案保护起来。
