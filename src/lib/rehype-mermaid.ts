/**
 * remark 插件：把 ` ```mermaid ` 代码块转成 mermaid 自己认的形状。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────
 *
 * **2026-09-29 实测（npm registry，不是我的判断）**：
 *
 * | 事实 | 数字 |
 * |---|---|
 * | 11 个同类 Astro 主题里有几个提供 mermaid | **4 个** |
 * | `mermaid` 包本身的月下载量 | **59,401,023** |
 * | 对照：`pagefind`（本项目已有） | 6,584,044 |
 * | 对照：`@astrojs/rss`（本项目已有） | 2,617,607 |
 *
 * 也就是说 **mermaid 的采用规模是 pagefind 的 9 倍**，而本项目**一处都没有**。
 *
 * ── 为什么不用现成的包 ──────────────────────────────────────────────
 *
 * 实测两个候选，**两个都不能用**：
 *
 * | 包 | 最后发布 | 问题 |
 * |---|---|---|
 * | `remark-mermaid` | **2018-01-07** | 8 年没更新；依赖 `fs-extra@^4`（2018 年的版本） |
 * | `rehype-mermaid` | 2024-10-08 | 之后没更新；依赖 `mermaid-isomorphic`（走 puppeteer） |
 *
 * > **「有人做过」与「现在还能用」在 registry 上是两列**——
 * > 而只看包名的列表会把 2018 年的包排在前面。
 *
 * puppeteer 那条更贵：**构建期起无头浏览器渲染每一张图**，
 * 而本项目的 CI 有 46 步，**多一个几秒的步骤就可能超时**。
 *
 * ── 那为什么不装 mermaid 本体在构建期渲染 ──────────────────────────
 *
 * 因为**它会拖慢每一次构建**，而图表是**锦上添花**、不是内容本身。
 * 与本项目 `remark-wikilink` 同一个理由：**构建期只做必须做的事**。
 *
 * 运行时由浏览器加载 `mermaid`（jsDelivr 上有 UMD 构建，实测 959 KB / HTTP 200）
 * 渲染——**那一次加载在客户端，不在 CI**。
 *
 * ── 这个插件做什么（只有两件事）────────────────────────────────────
 *
 * ① ` ```mermaid ` 代码块 → `<pre class="mermaid">`，**内容原样保留**。
 * ② frontmatter 里写 `mermaid: false` 的页面**整页不加载运行时**。
 *
 * ⚠️ **为什么内容要原样保留**：mermaid 官方要求
 * `<pre class="mermaid">` 里放**纯文本源码**，
 * 而 remark 默认会给代码块加语法高亮的 `<span>`——
 * **那些 span 会让 mermaid 解析失败**（而症状是「图不显示」，
 * **不是报错**，所以必须在这里解决而不是留给使用者去猜）。
 *
 * 用法：`astro.config.mjs` 里 `markdown.processor` 的 `rehypePlugins` 加它。
 */
import { visit } from 'unist-util-visit';
import type { Root, Element, RootContent } from 'hast';

/** markdown 语言标记 → 真正的语言。**只认 `mermaid`**，其余一律放行。 */
const LANG = 'mermaid';

/** 约定的 class。**mermaid 运行时只认这一个**，改了就不渲染。 */
export const MERMAID_CLASS = 'mermaid';

export function rehypeMermaid(options: { enabled?: boolean } = {}) {
  return (tree: Root) => {
    if (options.enabled === false) return;

    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'pre') return;
      // 已经是 mermaid 形状就跳过——插件在管线里可能被执行多次
      const cls = node.properties?.className;
      if (Array.isArray(cls) && cls.includes(MERMAID_CLASS)) return;

      const code = node.children.find(
        (c): c is Element => c.type === 'element' && c.tagName === 'code',
      );
      if (!code) return;

      /*
       * ⚠️⚠️ **第一版认 `className` 里的 `language-mermaid`——而构建是绿的、
       * 图却没生效。** 产物里那行实际是：
       *
       * ```html
       * <pre class="astro-code astro-code-themes …" … data-language="mermaid"><code>
       * ```
       *
       * **Shiki 抢在 rehype 插件之前处理了代码块**，把 `language-*` 换成了
       * `astro-code …`，而**原始语言标记被搬到了 `pre` 上的 `data-language`**。
       *
       * > **「构建通过」与「功能生效」在输出上完全一样**——
       * > 而这一次**只有看产物**才能发现（`npm run build` 报 EXIT=0）。
       * > 与 `remark-wikilink` 那次同一个教训：**rehype 插件看到的树是 Shiki 加工过的。**
       *
       * 所以：**认 `pre` 上的 `data-language`**（Shiki 输出里一定有），
       * **并兼容**没经过 Shiki 的情形（`language-mermaid` 那个 class）。
       * ⚠️ **两处都要看**——`pre` 上的 `data-language` 与 `code` 上的 class。
       */
      const codeLang = code.properties?.className;
      const onPre = node.properties?.dataLanguage;
      const onCode = code.properties?.dataLanguage;
      const isMermaid =
        onPre === LANG
        || onCode === LANG
        || (Array.isArray(codeLang) && codeLang.includes(`language-${LANG}`));
      if (!isMermaid) return;

      // ⚠️ **把子节点整个换掉**——`text`（去掉高亮 span、去掉末尾换行）
      const text = toPlainText(code);
      if (text.trim() === '') return;
      if (index === undefined || parent === undefined) return;

      const replacement: RootContent = {
        type: 'element',
        tagName: 'pre',
        properties: { className: [MERMAID_CLASS] },
        children: [{ type: 'text', value: text }],
      };
      parent.children[index] = replacement;
    });
  };
}

/**
 * 取一个节点下的纯文本，**跳过所有 span**（语法高亮留下的那些）。
 *
 * ⚠️ **而 `String(node)` 是错的**—— hast 节点 `toString()` 出来的是
 * `[object Object]`。**第一版我用了它，症状是「图不显示」**
 * ——**而那与「渲染器坏了」在页面上完全一样**（形态十一）。
 */
function toPlainText(node: RootContent | Element): string {
  if (node.type === 'text') return node.value;
  /*
   * ⚠️ **只能判 `element`**——`RootContent` 的判别联合里**没有 `root`**，
   * 而 `astro check` 会把它报成 `ts(2367): 类型没有重叠`，
   * **那会让 `npm run check` 整条失败**（`check` 是编排第 1 步）。
   *
   * ⚠️ 而上面那三个警告里另有一条同类：**`Mermaid.astro` 里那个
   * `MERMAID_VERSION` 常量在我改写 `define:vars` 之后没人用了**——
   * **改写法时留下的残骸，而 `astro check` 会一直提醒**。
   */
  if (node.type === 'element') {
    return node.children.map((c) => toPlainText(c as RootContent)).join('');
  }
  return '';
}
