import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';

// Same block and inline grammar as Astro's remark processor, including tables.
const parser = unified().use(remarkParse).use(remarkGfm);

export function parseMarkdown(source: string): Root {
  return parser.parse(source);
}

/** Remove surrounding blank lines without erasing code indentation or hard breaks. */
export function trimBlankLines(source: string): string {
  return source.replace(/^(?:[\t ]*\r?\n)+/, '').replace(/(?:\r?\n[\t ]*)+$/, '');
}

export function markdownBody(source: string): string {
  const match = /^(?:\uFEFF)?---[\t ]*\r?\n[\s\S]*?\r?\n---[\t ]*(?:\r?\n|$)/.exec(source);
  return trimBlankLines(match ? source.slice(match[0].length) : source);
}
