/**
 * rehype 插件：给正文里的二、三级标题追加永久链接。
 *
 * Markdown 渲染器本来就会给标题生成稳定 `id`，目录也会使用它，但没有目录的
 * 短文以及想引用三级标题的读者看不到这个能力。追加一个普通 `<a href="#id">`
 * 就能让鼠标、键盘和长按菜单都获得小节链接，而且完全不需要运行时 JavaScript。
 *
 * Astro 7 的自定义 rehype 插件运行在内置标题 id 插件之前，所以这里必须在追加链接
 * 的同时写入 id。算法不自造：使用 Astro 同源的 `github-slugger`，并直接读取已经
 * 渲染好的 HAST 文本，重复标题、中文与行内代码因而和最终 HTML 使用同一份结果。
 */

import type { Element, Root } from 'hast';
import GithubSlugger from 'github-slugger';
import { visit } from 'unist-util-visit';

function hasHeadingAnchor(node: Element): boolean {
  return node.children.some((child) => {
    if (child.type !== 'element') return false;
    const classes = child.properties.className;
    return Array.isArray(classes)
      ? classes.includes('heading-anchor')
      : classes === 'heading-anchor';
  });
}

export function addHeadingPermalinks(tree: Root): void {
  const slugger = new GithubSlugger();

  visit(tree, 'element', (node: Element) => {
    if (!/^h[1-6]$/.test(node.tagName)) return;

    const textOf = (element: Element): string =>
      element.children
        .map((child) => {
          if (child.type === 'text') return child.value;
          if (child.type !== 'element') return '';
          if (child.tagName === 'img' && typeof child.properties.alt === 'string') {
            return child.properties.alt;
          }
          return textOf(child);
        })
        .join('');

    // 所有标题都要推进 slugger，h1/h4 等重复项也会影响后续编号。
    const generatedId = slugger.slug(textOf(node));
    const existingId = node.properties.id;
    const id = typeof existingId === 'string' && existingId !== '' ? existingId : generatedId;
    if (id === '') return;
    node.properties.id = id;

    if ((node.tagName !== 'h2' && node.tagName !== 'h3') || hasHeadingAnchor(node)) return;

    node.children.push({
      type: 'element',
      tagName: 'a',
      properties: {
        className: ['heading-anchor'],
        href: `#${id}`,
        'aria-label': '此小节的永久链接',
        dataPagefindIgnore: true,
      },
      children: [{ type: 'text', value: '#' }],
    });
  });
}

export function rehypeHeadingLinks() {
  return (tree: Root) => addHeadingPermalinks(tree);
}
