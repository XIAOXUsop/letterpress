// @ts-check
// 原生浏览器模块，以 raw 文本内联到搜索页；动态导入不经过 Vite 转换。
// Pagefind 地址由页面 data-pagefind-url 提供，包含部署 base。
/** @typedef {{data: () => Promise<{url: string, meta: {title?: string}, excerpt: string}>}} PagefindResult */
/** @typedef {{search: (query: string) => Promise<{results: PagefindResult[]}>, destroy?: () => Promise<void>}} Pagefind */
const form = /** @type {HTMLFormElement | null} */ (document.getElementById('search-form'));
const input = /** @type {HTMLInputElement | null} */ (document.getElementById('search-input'));
const status = document.getElementById('search-status');
const results = document.getElementById('search-results');
if (form && input && status && results) {
    const formEl = form;
    const inputEl = input;
    const statusEl = status;
    const resultsEl = results;
    /** @type {Pagefind | null} */
    let pagefind = null;
    /** @type {Promise<void> | null} */
    let recovery = null;
    /** @param {string} url */
    const dynamicImport = (url) => import(url);
    async function load() {
        if (recovery)
            await recovery;
        if (pagefind)
            return pagefind;
        try {
            const url = formEl.dataset.pagefindUrl;
            if (!url)
                return null;
            pagefind = await dynamicImport(url);
            return pagefind;
        }
        catch {
            return null;
        }
    }
    /** @param {string} text */
    function setStatus(text) {
        statusEl.textContent = text;
    }
    /** @param {{url: string, title: string, excerpt: string}[]} items */
    function render(items) {
        resultsEl.innerHTML = '';
        for (const item of items) {
            const li = document.createElement('li');
            li.className = 'search__item';
            const a = document.createElement('a');
            a.className = 'search__link';
            a.href = item.url;
            const h = document.createElement('span');
            h.className = 'search__title';
            h.textContent = item.title;
            const p = document.createElement('span');
            p.className = 'search__excerpt';
            p.innerHTML = sanitizeExcerpt(item.excerpt);
            a.append(h, p);
            li.append(a);
            resultsEl.append(li);
        }
    }
    /** @param {string} html */
    function sanitizeExcerpt(html) {
        return html
            .replace(/<[^>]*>/g, (tag) => /^<\/?mark\s*>$/i.test(tag)
            ? tag
            : tag.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
            .replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, '&amp;');
    }
    /** @type {number | undefined} */
    let timer;
    // 输入变化立即递增；加载、查询和片段读取结束时均丢弃旧请求。
    let seq = 0;
    /** @param {string} query */
    async function run(query, mine = ++seq) {
        const q = query.trim();
        if (q === '') {
            resultsEl.innerHTML = '';
            setStatus('');
            return;
        }
        resultsEl.innerHTML = '';
        setStatus('搜索中…');
        const pf = await load();
        if (mine !== seq)
            return;
        if (!pf) {
            setStatus('搜索索引暂时不可用，请刷新页面后重试。');
            return;
        }
        try {
            const search = await pf.search(q);
            if (mine !== seq)
                return;
            if (search.results.length === 0) {
                setStatus(`没有找到与「${q}」相关的内容。换个词试试，或者去翻全部文章。`);
                resultsEl.innerHTML = '';
                return;
            }
            const top = search.results.slice(0, 20);
            const items = await Promise.all(top.map(async (r) => {
                const d = await r.data();
                return {
                    url: d.url,
                    title: d.meta.title ?? d.url,
                    excerpt: d.excerpt,
                };
            }));
            if (mine !== seq)
                return;
            setStatus(`找到 ${search.results.length} 条结果`);
            render(items);
        }
        catch {
            if (mine !== seq)
                return;
            // Pagefind 会缓存下载失败的 Promise，重置实例后才能可靠重试。
            recovery = Promise.resolve().then(() => pf.destroy?.()).catch(() => { });
            await recovery;
            recovery = null;
            if (mine !== seq)
                return;
            resultsEl.innerHTML = '';
            setStatus('搜索失败，请重试。');
        }
    }
    formEl.addEventListener('submit', (event) => {
        event.preventDefault();
        window.clearTimeout(timer);
        void run(inputEl.value);
    });
    inputEl.addEventListener('input', () => {
        window.clearTimeout(timer);
        const mine = ++seq;
        if (inputEl.value.trim() === '') {
            void run('', mine);
        }
        else {
            timer = window.setTimeout(() => void run(inputEl.value, mine), 200);
        }
    });
    const initial = new URLSearchParams(location.search).get('q');
    if (initial) {
        inputEl.value = initial;
        void run(initial);
    }
}
export {};
