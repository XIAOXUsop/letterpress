import { describe, expect, it, vi } from 'vitest';
import { negotiate, twinPath } from './edge.js';

/** 一个内存里的假静态站，用来替代真实构建产物。 */
function fakeSite(files: Record<string, string>) {
  return async (pathname: string): Promise<Response | null> => {
    const body = files[pathname];
    if (body === undefined) return null;
    return new Response(body, { status: 200 });
  };
}

const SITE = {
  '/hello.md': '# Hello\n\n正文。',
  '/wiki/note.md': '# 笔记\n\n内容。',
  '/foo/index.md': '# 目录页\n',
};

function get(pathname: string, accept: string | null, method = 'GET'): Request {
  const headers = new Headers();
  if (accept !== null) headers.set('accept', accept);
  return new Request(`https://example.com${pathname}`, { method, headers });
}

describe('twinPath', () => {
  it('去掉结尾斜杠再加 .md', () => {
    expect(twinPath('/hello/')).toBe('/hello.md');
    expect(twinPath('/hello')).toBe('/hello.md');
  });

  it('根路径映射到 index.md', () => {
    expect(twinPath('/')).toBe('/index.md');
    expect(twinPath('')).toBe('/index.md');
  });

  it('多层路径保留结构', () => {
    expect(twinPath('/wiki/note/')).toBe('/wiki/note.md');
  });
});

describe('negotiate', () => {
  it('要 markdown 时返回孪生文件', async () => {
    const res = await negotiate(get('/hello/', 'text/markdown'), {
      pathname: '/hello/',
      fetchAsset: fakeSite(SITE),
    });

    expect(res).not.toBeNull();
    expect(await res!.text()).toBe('# Hello\n\n正文。');
  });

  it('Content-Type 是 text/markdown 且带 charset', async () => {
    const res = await negotiate(get('/hello/', 'text/markdown'), {
      pathname: '/hello/',
      fetchAsset: fakeSite(SITE),
    });
    expect(res!.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  });

  /**
   * 少了这个头，CDN 会把 markdown 缓存下来发给浏览器。
   * 这个 bug 只在缓存命中时出现，表现是「网站有时候会坏」。
   */
  it('带上 Vary: Accept', async () => {
    const res = await negotiate(get('/hello/', 'text/markdown'), {
      pathname: '/hello/',
      fetchAsset: fakeSite(SITE),
    });
    expect(res!.headers.get('vary')).toBe('Accept');
  });

  it('给出 token 估算，供 agent 判断能不能塞下', async () => {
    const res = await negotiate(get('/hello/', 'text/markdown'), {
      pathname: '/hello/',
      fetchAsset: fakeSite(SITE),
    });
    const tokens = Number(res!.headers.get('x-markdown-tokens'));
    expect(Number.isInteger(tokens)).toBe(true);
    expect(tokens).toBeGreaterThan(0);
  });

  it('声明实际表示位置与 HTML/Markdown 双向发现关系', async () => {
    const res = await negotiate(get('/hello/', 'text/markdown'), {
      pathname: '/hello/',
      fetchAsset: fakeSite(SITE),
    });

    expect(res!.headers.get('content-location')).toBe('/hello.md');
    expect(res!.headers.get('link')).toContain('</hello/>; rel="canonical"; type="text/html"');
    expect(res!.headers.get('link')).toContain('</hello.md>; rel="alternate"; type="text/markdown"');
  });

  it('中文路径在响应头中使用 URI 编码，不会触发非法 Header', async () => {
    const res = await negotiate(get('/中文/', 'text/markdown'), {
      pathname: '/中文/',
      fetchAsset: fakeSite({ '/中文.md': '# 中文' }),
    });

    expect(res).not.toBeNull();
    expect(res!.headers.get('content-location')).toBe('/%E4%B8%AD%E6%96%87.md');
    expect(res!.headers.get('link')).toContain('</%E4%B8%AD%E6%96%87/>');
  });

  it('不要 markdown 时返回 null，交给平台处理静态资源', async () => {
    const res = await negotiate(get('/hello/', 'text/html'), {
      pathname: '/hello/',
      fetchAsset: fakeSite(SITE),
    });
    expect(res).toBeNull();
  });

  /** 只发通配符的客户端（Gemini CLI、Windsurf）必须拿到 HTML。 */
  it('只发通配符时返回 null', async () => {
    const res = await negotiate(get('/hello/', '*/*'), {
      pathname: '/hello/',
      fetchAsset: fakeSite(SITE),
    });
    expect(res).toBeNull();
  });

  /**
   * 没有孪生文件时**回落而不是 404**。
   * 返回 404 会让 agent 以为页面不存在，而 HTML 版本好好的。
   */
  it('孪生文件不存在时回落，不返回 404', async () => {
    const res = await negotiate(get('/no-such-page/', 'text/markdown'), {
      pathname: '/no-such-page/',
      fetchAsset: fakeSite(SITE),
    });
    expect(res).toBeNull();
  });

  it('只处理 GET 与 HEAD', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await negotiate(get('/hello/', 'text/markdown', method), {
        pathname: '/hello/',
        fetchAsset: fakeSite(SITE),
      });
      expect(res, `${method} 不该被协商改写`).toBeNull();
    }
  });

  it('HEAD 返回头但不带 body', async () => {
    const res = await negotiate(get('/hello/', 'text/markdown', 'HEAD'), {
      pathname: '/hello/',
      fetchAsset: fakeSite(SITE),
    });
    expect(res).not.toBeNull();
    expect(await res!.text()).toBe('');
  });

  /** 不排除 .md 的话，`/foo.md` 会被改写成 `/foo.md.md`。 */
  it('已经是 .md 的路径不重复处理', async () => {
    const res = await negotiate(get('/hello.md', 'text/markdown'), {
      pathname: '/hello.md',
      fetchAsset: fakeSite(SITE),
    });
    expect(res).toBeNull();
  });

  it.each([
    '/_astro/style.css',
    '/favicon.ico',
    '/rss.xml',
    '/llms.txt',
    '/content.ndjson',
    '/sitemap-index.xml',
    '/image.png',
    '/font.woff2',
  ])('静态资源不参与协商：%s', async (pathname) => {
    const res = await negotiate(get(pathname, 'text/markdown'), {
      pathname,
      fetchAsset: fakeSite(SITE),
    });
    expect(res).toBeNull();
  });

  /**
   * 这条功能的失败必须是静默的。
   *
   * 它是一次增强（agent 能少读点 token），不是主路径（人能看到页面）。
   * 让存储层的异常冒泡成 500，等于用一个可有可无的优化把整个站点拖垮——
   * 而用户看到的会是一个错误页，且完全不知道和 markdown 有关。
   */
  it('取文件抛异常时回落，不把异常抛出去', async () => {
    const res = await negotiate(get('/hello/', 'text/markdown'), {
      pathname: '/hello/',
      fetchAsset: async () => {
        throw new Error('存储挂了');
      },
    });
    expect(res).toBeNull();
  });

  it('七个真实 agent 的请求头得到正确分流', async () => {
    const headers: Array<[string, string, boolean]> = [
      ['Claude Code', 'text/markdown, text/html, */*', true],
      ['Cursor', 'text/markdown,text/html;q=0.9,*/*;q=0.5', true],
      ['OpenCode', 'text/markdown;q=1.0, text/html;q=0.7, */*;q=0.1', true],
      ['Codex', 'text/html,application/xhtml+xml,*/*;q=0.8', false],
      ['Gemini CLI', '*/*', false],
      ['Copilot', 'text/html,application/xhtml+xml', false],
      ['Windsurf', '*/*', false],
    ];

    for (const [name, accept, expectMarkdown] of headers) {
      const res = await negotiate(get('/hello/', accept), {
        pathname: '/hello/',
        fetchAsset: fakeSite(SITE),
      });
      expect(res !== null, `${name} 的分流不对`).toBe(expectMarkdown);
    }
  });

  it('wiki 子路径同样工作', async () => {
    const res = await negotiate(get('/wiki/note/', 'text/markdown'), {
      pathname: '/wiki/note/',
      fetchAsset: fakeSite(SITE),
    });
    expect(res).not.toBeNull();
    expect(await res!.text()).toContain('笔记');
  });

  it('取文件只被调用一次', async () => {
    const spy = vi.fn(fakeSite(SITE));
    await negotiate(get('/hello/', 'text/markdown'), { pathname: '/hello/', fetchAsset: spy });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('不要 markdown 时根本不取 .md 文件（省一次 IO）', async () => {
    const spy = vi.fn(fakeSite(SITE));
    await negotiate(get('/hello/', 'text/html'), { pathname: '/hello/', fetchAsset: spy });
    expect(spy).not.toHaveBeenCalled();
  });
});
