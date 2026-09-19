// @ts-check
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import { unified } from '@astrojs/markdown-remark';
import { remarkWikilink } from './src/lib/wiki/remark-wikilink.ts';
import { rehypeTableWrap } from './src/lib/rehype-table-wrap.ts';
import { rehypeHeadingLinks } from './src/lib/rehype-heading-links.ts';

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
