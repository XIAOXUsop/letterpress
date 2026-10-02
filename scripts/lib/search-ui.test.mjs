import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Execute the page's real controller, rather than a second search implementation.
const source = readFileSync(new URL('../../src/scripts/search.js', import.meta.url), 'utf8');
// Replace only the native module boundary; execute the real DOM controller.
const code = source.replace('import(url)', '__importPagefind(url)').replace('export {};', '');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function element() {
  return {
    value: '', textContent: '', children: [], listeners: {}, html: '', dataset: { pagefindUrl: '/pagefind/pagefind.js' },
    get innerHTML() { return this.html; },
    set innerHTML(value) { this.html = value; this.children = []; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    append(...items) { this.children.push(...items); },
  };
}
function setup(load, pagefindUrl = '/pagefind/pagefind.js') {
  const nodes = Object.fromEntries(['search-form', 'search-input', 'search-status', 'search-results']
    .map((id) => [id, element()]));
  nodes['search-form'].dataset.pagefindUrl = pagefindUrl;
  let timer;
  const context = createContext({
    document: { getElementById: (id) => nodes[id], createElement: element },
    location: { search: '' }, URLSearchParams,
    __importPagefind: load,
    window: { clearTimeout() { timer = undefined; }, setTimeout(fn) { timer = fn; return 1; } },
  });
  new Script(code).runInContext(context);
  return {
    nodes,
    submit(value) { nodes['search-input'].value = value; nodes['search-form'].listeners.submit({ preventDefault() {} }); },
    input(value) { nodes['search-input'].value = value; nodes['search-input'].listeners.input(); },
    debounce() { const fn = timer; timer = undefined; fn?.(); },
    status: () => nodes['search-status'].textContent,
    results: () => nodes['search-results'].children,
  };
}
const result = (title = '正确结果', excerpt = '<mark>排版</mark>') => ({
  results: [{ data: async () => ({ url: '/cjk/', meta: { title }, excerpt }) }],
});

describe('search page asynchronous behavior', () => {
  it('uses the configured deployment subpath for native module loading', async () => {
    const urls = [];
    const ui = setup(async (url) => { urls.push(url); return { search: async () => result() }; }, '/notes/pagefind/pagefind.js');
    ui.submit('排版');
    await tick();
    expect(urls).toEqual(['/notes/pagefind/pagefind.js']);
    expect(ui.status()).toBe('找到 1 条结果');
  });
  it('shows module download failure and allows a later retry', async () => {
    let loads = 0;
    const ui = setup(async () => {
      if (++loads === 1) throw new Error('模块下载失败');
      return { search: async () => result() };
    });
    ui.submit('排版');
    await tick();
    expect(ui.status()).toContain('搜索索引暂时不可用');
    ui.submit('排版');
    await tick();
    expect(ui.status()).toBe('找到 1 条结果');
  });
  it('does not restore results when cleared during index loading', async () => {
    const loading = deferred();
    let queries = 0;
    const ui = setup(() => loading.promise);
    ui.submit('排版');
    ui.input('');
    loading.resolve({ search: async () => { queries++; return result(); } });
    await tick();
    expect(queries).toBe(0);
    expect(ui.status()).toBe('');
    expect(ui.results()).toHaveLength(0);
  });
  it('invalidates an in-flight search immediately on clear', async () => {
    const query = deferred();
    const ui = setup(async () => ({ search: () => query.promise }));
    ui.submit('排版');
    await tick();
    ui.input('');
    query.resolve(result());
    await tick();
    expect(ui.status()).toBe('');
    expect(ui.results()).toHaveLength(0);
  });
  it('does not display old results during the next input debounce', async () => {
    const old = deferred();
    const ui = setup(async () => ({ search: (q) => q === '旧' ? old.promise : Promise.resolve(result('新结果')) }));
    ui.submit('旧');
    await tick();
    ui.input('新');
    old.resolve(result('旧结果'));
    await tick();
    expect(ui.results()).toHaveLength(0);
    ui.debounce();
    await tick();
    expect(ui.results()[0].children[0].children[0].textContent).toBe('新结果');
  });
  it('keeps the newest query when concurrent index loads finish out of order', async () => {
    const first = deferred();
    const second = deferred();
    let loads = 0;
    const ui = setup(() => (++loads === 1 ? first.promise : second.promise));
    ui.submit('旧');
    ui.submit('新');
    second.resolve({ search: async (q) => result(q) });
    await tick();
    first.resolve({ search: async (q) => result(q) });
    await tick();
    expect(ui.results()[0].children[0].children[0].textContent).toBe('新');
  });
  it('reports query and fragment failures and can retry', async () => {
    let queries = 0;
    let resets = 0;
    let cachedFailure = false;
    const ui = setup(async () => ({ destroy: async () => { resets++; cachedFailure = false; }, search: async () => {
      if (cachedFailure) throw new Error('缓存的下载失败');
      queries++;
      if (queries === 1) { cachedFailure = true; throw new Error('索引读取失败'); }
      if (queries === 2) return { results: [{ data: async () => { cachedFailure = true; throw new Error('片段读取失败'); } }] };
      return result();
    } }));
    for (let i = 0; i < 2; i++) {
      ui.submit('排版');
      await tick();
      expect(ui.status()).toBe('搜索失败，请重试。');
      expect(ui.results()).toHaveLength(0);
    }
    ui.submit('排版');
    await tick();
    expect(ui.status()).toBe('找到 1 条结果');
    expect(resets).toBe(2);
  });
  it('allows plain highlighting but escapes mark attributes and other tags', async () => {
    const ui = setup(async () => ({ search: async () => result('安全摘要', '<mark>字</mark><mark onclick="bad()">恶意</mark><img src=x>') }));
    ui.submit('字');
    await tick();
    const html = ui.results()[0].children[0].children[1].innerHTML;
    expect(html).toContain('<mark>字</mark>');
    expect(html).not.toContain('<mark onclick');
    expect(html).not.toContain('<img');
  });
});
