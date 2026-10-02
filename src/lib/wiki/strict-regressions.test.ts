import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseWikiLinks, renderWikiLinks } from './wikilink.ts';
import { parseMarkdown, markdownBody } from './markdown.ts';
import { readContentPage } from './read-page.ts';
import { buildLookup, remarkWikilink } from './remark-wikilink.ts';
import { buildGraph, type Doc } from './graph.ts';
import { contentDigest } from './digest.ts';
import { buildContextPack } from './context-pack.ts';
import { assess, splitPassages } from './retrieve.ts';
import { negotiate } from '../negotiate/edge.ts';
import { parseQuestions } from '../../../scripts/lib/questions.mjs';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lp-strict-'));
  dirs.push(root);
  mkdirSync(join(root, 'posts'));
  mkdirSync(join(root, 'wiki'));
  writeFileSync(join(root, 'wiki', 'target.md'), '---\ntitle: Target\nsummary: Published\n---\nBody');
  return root;
}
function doc(over: Partial<Doc> = {}): Doc {
  return { kind: 'wiki', slug: 'reader', title: 'Reader', body: '', summary: 'Summary', draft: false, explicitSlug: false, ...over };
}
function render(body: string, root: string) {
  const tree = parseMarkdown(body);
  remarkWikilink({ contentRoot: root })(tree, { value: body });
  return JSON.stringify(tree);
}

describe('strict review: actual Markdown boundaries', () => {
  it('preserves first-block code and hard breaks through source ingestion', () => {
    const root = fixture();
    const source = '---\r\ntitle: Code\r\nsummary: Example\r\n---\r\n\r\n    [[missing]]\r\n\r\nText  \r\nNext\r\n';
    writeFileSync(join(root, 'posts', 'code.md'), source);
    const body = readContentPage(join(root, 'posts'), 'code.md').body;
    expect(body).toBe('    [[missing]]\r\n\r\nText  \r\nNext');
    expect(markdownBody(source)).toBe(body);
    expect(parseWikiLinks(body)).toEqual([]);
    expect(splitPassages('reader', body)[0].text).toBe(body);
  });
  it.each([
    ['indented', '    [[target]]'],
    ['blockquote fence', '> ```md\n> [[target]]\n> ```'],
    ['list fence', '- Example\n\n  ```md\n  [[target]]\n  ```'],
    ['multiline code', '`first\n[[target]]`'],
    ['tilde closing info', '~~~\n~~~ still code\n[[target]]\n~~~'],
    ['long fence', '````\n```\n[[target]]\n````'],
  ])('%s is neither a graph edge nor a rendered link', (_name, body) => {
    const root = fixture();
    const graph = buildGraph([doc({ body }), doc({ slug: 'target', title: 'Target' })]);
    expect(parseWikiLinks(body)).toEqual([]);
    expect(graph.outbound.get('reader')?.size).toBe(0);
    expect(render(body, root)).not.toContain('"type":"link"');
    expect(renderWikiLinks(body, () => '/wiki/target/')).toBe(body);
  });
  it('does not create a nested link inside an existing link label', () => {
    const root = fixture();
    const body = '[Read [[target]]](/existing/)';
    expect(parseWikiLinks(body)).toEqual([]);
    expect(renderWikiLinks(body, () => '/wiki/target/')).toBe(body);
    expect(render(body, root).match(/"type":"link"/g)).toHaveLength(1);
    expect(render(body, root)).toContain('"url":"/existing/"');
  });
  it('only a literal authored wiki link participates after entity decoding', () => {
    const root = fixture();
    const body = '&#91;&#91;target]] and [[target]]';
    expect(parseWikiLinks(body)).toHaveLength(1);
    expect(render(body, root).match(/"type":"link"/g)).toHaveLength(1);
    const tree = parseMarkdown(body);
    remarkWikilink({ contentRoot: root })(tree, { value: body });
    const paragraph = tree.children[0] as { children: Array<{ type: string; value?: string }> };
    expect(paragraph.children[0]).toMatchObject({ type: 'text', value: '[[target]]' });
    expect(paragraph.children.at(-1)?.type).toBe('link');
    expect(render('First line\r\n[[target]]', root)).toContain('"type":"link"');
    expect(render('- First\n  next line\n  [[target]]', root)).toContain('"type":"link"');
  });
  it('real links retain source offsets after an escape', () => {
    const body = '\\* prefix [[target]]';
    const [ref] = parseWikiLinks(body);
    expect(body.slice(ref.offset, ref.end)).toBe('[[target]]');
    expect(renderWikiLinks(body, () => '/wiki/target/')).toBe('\\* prefix [target](/wiki/target/)');
  });
  it('an escaped pipe in a GFM table resolves consistently', () => {
    const root = fixture();
    const body = '| Link |\n| --- |\n| [[target\\|Alias]] |';
    expect(parseWikiLinks(body)[0]?.target).toBe('target');
    expect(parseWikiLinks(body)[0]?.label).toBe('Alias');
    expect(render(body, root)).toContain('"url":"/wiki/target/"');
    expect(renderWikiLinks(body, () => '/wiki/target/')).toContain('[Alias](/wiki/target/)');
  });
  it('a literal formatted label stays literal in exported Markdown', () => {
    const body = '[[target|\\*Label\\*]]';
    expect(parseWikiLinks(body)[0]?.label).toBe('*Label*');
    expect(renderWikiLinks(body, () => '/wiki/target/')).toBe('[\\*Label\\*](/wiki/target/)');
  });
  it('a same-title draft cannot hide a published title in production', () => {
    const root = fixture();
    writeFileSync(join(root, 'wiki', 'draft.md'), '---\ntitle: Target\nsummary: Draft\ndraft: true\n---\nBody');
    expect(buildLookup(root).byName.get('target')).toBe('/wiki/target/');
    expect(render('[[Target]]', root)).toContain('"url":"/wiki/target/"');
    expect(buildLookup(root, '/', { includeDrafts: true }).byName.get('draft')).toBe('/wiki/draft/');
  });
  it('a draft sharing a published slug cannot overwrite its lookup', () => {
    const root = fixture();
    writeFileSync(join(root, 'posts', 'draft.md'), '---\ntitle: Draft\nslug: target\ndraft: true\n---\nBody');
    expect(buildLookup(root).byName.get('target')).toBe('/wiki/target/');
  });
});

describe('strict review: delivered evidence', () => {
  it('a missing slash acronym cannot be replaced by generic testing content', () => {
    const passages = splitPassages('example', '测试方法与单元测试。');
    expect(assess(passages, '怎么做 A/B 测试').supported).toBe(false);
    expect(assess(splitPassages('example', 'A/B 测试使用不同版本比较结果。'), '怎么做 A/B 测试').supported).toBe(true);
  });
  it('package names retain their compound identity', () => {
    expect(assess(splitPassages('example', '支持中文语言与英文语言。'), '支持哪些语言包').supported).toBe(false);
    expect(assess(splitPassages('example', '支持中文语言包。'), '支持哪些语言包').supported).toBe(true);
    expect(assess(splitPassages('example', '工具使用说明。'), '工具包').supported).toBe(false);
  });
  it('an answer section takes precedence over a references list', () => {
    const passages = splitPassages('example', '## 参考\nTypography width em source.\n## Explanation\nWidth uses em.');
    expect(assess(passages, 'width em').passages[0].heading).toBe('Explanation');
  });
  it('the unique late hit, negation and complete code reach the user', () => {
    const body = 'Background\n'.repeat(9) + '\n```\nquasarquux must NOT be enabled.\n```\nThe exception is a separate option.';
    const pack = buildContextPack([{ slug: 'example', title: 'Example', updated: '', body }], 'quasarquux');
    expect(pack.supported).toBe(true);
    expect(pack.passages[0].text).toBe(body.trim());
    expect(pack.passages[0].text).toContain('must NOT');
    expect(pack.passages[0].text).toContain('exception');
  });
  it('example headings do not break a code block into fake sections', () => {
    const body = 'Before\n```md\n## Fake heading\nExample\n```\nAfter';
    expect(splitPassages('example', body)).toEqual([{ docId: 'example', id: 'example#0', heading: '', text: body }]);
  });
  it('real headings still split sections and preserve code examples', () => {
    const body = 'Intro\n## First\n```md\n### Example\n```\n## Second\nAnswer';
    const passages = splitPassages('example', body);
    expect(passages.map((p) => p.heading)).toEqual(['', 'First', 'Second']);
    expect(passages[1].text).toContain('```md\n### Example\n```');
  });
  it.each(['sourceId', 'revision', 'locator'] as const)('changing %s invalidates review', (key) => {
    const source = { sourceId: 'spec', revision: 'v1', locator: 'section 1' };
    expect(contentDigest(doc({ sources: [source] }))).not.toBe(contentDigest(doc({ sources: [{ ...source, [key]: 'changed' }] })));
  });
  it('changing original provenance invalidates review', () => {
    expect(contentDigest(doc({ original: { reason: 'first' } }))).not.toBe(contentDigest(doc({ original: { reason: 'second' } })));
  });
  it('source ordering and duplicate references do not invalidate review', () => {
    const a = { sourceId: 'a', revision: '1' }; const b = { sourceId: 'b', revision: '2' };
    expect(contentDigest(doc({ sources: [a, b] }))).toBe(contentDigest(doc({ sources: [b, a, a] })));
  });
  it('gold case parsing is identical on LF and CRLF and ignores examples', () => {
    const source = '## Facts\n```\n### fake\n期望命中：missing\n```\n### real\n期望命中：target\n';
    const cases = parseQuestions(source);
    expect(cases).toHaveLength(1);
    expect(cases[0].expect).toEqual(['target']);
    expect(parseQuestions(source.replace(/\n/g, '\r\n'))).toEqual(cases);
  });
});

describe('strict review: negotiation fallback', () => {
  const request = () => new Request('https://example.com/page/', { headers: { accept: 'text/markdown' } });
  it('a successful response whose body stream fails still falls back', async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error('download interrupted')); } }));
    await expect(negotiate(request(), { pathname: '/page/', fetchAsset: async () => response })).resolves.toBeNull();
  });
  it.each(['text/html', 'application/json', 'image/png'])('%s is never relabeled Markdown', async (type) => {
    expect(await negotiate(request(), { pathname: '/page/', fetchAsset: async () => new Response('fallback', { headers: { 'Content-Type': type } }) })).toBeNull();
  });
  it('HTML without a content type still falls back', async () => {
    const response = new Response('<!doctype html><html>fallback</html>'); response.headers.delete('content-type');
    expect(await negotiate(request(), { pathname: '/page/', fetchAsset: async () => response })).toBeNull();
  });
  it('204 is not a valid Markdown representation', async () => {
    expect(await negotiate(request(), { pathname: '/page/', fetchAsset: async () => new Response(null, { status: 204 }) })).toBeNull();
  });
  it.each(['text/markdown', 'text/plain', 'application/octet-stream'])('static Markdown served as %s remains usable', async (type) => {
    const response = await negotiate(request(), { pathname: '/page/', fetchAsset: async () => new Response('# Page', { headers: { 'Content-Type': type } }) });
    expect(await response?.text()).toBe('# Page');
    expect(response?.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  });
});
