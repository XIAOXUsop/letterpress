/**
 * `llms.txt` 与 `llms-full.txt` 生成。
 *
 * ── 先把话说清楚：这个东西的实际效果被严重高估了 ────────────────────
 *
 * 写这个模块之前查过证据，结论不好听但是必须说：
 *
 * - **Ahrefs 2026-05 实测 137,210 个域名：97% 的 llms.txt 从未被请求过。**
 *   剩下 3% 里 96% 是机器人噪声，真正来自 AI 检索爬虫的只占 **1.1%**。
 * - **Google 明确不支持**。Gary Illyes 2025-07 表态没有支持计划；
 *   2026-06 的 Search Central 指南写明不需要任何机器可读文本文件。
 * - 多个独立实验（OtterlyAI 90 天、Limy、Search Engine Land 9 站）
 *   都没测到可归因的效果。
 *
 * 那为什么还做？因为**它便宜且没有下行风险**，而且确实有一类读者：
 * Claude Code 抓取 llms.txt 的频率高于任何 AI 搜索机器人（AI agent 与基础设施
 * 占了 llms.txt 请求的 10.5%，是所有 AI 机器人类别里最高的）。
 * Chrome 的 Lighthouse 也在 2026-06 把 llms.txt 检查加进了 Agentic Browsing 审计。
 *
 * **所以本项目的立场是**：
 * - 默认生成，因为它零成本
 * - 但**不把它当卖点**，README 里如实标注上面那些数据
 * - 真正有效的是**内容协商**（见 negotiate/accept.ts）与**干净的语义化 HTML**，
 *   llms.txt 只是让 agent 少走一步
 *
 * 格式依据 llmstxt.org 提案。key 是「一家之言的小写纯文本约定」，
 * 不是 RFC——这也是它效果存疑的一部分原因。
 */

import type { Doc, LinkGraph } from './graph.js';
import { resolverFor, urlOf } from './graph.js';
import { renderWikiLinks } from './wikilink.js';

/**
 * 把正文里的 `[[…]]` 渲染成 markdown 链接——**与 HTML 页面走同一套解析**。
 *
 * <p>**这是补的，而且补得晚。** `.md` 孪生与 `llms-full.txt` 此前直接把 `doc.body`
 * 原样吐出去，于是机器出口里躺着未渲染的 `[[方括号]]`：
 *
 * <pre>
 *   grep -l "\[\[" dist/*.md dist/wiki/*.md   → 11 个文件全部命中
 *   llms-full.txt 里 36 处，wiki/letterpress.md 里 10 处
 * </pre>
 *
 * 而这两个出口的全部意义就是"给机器读的同一份内容"。对照：HTML 页面与 RSS
 * 里这些链接都是正常渲染的——缺口精确地只在这两条只做 `doc.body.trim()` 的路径上，
 * 所以它既不是"设计如此"、也不是"渲染没做"，是**这两条路径漏掉了那一步**。
 *
 * <p>解析不了的目标保持原样（`renderWikiLinks` 的行为）：断链在构建期就已经让构建
 * 失败了，走到这里说明是没被 lint 覆盖到的历史内容，原样留下比编一个链接诚实。
 */
function bodyRenderer(graph: LinkGraph | undefined, siteUrl: string | undefined) {
  if (!graph) {
    return (doc: Doc) => doc.body.trim();
  }
  const resolve = resolverFor(graph);
  const withSite = (target: string) => {
    const href = resolve(target);
    return href === null ? null : `${siteUrl ?? ''}${href}`;
  };
  return (doc: Doc) => renderWikiLinks(doc.body.trim(), withSite);
}

export interface LlmsOptions {
  readonly siteName: string;
  /** 站点根 URL，结尾不带斜杠 */
  readonly siteUrl?: string;
  /** 站点定位的一句话，会出现在 H1 下方的 blockquote 里 */
  readonly tagline: string;
  /**
   * 非显然的约束。这一段的目的是替 agent 省掉「自己踩一遍」的成本——
   * 比如「这里的内容是中文为主的」「草稿不会被构建」。
   */
  readonly notes?: readonly string[];

  /**
   * 链接图。给了就把正文里的 `[[…]]` 渲染成 markdown 链接；不给则原样保留。
   *
   * <p>可选是出于兼容：`llms.txt`（目录页）用不到它，而测试 fixture 也不必都建图。
   * 但**线上那两条出口都应该传**——不传的后果是 AI 读到的正文里带 `[[方括号]]`。
   */
  readonly graph?: LinkGraph;
}

/** 一行条目：`- [标题](URL): 一句话说明` */
function entry(doc: Doc, siteUrl: string | undefined): string {
  const href = siteUrl ? `${siteUrl}${urlOf(doc)}` : urlOf(doc);
  // 摘要为空时不能省掉冒号——格式要求每行都有说明，
  // 缺了会让解析器把这一行当成纯链接，与「我们刻意要求摘要」的 lint 相呼应
  return `- [${doc.title}](${href}): ${doc.summary || '（暂无摘要）'}`;
}

function section(heading: string, docs: readonly Doc[], siteUrl: string | undefined): string[] {
  if (docs.length === 0) return [];
  return [`## ${heading}`, '', ...docs.map((d) => entry(d, siteUrl)), ''];
}

/** 按日期倒序（新的在前）。没有日期字段，用 slug 稳定排序兜底。 */
function bySlug(a: Doc, b: Doc): number {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/**
 * 生成 `llms.txt`——给 agent 看的目录。
 *
 * 刻意不按日期排，而按「先看什么」排：知识层在前，文章在后。
 * 目录的用处是**路由**，不是归档；按时间倒序会让 agent 先读到最新的一篇，
 * 而那未必是最能代表这个站的。
 */
export function buildLlmsTxt(docs: readonly Doc[], options: LlmsOptions): string {
  const published = docs.filter((d) => !d.draft);
  const core = published.filter((d) => d.kind === 'wiki').sort(bySlug);
  const posts = published.filter((d) => d.kind === 'post').sort(bySlug);

  const lines: string[] = [
    `# ${options.siteName}`,
    '',
    `> ${options.tagline}`,
    '',
  ];

  if (options.notes && options.notes.length > 0) {
    for (const note of options.notes) lines.push(note, '');
  }

  lines.push(...section('知识层', core, options.siteUrl));
  lines.push(...section('文章', posts, options.siteUrl));

  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * 生成 `llms-full.txt`——把全部内容内联成一份自包含文档。
 *
 * 与 `llms.txt` 的分工：前者是目录（让 agent 决定读什么），
 * 后者是全文（让 agent 一次拿完，不用遍历）。按 llmstxt.org 的约定，
 * 每篇用 `<doc>` 标签包起来并保留路径，这样 agent 引用时能说清出处。
 */
export function buildLlmsFullTxt(docs: readonly Doc[], options: LlmsOptions): string {
  const published = docs.filter((d) => !d.draft);
  const core = published.filter((d) => d.kind === 'wiki').sort(bySlug);
  const posts = published.filter((d) => d.kind === 'post').sort(bySlug);

  const lines: string[] = [
    `# ${options.siteName}`,
    '',
    `> ${options.tagline}`,
    '',
  ];

  if (options.notes && options.notes.length > 0) {
    for (const note of options.notes) lines.push(note, '');
  }

  const render = bodyRenderer(options.graph, options.siteUrl);

  for (const doc of [...core, ...posts]) {
    const path = urlOf(doc).replace(/^\//, '').replace(/\/$/, '');
    lines.push(`<doc title="${escapeAttr(doc.title)}" path="${escapeAttr(`${path}.md`)}">`);
    lines.push('');
    if (doc.summary) {
      lines.push(`> ${doc.summary}`, '');
    }
    lines.push(render(doc));
    lines.push('');
    lines.push('</doc>');
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 生成 `.md` 孪生文件的内容。
 *
 * 这是内容协商真正要端出去的东西，所以格式上按「agent 一次读完就够用」来组织：
 * frontmatter 换成一段人可读的元信息（YAML 对模型是噪声），
 * 正文保持 markdown 原样。
 */
export function buildMarkdownTwin(
  doc: Doc,
  graph: LinkGraph,
  options: { siteUrl?: string; lang?: string },
): string {
  const lines: string[] = [];

  lines.push(`# ${doc.title}`, '');
  if (doc.summary) lines.push(`> ${doc.summary}`, '');

  const url = options.siteUrl ? `${options.siteUrl}${urlOf(doc)}` : urlOf(doc);
  lines.push(`来源：${url}`);
  if (options.lang) lines.push(`语言：${options.lang}`);
  lines.push(`类型：${doc.kind === 'wiki' ? '知识库条目' : '文章'}`);
  lines.push('');

  const backlinks = graph.backlinks.get(doc.slug) ?? [];
  if (backlinks.length > 0) {
    lines.push('## 被引用', '');
    for (const link of backlinks) {
      const target = graph.bySlug.get(link.fromSlug);
      const href = options.siteUrl && target ? `${options.siteUrl}${urlOf(target)}` : urlOf(target ?? doc);
      lines.push(`- [${link.fromTitle}](${href})`);
    }
    lines.push('');
  }

  lines.push('## 正文', '');
  // 与 HTML 页面同一套解析——`.md` 孪生是"给机器读的同一份内容"，
  // 里面不该出现未渲染的 `[[方括号]]`（此前正是如此，11 个孪生文件全部命中）。
  lines.push(bodyRenderer(graph, options.siteUrl)(doc));
  lines.push('');

  return lines.join('\n');
}

/**
 * 统计信息，给构建报告用。
 *
 * 存在的理由：知识库「有没有在长」是件需要被看见的事。
 * 只看文件数不够——链接数才是连接度的指标。
 */
export interface KnowledgeStats {
  readonly posts: number;
  readonly wikiPages: number;
  readonly links: number;
  readonly orphans: number;
  readonly broken: number;
  /** 平均每页出链数。低于 1 通常意味着「写了但从没连起来」 */
  readonly avgOutbound: number;
}

export function stats(docs: readonly Doc[], graph: LinkGraph): KnowledgeStats {
  const published = docs.filter((d) => !d.draft);
  const linkCount = [...graph.outbound.values()].reduce((sum, set) => sum + set.size, 0);

  return {
    posts: published.filter((d) => d.kind === 'post').length,
    wikiPages: published.filter((d) => d.kind === 'wiki').length,
    links: linkCount,
    orphans: graph.orphans.length,
    broken: graph.broken.length,
    avgOutbound: published.length === 0 ? 0 : Math.round((linkCount / published.length) * 100) / 100,
  };
}
