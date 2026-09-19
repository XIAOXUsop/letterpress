/**
 * `/content.ndjson`——供 Agent / RAG 首次全量导入的流式内容快照。
 * 后续同步应改用 `/content-manifest.json`，按 hash 只下载变化项。
 */
import type { APIRoute } from 'astro';
import {
  buildContentExportRecords,
  serializeContentExport,
} from '../lib/content-export.js';
import { createContentSnapshot } from '../lib/content-snapshot.js';

export const GET: APIRoute = async () => {
  const snapshot = await createContentSnapshot();
  const body = serializeContentExport(
    buildContentExportRecords(snapshot.manifest, snapshot.markdownById),
  );

  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
