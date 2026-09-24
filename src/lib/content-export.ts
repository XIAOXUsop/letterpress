/**
 * 面向首次导入的 NDJSON 全量内容导出。
 *
 * manifest 适合“先比 hash、再抓变化”；首次接入时逐篇请求却是没有必要的 N+1。
 * NDJSON 让消费端逐行处理，不必把整个站点解析成一个巨大 JSON 数组。记录完全
 * 派生自 manifest 与真实 markdown 孪生文件，避免第三套元数据悄悄漂移。
 */
import { createHash } from 'node:crypto';
import type { ContentManifest, ContentManifestDocument } from './content-manifest.ts';

export const CONTENT_EXPORT_FORMAT = 'letterpress-content-record';
export const CONTENT_EXPORT_VERSION = 1;

export interface ContentExportRecord
  extends Omit<ContentManifestDocument, 'markdown'> {
  readonly format: typeof CONTENT_EXPORT_FORMAT;
  readonly version: typeof CONTENT_EXPORT_VERSION;
  readonly site: ContentManifest['site'];
  readonly content: ContentManifestDocument['markdown'] & {
    /** 与对应 `.md` 端点逐字节相同的完整文本。 */
    readonly text: string;
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * 从已验证的 manifest 生成导出记录。
 *
 * 这里仍主动复核 bytes 与 hash：调用方若不小心把另一个版本的正文配给清单，
 * 构建必须失败，而不是发布一份“元数据说 A、正文其实是 B”的导出。
 */
export function buildContentExportRecords(
  manifest: ContentManifest,
  markdownById: ReadonlyMap<string, string>,
): ContentExportRecord[] {
  const seen = new Set<string>();

  return [...manifest.documents]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((document) => {
      if (seen.has(document.id)) {
        throw new Error(`内容导出发现重复 ID：${document.id}`);
      }
      seen.add(document.id);

      const text = markdownById.get(document.id);
      if (text === undefined) {
        throw new Error(`内容导出缺少 ${document.id} 的 markdown 正文。`);
      }

      const bytes = new TextEncoder().encode(text).byteLength;
      if (bytes !== document.markdown.bytes) {
        throw new Error(
          `内容导出 ${document.id} 的字节数与清单不一致：${bytes} != ${document.markdown.bytes}`,
        );
      }

      const digest = sha256(text);
      if (digest !== document.markdown.sha256) {
        throw new Error(`内容导出 ${document.id} 的 SHA-256 与清单不一致。`);
      }

      const { markdown, ...metadata } = document;
      return {
        format: CONTENT_EXPORT_FORMAT,
        version: CONTENT_EXPORT_VERSION,
        site: manifest.site,
        ...metadata,
        content: { ...markdown, text },
      };
    });
}

/** 每行一个完整 JSON 对象，并保留结尾换行，便于 Unix 工具与流式读取。 */
export function serializeContentExport(records: readonly ContentExportRecord[]): string {
  return records.length === 0 ? '' : `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}
