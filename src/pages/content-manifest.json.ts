/**
 * `/content-manifest.json`——供 Agent / RAG 同步器增量抓取的确定性清单。
 */
import type { APIRoute } from 'astro';
import { serializeContentManifest } from '../lib/content-manifest.js';
import { createContentSnapshot } from '../lib/content-snapshot.js';

export const GET: APIRoute = async () => {
  const snapshot = await createContentSnapshot();
  const body = serializeContentManifest(snapshot.manifest);

  return new Response(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
