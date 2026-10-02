import { describe, expect, it, vi, afterEach } from 'vitest';
import { onRequest } from '../../../functions/[[path]].ts';
import netlify, { config as netlifyConfig } from '../../../netlify/edge-functions/negotiate.ts';
import vercel from '../../../middleware.ts';

afterEach(() => vi.unstubAllGlobals());

async function invoke(platform: string, request: Request, asset: () => Promise<Response | null>) {
  const next = vi.fn(async () => new Response('HTML fallback', { headers: { 'content-type': 'text/html' } }));
  const fetchAsset = vi.fn(async () => (await asset()) ?? new Response('missing', { status: 404 }));
  vi.stubGlobal('fetch', fetchAsset);
  const response = platform === 'cloudflare'
    ? await onRequest({ request, env: { ASSETS: { fetch: fetchAsset } }, next })
    : platform === 'netlify' ? await netlify(request, { next }) : await vercel(request);
  return { response, next, fetchAsset };
}

describe.each(['cloudflare', 'netlify', 'vercel'])('%s actual adapter', (platform) => {
  it('returns the Markdown representation and discovery headers', async () => {
    const { response } = await invoke(platform, new Request('https://example.test/article/', { headers: { accept: 'text/markdown' } }), async () => new Response('# Body', { headers: { 'content-type': 'text/plain' } }));
    expect(await response?.text()).toBe('# Body');
    expect(response?.headers.get('vary')).toBe('Accept');
    expect(response?.headers.get('content-type')).toContain('text/markdown');
    expect(response?.headers.get('content-location')).toBe('/article.md');
  });
  it('returns a bodyless HEAD representation', async () => {
    const { response } = await invoke(platform, new Request('https://example.test/article/', { method: 'HEAD', headers: { accept: 'text/markdown' } }), async () => new Response('# Body'));
    expect(await response?.text()).toBe('');
  });
  it.each(['missing', 'HTML', 'stream error'])('falls back on %s without throwing', async (failure) => {
    const { response, next } = await invoke(platform, new Request('https://example.test/article/', { headers: { accept: 'text/markdown' } }), async () => {
      if (failure === 'missing') return null;
      if (failure === 'HTML') return new Response('<html>Fallback</html>', { headers: { 'content-type': 'text/html' } });
      return new Response(new ReadableStream({ start(controller) { controller.error(new Error('stream failed')); } }));
    });
    if (platform === 'vercel') expect(response).toBeUndefined();
    else { expect(await response?.text()).toBe('HTML fallback'); expect(next).toHaveBeenCalledOnce(); }
  });
});

it.each([
  ['/article/', true], ['/wiki/reader/', true], ['/letterpress/article/', true],
  ['/_astro/code.js', false], ['/content.ndjson', false], ['/article.md', false], ['/favicon.svg', false],
])('Netlify regex routing handles %s', (path, expected) => {
  expect(netlifyConfig).not.toHaveProperty('path');
  expect(new RegExp(netlifyConfig.pattern).test(path)).toBe(expected);
});
