# 命令行

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（草稿可见） |
| `npm run build` | 构建 + Pagefind 索引（含体检，有错误会中止） |
| `npm test` | **246 项**单元测试，全部离线 |
| `npm run verify` | 端到端：对着**真实构建产物**验证 177 项契约（条数由脚本自己打印） |
| `npm run verify:base` | 子路径部署检查（属性 / 脚本 / 绝对 URL / 纯文本产物 / 内容清单） |
| `npm run verify:formats` | 内容发布探针：真的放入 `.md`、`.mdx`、草稿和占用 `/about/` 的文章，验证格式产出、草稿隔离与系统路由冲突 |
| `npm run verify:search` | 搜索可用性：页面语言一致性、索引语言、索引覆盖面。**不查结果**——查询行为只能在浏览器里测，原因见脚本注释 |
| `npm run verify:reproducible` | 扫描生产源码的构建时钟读取，并在 UTC / America/Los_Angeles 做完整构建、逐文件比较 SHA-256；覆盖 Astro 产物与 Pagefind 索引 |
| `npm run verify:online` | **线上烟测**：只打线上地址，验内容协商与内容清单真的生效。需要 `SITE_ORIGIN`，没配就直接失败（不退回本地） |
| `npm run verify:all` | 七道依次跑一遍（`check` + `test` + `verify` + `verify:search` + `verify:reproducible` + `verify:base` + `verify:formats`），**不含** `verify:online` |
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
