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
}

export const site: SiteConfig = {
  title: '此间札记',
  tagline: '一个把排版当回事、同时写给人和 AI 读的博客。',

  url: '',

  lang: 'zh-CN',

  author: {
    name: '你的名字',
    bio: '一句话介绍自己。这句话会出现在关于页和页脚。',
    url: 'https://github.com/your-name',
  },

  nav: [
    { label: '文章', href: '/posts/' },
    { label: '知识库', href: '/wiki/' },
    { label: '关于', href: '/about/' },
  ],

  footer: {
    text: '写于此处，存于此处。',
    credit: true,
  },

  wiki: {
    enabled: true,
    label: '知识库',
    hintCjkSlugs: false,
  },

  lint: {
    failOnError: true,
  },
};

/** 供页面引用的派生值，避免各处重复拼字符串。 */
export const absoluteUrl = (path: string): string => {
  if (!site.url) return path;
  const base = site.url.replace(/\/$/, '');
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
};
