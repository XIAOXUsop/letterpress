/**
 * 站点配置。
 *
 * ── 这是你唯一**必须**改的文件 ──────────────────────────────────────
 *
 * 改完 `site` / `author` / `nav` 三项就能上线。其余全部有可用的默认值，
 * 且默认值本身就是完整可用的站点——不是占位符。
 *
 * 想验证这一点：不动这个文件直接 `npm run build`，产出的站点是完整、
 * 可部署、有内容的（见 src/content/ 里的示例文章与知识库条目）。
 */

export interface NavItem {
  readonly label: string;
  readonly href: string;
}

export interface SiteConfig {
  /** 站点名。出现在页头、`<title>`、llms.txt 的 H1 */
  readonly title: string;
  /** 一句话定位。会出现在首页、RSS 描述、llms.txt 的 blockquote */
  readonly tagline: string;
  /**
   * 站点根地址，结尾**不带**斜杠。
   *
   * 留空字符串时所有链接退化为相对路径——本地预览没问题，
   * 但 RSS / sitemap / llms.txt 里的绝对地址会缺失。
   * 部署前请填成真实域名。
   */
  readonly url: string;
  /** 页面语言。**必须正确设置**，否则浏览器的中文标点挤压与断行规则不生效 */
  readonly lang: string;
  readonly author: {
    readonly name: string;
    readonly bio: string;
    /** 可选。留空则不渲染这一项 */
    readonly url?: string;
    readonly email?: string;
  };
  readonly nav: readonly NavItem[];
  readonly footer: {
    readonly text: string;
    /** 是否显示「由 letterpress 驱动」的署名 */
    readonly credit: boolean;
    /**
     * 署名链接的目标地址。
     *
     * **默认为空，此时只渲染文字、不渲染链接。**
     * 硬编码一个地址会在仓库还没发布时产出死链，而页脚的链接
     * 会跟着每一个使用者的站点扩散出去——宁可没有链接，
     * 也不要一个 404。
     *
     * 发布仓库后填成真实地址即可。
     */
    readonly repoUrl?: string;
  };
  /**
   * 知识层开关。
   *
   * 关闭后 wiki 目录不参与构建与 lint，站点退化为一个普通博客——
   * 这是给「我只想写文章，不想维护知识库」的人的出口。
   * **不是降级版本**，两条路线都是完整可用的。
   */
  readonly wiki: {
    readonly enabled: boolean;
    /** 知识层在导航里的名称。有人更喜欢叫「笔记」或「花园」 */
    readonly label: string;
    /** 是否对中文标题却未显式指定 slug 的文章给出提示 */
    readonly hintCjkSlugs: boolean;
  };
  /** 每次构建输出知识库体检报告 */
  readonly lint: {
    /** 有 error 级问题时是否让构建失败。CI 里应当开启 */
    readonly failOnError: boolean;
  };
  /** 列表每页显示多少条 */
  readonly pagination: {
    readonly postsPerPage: number;
  };
  /**
   * 搜索。
   *
   * 关闭后不生成搜索页与索引，导航里也不出现入口——
   * 而不是留一个点了 404 的链接。索引由构建后的 `pagefind` 步骤生成。
   */
  readonly search: {
    readonly enabled: boolean;
  };
}

export const site: SiteConfig = {
  title: '此间札记',
  tagline: '一个把排版当回事、同时写给人和 AI 读的博客。',

  url: 'https://xiaoxusop.github.io/letterpress',

  lang: 'zh-CN',

  author: {
    name: 'XIAOXUsop',
    bio: 'Java 后端开发，专注智能 Agent 应用工程化与自研工具。',
    url: 'https://github.com/XIAOXUsop',
  },

  nav: [
    { label: '文章', href: '/posts/' },
    { label: '知识库', href: '/wiki/' },
    { label: '归档', href: '/archive/' },
    { label: '关于', href: '/about/' },
  ],

  footer: {
    text: '写于此处，存于此处。',
    credit: true,
    repoUrl: 'https://github.com/XIAOXUsop/letterpress',
  },

  wiki: {
    enabled: true,
    label: '知识库',
    hintCjkSlugs: false,
  },

  lint: {
    failOnError: true,
  },

  pagination: {
    postsPerPage: 10,
  },

  search: {
    enabled: true,
  },
};

/** 供页面引用的派生值，避免各处重复拼字符串。 */
export const absoluteUrl = (path: string): string => {
  if (!site.url) return path;
  const base = site.url.replace(/\/$/, '');
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
};

/**
 * 出厂默认值。用来判断「用户还没改过」。
 *
 * 保留这些常量而不是到处硬编码字符串：判断逻辑与默认值必须同步，
 * 改了一处忘了另一处就会出现「明明配好了却还提示未配置」。
 */
const DEFAULTS = {
  authorName: '你的名字',
  authorUrl: 'https://github.com/your-name',
} as const;

/**
 * 站点是否还没配置。
 *
 * 关于页据此显示一份「还需要改什么」的清单，而不是把
 * 「一句话介绍自己」当成正经内容展示出来。
 *
 * 这比在 README 里写「记得改配置」有用得多——**用户不会在读 README 的时候
 * 顺手改配置，但一定会打开自己的关于页**。
 */
export function unconfiguredFields(): string[] {
  const missing: string[] = [];
  if (site.author.name === DEFAULTS.authorName) missing.push('site.author.name：你的名字');
  if (site.author.bio.trim() === '' || site.author.bio.includes('一句话介绍自己')) {
    missing.push('site.author.bio：一句话介绍你自己');
  }
  if (site.author.url === DEFAULTS.authorUrl) missing.push('site.author.url：你的主页');
  if (site.url === '') missing.push('site.url：你的域名（不填就没有 sitemap 与分享图）');
  if (site.title === '此间札记') missing.push('site.title：你的站名');
  return missing;
}
