# 接一个新站点：用核心流程读自己的内容

**这份文档讲的是「不复制内部代码」怎么落地。**
路线图阶段 4 的第 1 条退出条件是「一个全新的真实内容集能在不复制内部代码的情况下使用核心流程」——
而本页所有数字都是**实测的**（`src/content/` 11 页，2026-09-28）。

## 五行主线

```js
import { readContentPage } from '../src/lib/wiki/read-page.ts';
import { pageToDoc } from '../src/lib/wiki/page-to-doc.ts';
import { buildGraph } from '../src/lib/wiki/graph.ts';
import { lint, hasErrors } from '../src/lib/wiki/lint.ts';
import { frontmatterField } from '../src/lib/wiki/frontmatter.ts';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIRS = ['content/wiki', 'content/posts'];            // ① 两个目录都要
const docs = DIRS.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => /\.mdx?$/.test(f))
    .map((file) => {
      const full = join(dir, file);
      return pageToDoc(readContentPage(dir, file), {      // ② 组装成 Doc
        summary: frontmatterField(readFileSync(full, 'utf8'), 'summary') ?? '',
      });
    }),
);
const graph = buildGraph(docs);                             // ③ 链接图
const issues = lint(docs, graph);                           // ④ 体检
if (hasErrors(issues)) throw new Error(JSON.stringify(issues));
```

⚠️ 两个必须知道的形状（**实测**，2026-09-28）：

- **`readContentDirs` 不能用在这条主线上**。它返回 `{ pages, counts }`，
  而 `pages[i]` 的键只有
  `explicitSlug / slug / title / kind / updated / sources / review / related / body`
  ——**没有 `dir` / `file`，也没有 `summary`**。
  拿它读就凑不出 `summary`（见下面第 ② 条）。
  它的适用场景是**只要 `related:` 的消费者**，例如 `check-impact.mjs`。
- **`readContentPage` 也不返回 `summary`**，所以 `p.summary ?? ''` 恒等于 `''`。
  上面第 ② 步必须自己读一次 frontmatter。

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

⚠️ `readContentPage` **不返回 `summary`**（它服务检索，检索不需要摘要）。
拿 `p.summary` 会拿到 `undefined`——而 `pageToDoc` 把它兜成 `''`，
于是**空摘要**触发额外规则，而症状是「核心好像坏了」。

正确做法是补一次顶层读取：

```js
import { frontmatterField } from '../src/lib/wiki/frontmatter.ts';
import { readFileSync } from 'node:fs';

const summary = frontmatterField(readFileSync(file, 'utf8'), 'summary') ?? '';
```

**两个读取器，一个都不够**：`frontmatterField` 只认**顶层标量**（`title` / `summary`），
`readContentPage` 解析**嵌套块**（`review:` / `sources:` / `related:`）。
这个结论是实测来的，不是设计偏好——`scripts/wiki-review.mjs` 的注释记着
它第一版只用一个、在 `toLf(undefined)` 上崩掉的全过程。

## 站点专属的部分只有一处

上面五行里，**只有 `summary` 的来源与目录布局是站点专属的**。
剩下的（slug 规则、关系声明、字段名）核心都认。

唯一必须翻译的是**关系字段名**——本仓库叫 `related:`，别的站点可能叫 `audience:`：

```js
pageToDoc(page, { summary, relations: 翻译好的数组 })
```

不传 `relations` 时 `pageToDoc` 会退回 `page.related`，
而 `readContentPage` **只认 `related:` 这个名字**（实测：
`knowledge/fixtures/second-site/` 那 9 篇全部用 `audience:`，
`page.related` 在那里恒为 `[]`——**这个兜底分支只有用 `related:` 的站点才走得到**）。

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
