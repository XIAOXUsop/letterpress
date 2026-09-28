# 接一个新站点：用核心流程读自己的内容

**这份文档讲的是「不复制内部代码」怎么落地。**
路线图阶段 4 的第 1 条退出条件是「一个全新的真实内容集能在不复制内部代码的情况下使用核心流程」——
而本页所有数字都是**实测的**（`src/content/` 11 页，2026-09-28）。

## 五行主线

```js
import { readContentDirs } from '../src/lib/wiki/read-page.ts';
import { pageToDoc } from '../src/lib/wiki/page-to-doc.ts';
import { buildGraph } from '../src/lib/wiki/graph.ts';
import { lint, hasErrors } from '../src/lib/wiki/lint.ts';

const { pages } = readContentDirs(['content/wiki', 'content/posts']);  // ① 两个目录都要
const docs = pages.map((p) => pageToDoc(p));                           // ② 摘要已随页带回来
const graph = buildGraph(docs);                                        // ③ 链接图
const issues = lint(docs, graph);                                      // ④ 体检
if (hasErrors(issues)) throw new Error(JSON.stringify(issues));
```

**为什么是这四个模块、这个顺序**：前三个是纯逻辑、零耦合，第四个消费第三个的产物。
它们都能被**裸 Node** 直接 `import`（`npm run check:portability` 守着这条），
所以维护脚本、CLI、一次性分析都不必先跑 bundler。

⚠️ 下面第 ② 条讲的坑**曾经要写 12 行代码才能绕开**——
2026-09-28 已把 `summary` 收进 `readContentDirs`，所以第 ② 步现在只是 `pageToDoc(p)`。
保留那一节是因为**它解释了这个设计是怎么来的**，以及单个 `readContentPage` 仍然要自己补。

**为什么是这四个模块、这个顺序**：前三个是纯逻辑、零耦合，第四个消费第三个的产物。
它们都能被**裸 Node** 直接 `import`（`npm run check:portability` 守着这条），
所以维护脚本、CLI、一次性分析都不必先跑 bundler。

## 两个会咬人的地方

### ① 只读一个目录会报出一堆假断链

| 读法 | 页数 | 断链 | lint | `hasErrors` |
|---|---|---|---|---|
| **只读 `wiki`** | 6 | **3** | 4 条 | **`true`** |
| **`wiki` + `posts`** | 11 | **0** | 2 条 | `false` |

实测来源：`buildGraph` 收到的 `Doc` 少了一半，于是 `[[markdown-for-agents]]`
这种指向文章的链接**解析不到目标**——**报的不是「文章缺失」，是「断链」**。

> 症状具有欺骗性：它看起来像「我的内容里有坏链接」，
> 而真正的原因是**你只喂了一半语料进去**。
> 参见 `scripts/check-questions.mjs` 的注释：那里记着同一个坑的另一个后果
> ——「量着 A、跑着 B 的金标，绿灯是没有意义的」。

**所以：`readContentDirs` 的参数永远是全部内容目录，不是「知识页目录」。**

### ② `summary` 留空会让 lint 多报 6 条

同样的 6 篇 wiki，只改 `summary`：

| `summary` | lint 条数 |
|---|---|
| `''`（不传） | **10** |
| 从 frontmatter 读 | **4** |

⚠️ **单个 `readContentPage` 不返回 `summary`，而 `readContentDirs` 返回。**

- **`readContentDirs`（读一整个语料）**：`summary` 已经随页带回来了，
  `pageToDoc(p)` 不传任何选项就对。
- **`readContentPage`（读单个文件）**：拿 `p.summary` 会得到 `undefined`，
  而 `pageToDoc` 把它兜成 `''`——于是**空摘要**触发额外规则，
  症状是「核心好像坏了」（本表：lint 从 4 条涨到 10 条）。
  这种场景要自己补一次顶层读取：

```js
import { frontmatterField } from '../src/lib/wiki/frontmatter.ts';
import { readFileSync } from 'node:fs';

const summary = frontmatterField(readFileSync(file, 'utf8'), 'summary') ?? '';
```

⚠️ **自己遍历目录时最容易漏的是 `.sort()`**。漏了它，页面顺序取决于文件系统的
返回顺序——本机 NTFS 恰好已排序，**漏了也看不出**，直到换一台机器。
`readContentDirs` 里有那个 `.sort()`，自己写就没有。

**两个读取器，一个都不够**：`frontmatterField` 只认**顶层标量**（`title` / `summary`），
`readContentPage` 解析**嵌套块**（`review:` / `sources:` / `related:`）。
这个结论是实测来的，不是设计偏好——`scripts/wiki-review.mjs` 的注释记着
它第一版只用一个、在 `toLf(undefined)` 上崩掉的全过程。

## 站点专属的部分：两样，都是「站点事实」

上面四行里，**只有两样是站点专属的**：
**内容在哪个目录**、**关系字段叫什么**。
剩下的（slug 规则、摘要、`original`、字段名解析）核心都认。

关系字段名的传递方式（**2026-09-28 起是参数，不再是手写翻译**）：

```js
// 站点把关系声明叫 audience → 告诉核心字段叫什么
const { pages } = readContentDirs(['content/wiki', 'content/posts'], {
  relationField: 'audience',
});
const docs = pages.map((p) => pageToDoc(p));
```

**三条路径的行为不一样，实测（2026-09-28）：**

| 调用 | 那 9 篇里解析出关系的页数 |
|---|---|
| `readContentDirs([DIR])`（不传） | **0** |
| `readContentDirs([DIR], { relationField: 'audience' })` | **1** |
| `readContentPage(DIR, '数据留存.md')`（单读） | **0**（`related` 恒为 `[]`） |

⚠️ **`readContentPage` 不接受 `relationField`**——它一次只读一页，
而那个参数是 `readContentDirs` 的。要按自定义字段名读**单页**，
自己调 `relationList(source, 'audience')`（核心导出，剥方括号那套逻辑在里面）。

## 有了 `post` 与 `wiki` 之分时：告诉核心

有些站点分「文章」与「知识页」两类（Astro 那边叫 post / wiki）。
构建侧对文章一律丢掉知识层专属的四样：`related` / `review` / `original` / `wikiKind`
——**读路径必须同口径**，否则同一页在构建产物与 CLI 回答里形状不同。

```js
const { pages } = readContentDirs(['content/posts'], { docKind: 'post' });
const docs = pages.map((p) => pageToDoc(p));   // 这批页没有关系、没有 review、wikiKind 是 undefined
```

⚠️ **核心不会自己去猜**，而这是**故意的**：

- 本站 wiki 全写 `kind:` 而 posts 全不写（实测 6/6 vs 0/5），看起来足够判别；
- 但那是**本站的 schema 巧合**——`knowledge/fixtures/second-site/` 那 9 篇
  **也都写 `kind:`**，而它们所在的目录既不是 posts 也不是 wiki；
- 一个新站点若两个目录都写 `kind:`，核心就分不出来；
- 而**判错的后果是静默的**：文章被当成知识页时，关系照样连进图，
  而构建产物里没有——分歧回到上一节那个问题的起点。

不传 `docKind` 时默认 `'wiki'`（绝大多数内容是知识页）。
`npm run check:two-paths` 守着这个口径，**双向验证过**：构建侧的判定处数
与本节列的四项必须一一对应，多一处少一处都红。

## 剩下的核心模块

| 模块 | 干什么 | 接新站点时 |
|---|---|---|
| `retrieve.ts` | 检索打分 | `rank(passages, query, opts)`——**注意 `passages` 在前**，与 `computeImpact` 相反 |
| `context-pack.ts` | 检索结果 → 带元数据的材料包 | `buildContextPack(docs, question, opts)` |
| `impact.ts` | 来源变更的影响面 | `computeImpact(pages, sourceId)`——**签名与 `rank` 顺序相反** |
| `digest.ts` | 内容摘要（复核状态用） | `contentDigest(doc)`；口径见 `digestInput` |
| `slug.ts` | slug 规则 | `resolveSlug(title, explicit, fileStem)` |

⚠️ **两个 API 的参数顺序相反**（`rank(passages, query)` vs `computeImpact(pages, id)`）。
这不是笔误，是历史形成的；`check-second-site-real.mjs` 的注释记着我为此崩过一次
（`passages.map is not a function`）。

## 还没做到的

**这份文档描述的是「核心能吃下异构内容」，不是「接新站点不用改核心」。**

- fixture（`knowledge/fixtures/second-site/`）是**测试语料**，不是真的第二站点。
- 「减少重复维护」要有一个真站点用起来才知道——
  路线图阶段 4 第 4 条退出条件目前**未达成**，核对表在 `knowledge/gate-negatives.md`。

另外，`page-to-doc.ts` 曾长期**只有测试在引用**（2026-09-28 实测）。
为此 `check:portability` 加了第三条断言：**核心模块必须有真实调用方**。
> 抽公共函数不等于复用了它——**没人调用的公共函数只是一段没人验证的承诺**。

## 自己验一遍

```bash
node scripts/check-second-site-real.mjs   # 在异构语料上跑核心流程
node scripts/check-portability.mjs        # 核心模块能加载、有导出、有真实调用方
```
