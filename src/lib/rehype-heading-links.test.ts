import type { Element, Root } from 'hast';
import { describe, expect, it } from 'vitest';
import { addHeadingPermalinks } from './rehype-heading-links.js';

function heading(tagName: 'h1' | 'h2' | 'h3' | 'h4', id?: string): Element {
  return {
    type: 'element',
    tagName,
    properties: id === undefined ? {} : { id },
    children: [{ type: 'text', value: '小节标题' }],
  };
}

function rootOf(...children: Element[]): Root {
  return { type: 'root', children };
}

describe('heading permalinks', () => {
  it('preserves an existing renderer-provided id', () => {
    const node = heading('h2', '重复标题-1');
    addHeadingPermalinks(rootOf(node));

    expect(node.children.at(-1)).toMatchObject({
      type: 'element',
      tagName: 'a',
      properties: {
        className: ['heading-anchor'],
        href: '#重复标题-1',
        'aria-label': '此小节的永久链接',
        dataPagefindIgnore: true,
      },
    });
  });

  it('adds links to h2 and h3 but not h1 or h4', () => {
    const nodes = [heading('h1', 'one'), heading('h2', 'two'), heading('h3', 'three'), heading('h4', 'four')];
    addHeadingPermalinks(rootOf(...nodes));

    expect(nodes.map((node) => node.children.length)).toEqual([1, 2, 2, 1]);
  });

  it('generates an id when Astro has not reached its built-in id pass yet', () => {
    const node = heading('h2');
    addHeadingPermalinks(rootOf(node));
    expect(node.properties.id).toBe('小节标题');
    expect(node.children.at(-1)).toMatchObject({
      type: 'element',
      properties: { href: '#小节标题' },
    });
  });

  it('keeps duplicate heading suffixes stable across ignored levels', () => {
    const nodes = [heading('h1'), heading('h2'), heading('h4'), heading('h3')];
    addHeadingPermalinks(rootOf(...nodes));

    expect(nodes.map((node) => node.properties.id)).toEqual([
      '小节标题',
      '小节标题-1',
      '小节标题-2',
      '小节标题-3',
    ]);
    expect(nodes[3]?.children.at(-1)).toMatchObject({
      type: 'element',
      properties: { href: '#小节标题-3' },
    });
  });

  it('is idempotent when the pipeline invokes it more than once', () => {
    const node = heading('h2', 'stable');
    const tree = rootOf(node);
    addHeadingPermalinks(tree);
    addHeadingPermalinks(tree);

    expect(node.children.filter((child) => child.type === 'element')).toHaveLength(1);
  });
});
