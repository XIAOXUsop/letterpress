// @ts-check
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import { unified } from '@astrojs/markdown-remark';
import { remarkWikilink } from './src/lib/wiki/remark-wikilink.ts';
// 直接从它所在的模块拿——remark-wikilink 只是**导入**它，没有**再导出**，
// 从那里拿会得到 undefined，而报错是 'not a function'，看不出是 import 错了。
import { collectFrontmatterProblems } from './src/lib/wiki/frontmatter.ts';
import { checkVerifyClaims, formatVerifyProblems } from './src/lib/wiki/verify-run.ts';
import { rehypeTableWrap } from './src/lib/rehype-table-wrap.ts';
import { rehypeHeadingLinks } from './src/lib/rehype-heading-links.ts';

/**
 * ── frontmatter 写法校验：必须在**这里**，不能放在 remark 插件里 ──────────
 *
 * `remark-wikilink.ts` 有一个手写的 frontmatter 取值函数（刻意不实现完整
 * YAML）。它支持的子集是写死的，越界会抛——但**在 remark 管道里抛错，
 * Astro 不会让构建失败**。
 *
 * 实测（2026-09-23，清掉内容层缓存后注入一个 `title: >`）：
 *
 *     错误打印 22 次
 *     [ERROR] Failed to parse Markdown file "…cjk-web-typography.md"
 *     wiki 页里的链接从 4 条掉到 3 条     ← 页面真的退化了
 *     Build exit code: 0                  ← 而构建自称成功
 *
 * 那比原来的"链接静默指错"更糟。所以挪到配置加载期：
 * 这时什么都还没渲染，抛出去就是整个构建失败、原因一眼可见。
 */
const frontmatterProblems = collectFrontmatterProblems(join(process.cwd(), 'src', 'content'));
if (frontmatterProblems.length > 0) {
  throw new Error(
    `有 ${frontmatterProblems.length} 处 frontmatter 用了 [[链接]] 查找表不支持的写法：\n\n` +
      frontmatterProblems.map((p) => `  ✗ ${p}`).join('\n\n') +
      `\n\n这些字段只支持 \`字段: 单行值\`（可整体加引号，不含转义）。\n` +
      `块标量（| / >）、值写到下一行、行尾注释都不支持——\n` +
      `原因与取舍见 src/lib/wiki/remark-wikilink.ts 里 frontmatterField 的注释。`,
  );
}

/**
 * ── 可证伪声明（`verify:`）的核对：同样必须在**加载期** ──────────────
 *
 * 这一条检查的是**页与仓库之间**的事实：页面说「X 已实现」，
 * 而 X 对应的文件在不在。
 *
 * 它存在的原因是一次实测：`llm-wiki.md` 的「已实现 / 计划实现」表里，
 * **三行写着「计划中，尚未实现」，而它们全都已经落地**。
 * 没有任何东西会发现——lint 管的是断链、重复 slug、孤儿页，
 * 那些都是页与页之间的问题。
 *
 * 放在这里而不是 remark 管道里，理由与上面那条完全一样：
 * **在 remark 里抛错，Astro 不会让构建失败**（实测：错误打印 22 次、
 * 页面退化、而 `Build exit code: 0`）。
 */
const verifyResults = checkVerifyClaims(join(process.cwd(), 'src', 'content'));
const verifyProblems = formatVerifyProblems(verifyResults);
if (verifyProblems.length > 0) {
  throw new Error(
    `有 ${verifyProblems.length} 处可证伪声明对不上（页面说的与仓库里的不一致）：\n\n` +
      verifyProblems.map((p) => `  ✗ ${p}`).join('\n\n') +
      `\n\n每条声明都查两件事：那句话**还在不在页面上**、以及它对应的**文件在不在**。\n` +
      `只查文件是不够的——正文改了、声明没改时，声明就在验一句没人说过的话。\n` +
      `声明写在知识页的 frontmatter 里，格式见 src/lib/wiki/verify.ts 开头。`,
  );
}
const claimCount = verifyResults.reduce((n, r) => n + r.problems.length, 0) === 0
  ? verifyResults.length
  : 0;
if (claimCount > 0) {
  console.log(`✓ ${claimCount} 个知识页的可证伪声明全部成立`);
}

/**
 * 站点根地址从 `src/config.ts` 读——那里是用户唯一要改的文件，
 * 不该再让他们到这里改第二遍。
 *
 * 用正则做一次最小提取而不是 import：配置文件是 TS，astro.config 在
 * 加载阶段还没有 TS 转译。提取失败时退回空串，构建照常进行
 * （只是 RSS / sitemap 里没有绝对地址）。
 */
function readSiteUrl() {
  try {
    const source = readFileSync(new URL('./src/config.ts', import.meta.url), 'utf8');
    const match = /^\s*url:\s*['"]([^'"]*)['"]/m.exec(source);
    return (match?.[1] ?? '').replace(/\/$/, '');
  } catch {
    return '';
  }
}

const siteUrl = readSiteUrl();

/**
 * 部署子路径。默认 `/`（域名根）。
 *
 * 什么时候需要改：**GitHub Pages 的项目站**地址是
 * `https://<用户名>.github.io/<仓库名>/`，这时候 base 必须是 `/仓库名`。
 *
 * 用环境变量而不是写死在配置里，是为了让同一份代码既能部署到根
 * 也能部署到子路径——构建命令前加 `SITE_BASE=/仓库名` 即可。
 *
 * **这个坑在本地看不出来**：`npm run dev` 的 base 是 `/`，前缀为空，
 * 一切正常；只有真正部署到子路径时，所有没加前缀的链接才会一起失效。
 * 所以 `npm run verify` 里有一条断言专门扫产物里的绝对路径。
 */
const base = process.env.SITE_BASE || '/';

export default defineConfig({
  base,
  // site 为空时 Astro 会警告；这是合法的初始状态（还没部署），
  // 所以显式允许，而不是让用户在第一次 build 时就被警告吓到。
  site: siteUrl || undefined,

  // 纯静态输出。这是本项目全部「开箱即用」叙事的前提：
  // 静态产物可以部署到任何地方，不需要常驻进程、数据库或环境变量。
  output: 'static',

  build: {
    // 每个页面输出到独立目录下的 index.html，URL 结尾带斜杠。
    // 这样静态托管不需要任何重写规则就能正确处理 /foo → /foo/index.html。
    format: 'directory',
  },

  integrations: [
    /*
     * ── MDX 必须在这里注册，否则它是「假的」────────────────────────
     *
     * `@astrojs/mdx` 装了、`content.config.ts` 的 glob 也匹配 `.mdx`，
     * 但**不注册到 integrations 就完全没用**：放进一个 `.mdx` 文件，
     * 构建成功、退出码 0，而文章在 dist 里根本不存在、首页也不列。
     *
     * 这正是本项目反复强调的那类 bug——**不报错，只是没效果**。
     * `npm run verify` 里加了一条断言：放一个 `.mdx` 必须能产出页面。
     */
    mdx(),
    /**
     * 只在配了站点地址时才启用 sitemap。
     *
     * sitemap 的内容是一堆绝对 URL，没有 site 就生成不了——插件会打印
     * 「Skipping」警告。而 `url: ''` 是本模板的**出厂状态**（用户还没部署），
     * 于是每次构建都抱怨一次。零配置必须安静地工作，所以这里按需挂载。
     */
    ...(siteUrl
      ? [
          sitemap({
            // 草稿不该出现在 sitemap 里
            filter: (page) => !page.includes('/draft/'),
          }),
        ]
      : []),
  ],

  markdown: {
    /**
     * ── 这一行是踩坑换来的，别改回去 ────────────────────────────────
     *
     * Astro 7 把默认的 Markdown 处理器换成了 Sätteri，remark 通道变成**可选**。
     * 于是 `markdown.remarkPlugins` 这个老写法**会被接受但不会执行**——
     * 构建时只打印一条弃用警告，没有任何地方告诉你「你的插件根本没跑」。
     *
     * 实测后果：所有 `[[wiki-link]]` 原样留在正文里，页面上直接显示方括号，
     * 而构建、测试、lint **全部通过**。这条链接是项目第二阶段的核心功能，
     * 却静默失效了。
     *
     * 正确写法是 `markdown.processor: unified({ ... })`。
     * 这与本项目反复强调的那类 bug 是同一个：**不报错，只是没效果**。
     */
    /*
     * 注意这里传的是 `remarkWikilink` **本身**，不是 `remarkWikilink()`。
     *
     * unified 的 `.use()` 要的是工厂函数（attacher），由它调用后拿到真正的
     * transformer。传 `remarkWikilink()` 的结果进去，unified 就会拿处理器对象
     * 当语法树传给 transformer，抛出一个 `Cannot use 'in' operator ...` ——
     * 而那个报错里一个字都不会提到 unified，极难反推。
     */
    processor: unified({
      remarkPlugins: [[remarkWikilink, { base }]],
      /*
       * 宽表格必须包一层可滚动容器，否则在窄屏上会把整页撑出横向滚动条。
       * 实测：一张三列对照表在 375px 视口下宽 383px。
       * 详见 rehype-table-wrap.ts 里关于「为什么不直接用 CSS」的说明。
       */
      rehypePlugins: [rehypeTableWrap, rehypeHeadingLinks],
    }),
    shikiConfig: {
      // 双主题：Shiki 会输出 CSS 变量，由页面样式决定用哪套。
      // 单一主题在暗色模式下会出现「亮底代码块嵌在暗色页面里」。
      themes: { light: 'github-light', dark: 'github-dark-dimmed' },
      wrap: false,
    },
  },

  // 构建时不要把样式内联进 HTML——外链 CSS 能被缓存，
  // 而且内容协商返回 markdown 时不会被这些内联样式污染。
  vite: {
    build: {
      cssCodeSplit: false,
    },
  },
});
