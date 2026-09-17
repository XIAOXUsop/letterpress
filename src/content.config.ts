/**
 * 内容集合定义。
 *
 * Astro 6 起内容层是强制的，配置文件路径固定为 `src/content.config.ts`
 * （旧的 `src/content/config.ts` 已被移除）。
 *
 * ── 为什么 frontmatter 校验写这么严 ──────────────────────────────────
 *
 * 因为这是**唯一能在写作时就拦住错误的地方**。等到构建产物里出现一个
 * 空标题、缺日期的条目，你会先看到版式塌了才去翻 frontmatter。
 * 这里让 schema 直接报错，并写清期望。
 */

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * 文章。
 *
 * 放在 `src/content/posts/` 下的 `.md` / `.mdx` 都会成为一篇文章。
 * 文件名不决定 URL——URL 由 frontmatter 的 `slug` 或标题推导（见 lib/wiki/slug.ts）。
 */
const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    title: z.string().min(1, '标题不能为空'),
    /**
     * 一句话摘要。
     *
     * **不是可选项**：它同时是 llms.txt 里那一行的说明、页面的 meta description、
     * 以及列表页的摘要。缺了它，agent 只能靠标题猜这一页讲什么。
     */
    summary: z.string().min(1, '摘要不能为空——它是 llms.txt 里那一行的说明'),
    date: z.coerce.date(),
    /** 最后修改时间。可选，但填了会让 RSS 与 sitemap 更准确 */
    updated: z.coerce.date().optional(),
    /** 显式指定 URL 片段。中文标题留空会自动生成中文 URL（合法，但复制出去很长） */
    slug: z.string().optional(),
    /**
     * 是否草稿。
     *
     * **这个字段必须有，不能靠 `content.ts` 里那个 `?? false` 兜底。**
     * Zod 会把 schema 未声明的键**静默剥离**——`draft ?? false` 拿到的永远是
     * false，`draft: true` 的文章在生产构建里照常发到全部出口
     * （页面、.md、og、llms.txt、rss、sitemap、列表——实测 9/9 泄漏），而
     * AGENTS.md 明确承诺了「草稿不进构建」。修之前踩的正是「写好的过滤逻辑
     * 上游被 schema 掐掉」这条链。
     */
    draft: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
    /**
     * 封面图路径，相对 `public/`，例如 `/covers/my-post.svg`。
     *
     * **不填也好看**：留空时会由标题与 slug 确定性地生成一张几何封面
     * （见 `src/lib/cover.ts`）。这样零配置的站点也有视觉层次，
     * 而不是一列纯文字——同时保留了想用真实配图的出口。
     */
    cover: z.string().optional(),
    /** 封面图的替代文本。有 `cover` 时就该填，否则读屏用户只听到「图片」 */
    coverAlt: z.string().optional(),
    /**
     * 分享图，用于 og:image。
     *
     * **不填也有**：会由 slug 确定性地生成一张 1200×630 的 PNG
     * （见 `src/lib/og.ts`）。填了就用你的——注意社交平台
     * **不接受 SVG**，必须是 PNG 或 JPG。
     */
    ogImage: z.string().optional(),
    /** 置顶。首页会优先展示，列表页也会排在最前 */
    featured: z.boolean().default(false),
    /**
     * 是否在文章页显示目录。
     *
     * 默认 `true`，但只在正文有 3 个以上二级标题时才真的渲染——
     * 两三个小节的短文加目录反而增加噪声。
     */
    toc: z.boolean().default(true),
  }),
});

/**
 * 知识层条目。
 *
 * 与文章的区别不是格式，是**组织方式**：文章按时间排，知识层按主题互链。
 * 两者都可以被 `[[wiki-link]]` 引用，在链接图里地位相同。
 */
const wiki = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/wiki' }),
  schema: z.object({
    title: z.string().min(1, '标题不能为空'),
    summary: z.string().min(1, '摘要不能为空——agent 靠它决定要不要读这一页'),
    /**
     * 条目类型。只影响展示与分组，不影响链接解析。
     * - concept：概念、方法、模式
     * - entity：具体的人、工具、项目
     * - synthesis：跨条的综合性结论
     */
    kind: z.enum(['concept', 'entity', 'synthesis']).default('concept'),
    /** 相关条目。等价于在正文里写 [[...]]，但更显式，且不要求正文出现 */
    related: z.array(z.string()).default([]),
    updated: z.coerce.date().optional(),
    slug: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts, wiki };
