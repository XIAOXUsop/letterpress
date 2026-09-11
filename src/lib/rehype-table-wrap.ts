/**
 * rehype 插件：把宽表格包进一个可横向滚动的容器。
 *
 * ── 为什么不直接用 CSS ──────────────────────────────────────────────
 *
 * 常见做法是给 `<table>` 加 `display: block; overflow-x: auto`。代码短，
 * 但它**会破坏表格语义**：`display: block` 之后浏览器不再把元素当表格
 * 处理，读屏软件读不出「第几行第几列」「表头是哪几个」，而表格正是
 * 无障碍最依赖语义的场景之一。
 *
 * 折中做法是在外面套一层 `<div>`：外层负责滚动，`<table>` 保持它本来的
 * display，语义完整。代价是多一个 DOM 节点，值。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────
 *
 * 实测：文章里一张三列对照表在 375px 视口下宽 383px，把整个页面撑出
 * 横向滚动条。`width: 100%` 拦不住——表格列有最小内容宽度，
 * 内容不肯收缩时表格就会溢出。移动端横向滚动是最容易被忽略、
 * 也最让人立刻关掉页面的问题之一。
 *
 * 加了 `tabindex="0"` 与 `role="region"`：可滚动的区域必须能被键盘聚焦，
 * 否则键盘用户根本滚不动它（WCAG 要求滚动容器可达）。
 */

import { visit } from 'unist-util-visit';
import type { Root, Element } from 'hast';

export function rehypeTableWrap() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'table') return;
      if (index === undefined || parent === undefined) return;
      // 已经包过就跳过——插件在 Astro 的管线里可能被执行多次
      if (parent.type === 'element' && (parent as Element).properties?.['dataTableWrap']) return;

      const wrapper: Element = {
        type: 'element',
        tagName: 'div',
        properties: {
          className: ['table-wrap'],
          // 可滚动区域要能被键盘聚焦，否则键盘用户滚不动它
          tabindex: '0',
          role: 'region',
          // 读屏用户需要知道这是个可滚动的表格区域
          'aria-label': '可横向滚动的表格',
          dataTableWrap: true,
        },
        children: [node],
      };

      (parent.children as unknown[]).splice(index, 1, wrapper);
      return index + 1; // 跳过刚插入的容器，避免再次进入
    });
  };
}
