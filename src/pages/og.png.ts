/**
 * 站点默认分享图：`/og.png`。
 *
 * 首页、归档页、标签页这类没有自己封面的页面用它。
 */
import type { APIRoute } from 'astro';
import { generateSiteOgImage } from '../lib/og.js';
import { site } from '../config.js';

export const GET: APIRoute = () => {
  return new Response(new Uint8Array(generateSiteOgImage(site.title)), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
