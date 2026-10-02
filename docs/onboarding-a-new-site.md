# 接入另一份内容集

核心读取、链接图和体检可以在 Node 中直接使用，不需要启动 Astro。需要 Node 22.18+ 的 22 LTS，或 Node 24+；依赖安装完成后，在项目根目录运行脚本。

## 读取与组装

以下示例假设脚本保存在 `scripts/`，两个内容目录已经存在。关系字段仍使用本站默认的 `related`。

```js
import { readContentDirs } from '../src/lib/wiki/read-page.ts';
import { pageToDoc } from '../src/lib/wiki/page-to-doc.ts';
import { buildGraph } from '../src/lib/wiki/graph.ts';
import { lint, hasErrors } from '../src/lib/wiki/lint.ts';

const wiki = readContentDirs(['content/wiki'], { docKind: 'wiki' });
const posts = readContentDirs(['content/posts'], { docKind: 'post' });
const docs = [...wiki.pages, ...posts.pages].map((page) => pageToDoc(page));
const graph = buildGraph(docs);
const issues = lint(docs, graph);
if (hasErrors(issues)) throw new Error(JSON.stringify(issues));
```

提供全部参与互链的内容目录，避免把缺少语料误判为断链。读取器递归扫描 `.md` 与 `.mdx`，按相对文件路径排序；返回的 `counts` 以目录为键，空目录的计数为 0。

读取器与 Astro 一样按 YAML 读取标量和结构字段。单页和目录读取均保留摘要、来源、复核状态、原创理由和草稿标记。无效 YAML、错误关系字段形状、无效复核状态或空原创理由会抛错。`pageToDoc` 默认沿用这些值，显式选项优先。

文章类型会排除知识页专属的关系、复核、原创理由和知识类型；来源引用仍保留。读取器不会根据目录名称推断文档类型，应由调用方传入 `docKind`。未传时，`pageToDoc` 为兼容旧调用默认采用 `wiki`。

## 自定义关系字段

另一站点若使用 `audience` 声明关系，只需提供字段名，无需复制解析逻辑：

```js
const { pages } = readContentDirs(['content/wiki'], {
  relationField: 'audience',
  docKind: 'wiki',
});
const docs = pages.map((page) => pageToDoc(page));
```

字段值应是字符串数组，支持 YAML 行内或多行数组。单页读取 `readContentPage(dir, file, options)` 也接受相同选项。此选项服务于源码读取工具；修改 Astro 站点的关系字段仍须同步调整内容 schema 和构建适配层。

## 验证

运行 `npm run verify:second-site-real` 与 `npm run verify:second-site-real-mutations`，可在仓库内的异构文件语料上验证读取、图、检索、来源影响与断链检查。

该语料是 fixture，不能代替真实站点上线验收。读取器不负责构建 HTML，也不解析 MDX 中的组件；稳定内容身份及机器发布接口仍由构建流程管理。
