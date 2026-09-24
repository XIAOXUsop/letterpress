/**
 * Letterpress 内容镜像同步器的纯逻辑。
 *
 * 首次同步消费 NDJSON，避免 N+1；后续读取 manifest，只下载 hash 变化的正文。
 * 每次都在同级临时目录构建完整新镜像，成功后才替换旧目录，避免网络中断留下
 * “状态文件是旧的、正文却改了一半”的不可恢复状态。
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, parse, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';

const STATE_FORMAT = 'letterpress-sync-state';
const STATE_VERSION = 1;
const MANIFEST_FORMAT = 'letterpress-content-manifest';
/**
 * 支持的 manifest 版本。**从源码里读，不在这里写死。**
 *
 * ⚠️ 2026-09-24 实测这里是 `1`，而生产端早已升到 `2`
 * （提交 2518438 加 `provenance` 时一并升的）。
 * 结果是：**同步器对着本站自己的清单必然报「不支持的版本」**。
 *
 * > 而 453 条测试全绿——因为测试固件也写着 `version: 1`。
 * > **同一个事实被写了两遍，其中一遍错了，而两遍都没有对另一遍的检查。**
 *
 * 现在改成从 `src/lib/content-manifest.ts` 读源码文本：
 * 那份文件内部用 `.js` 后缀 import，**裸 Node 加载不了**
 * （见 `check-portability.mjs` 里的说明），所以只能读文本——
 * 这与 `check-formats.mjs` 已有做法一致。
 *
 * **读不到就抛错，绝不退回任何写死的值**：
 * 退回一个值等于把这个 bug 原样藏起来。
 */
const MANIFEST_VERSION = readManifestVersion();

function readManifestVersion() {
  const file = join(import.meta.dirname, '..', '..', 'src', 'lib', 'content-manifest.ts');
  const text = readFileSync(file, 'utf8');
  const matched = /CONTENT_MANIFEST_VERSION\s*=\s*(\d+)/.exec(text)?.[1];
  if (!matched) {
    throw new Error(
      `从 ${file} 里读不出 CONTENT_MANIFEST_VERSION。` +
        `同步器需要知道本站发的是哪一版清单，而**猜一个比不知道更糟**。`,
    );
  }
  return Number(matched);
}

const RECORD_FORMAT = 'letterpress-content-record';
const RECORD_VERSION = 1;
const STATE_FILE = '.letterpress-sync.json';
const LOCAL_MANIFEST = 'content-manifest.json';
const DOCUMENTS_DIR = 'documents';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizeOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`无效的站点地址：${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`站点地址只支持 HTTP(S)：${value}`);
  }
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/+$/, '');
}

function documentFile(id) {
  if (typeof id !== 'string' || !/^(?:post|wiki):\S+$/.test(id)) {
    throw new Error(`无效的文档 ID：${String(id)}`);
  }
  // 整个 ID 编码成单个文件名；斜杠、反斜杠、冒号与 `..` 都无法逃出 documents/。
  return `${encodeURIComponent(id)}.md`;
}

function assertHexDigest(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} 缺少合法的 SHA-256。`);
  }
}

function assertDocument(document) {
  documentFile(document?.id);
  if (document.kind !== 'post' && document.kind !== 'wiki') {
    throw new Error(`${document.id} 的 kind 无效。`);
  }
  if (typeof document.slug !== 'string' || document.slug.length === 0) {
    throw new Error(`${document.id} 缺少 slug。`);
  }
  if (typeof document.title !== 'string' || typeof document.summary !== 'string') {
    throw new Error(`${document.id} 缺少标题或摘要。`);
  }
  if (typeof document.urls?.html !== 'string' || typeof document.urls?.markdown !== 'string') {
    throw new Error(`${document.id} 缺少 HTML 或 markdown URL。`);
  }
  if (!Array.isArray(document.tags)) throw new Error(`${document.id} 的 tags 无效。`);
  if (
    !Array.isArray(document.relations?.outgoing) ||
    !Array.isArray(document.relations?.backlinks)
  ) {
    throw new Error(`${document.id} 的链接关系无效。`);
  }
  if (document.markdown?.mediaType !== 'text/markdown') {
    throw new Error(`${document.id} 的 markdown mediaType 无效。`);
  }
  if (!Number.isSafeInteger(document.markdown.bytes) || document.markdown.bytes < 0) {
    throw new Error(`${document.id} 的 markdown bytes 无效。`);
  }
  assertHexDigest(document.markdown.sha256, document.id);
}

function assertManifest(manifest) {
  if (manifest?.format !== MANIFEST_FORMAT || manifest?.version !== MANIFEST_VERSION) {
    throw new Error(`不支持的内容清单格式或版本。`);
  }
  if (!Array.isArray(manifest.documents)) throw new Error('内容清单缺少 documents。');
  if (manifest.documentCount !== manifest.documents.length) {
    throw new Error('内容清单的 documentCount 与实际条目数不一致。');
  }
  if (typeof manifest.site?.home !== 'string') throw new Error('内容清单缺少 site.home。');

  const seen = new Set();
  let previous = '';
  for (const document of manifest.documents) {
    assertDocument(document);
    if (seen.has(document.id)) throw new Error(`内容清单存在重复 ID：${document.id}`);
    if (previous && previous > document.id) throw new Error('内容清单没有按 ID 稳定排序。');
    seen.add(document.id);
    previous = document.id;
  }
}

function verifyBytes(bytes, expected, id) {
  if (bytes.byteLength !== expected.bytes) {
    throw new Error(`${id} 的 UTF-8 字节数不匹配：${bytes.byteLength} != ${expected.bytes}`);
  }
  const digest = sha256(bytes);
  if (digest !== expected.sha256) throw new Error(`${id} 的 SHA-256 不匹配。`);
  // hash 对得上仍不代表是合法 UTF-8；下游按 Markdown 文本消费，必须明确拒绝坏字节。
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function fetchOk(fetchImpl, url, accept) {
  const response = await fetchImpl(url, { headers: { Accept: accept } });
  if (!response.ok) throw new Error(`请求失败 ${response.status}：${url}`);
  return response;
}

function endpoint(origin, name) {
  return `${origin}/${name}`;
}

function resolveMarkdownUrl(origin, manifest, document) {
  const home = new URL(manifest.site.home, `${origin}/`);
  const target = new URL(document.urls.markdown, home);
  const homeHref = home.href.endsWith('/') ? home.href : `${home.href}/`;
  if (!target.href.startsWith(homeHref)) {
    throw new Error(`${document.id} 的 markdown URL 逃出了站点根：${target.href}`);
  }
  const relative = target.href.slice(homeHref.length);
  return new URL(relative, `${origin}/`).href;
}

async function readOwnedState(output, origin) {
  let entries;
  try {
    entries = await readdir(output);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (entries.length === 0) return null;

  let state;
  try {
    state = JSON.parse(await readFile(join(output, STATE_FILE), 'utf8'));
  } catch {
    throw new Error(`输出目录非空且没有可读取的 ${STATE_FILE}，拒绝覆盖：${output}`);
  }
  if (state?.format !== STATE_FORMAT || state?.version !== STATE_VERSION) {
    throw new Error(`输出目录不是受支持的 Letterpress 镜像：${output}`);
  }
  if (state.source !== origin) {
    throw new Error(`镜像属于 ${state.source}，拒绝改用 ${origin} 覆盖。`);
  }
  if (!Array.isArray(state.documents)) throw new Error('镜像状态缺少 documents。');
  const seen = new Set();
  for (const document of state.documents) {
    const expectedFile = `${DOCUMENTS_DIR}/${documentFile(document?.id)}`;
    if (seen.has(document.id)) throw new Error(`镜像状态存在重复 ID：${document.id}`);
    if (!Number.isSafeInteger(document.bytes) || document.bytes < 0) {
      throw new Error(`镜像状态中 ${document.id} 的 bytes 无效。`);
    }
    assertHexDigest(document.sha256, `镜像状态中的 ${document.id}`);
    if (document.file !== expectedFile) throw new Error(`镜像状态中 ${document.id} 的文件路径无效。`);
    seen.add(document.id);
  }
  return state;
}

function stateFor(origin, manifest) {
  return {
    format: STATE_FORMAT,
    version: STATE_VERSION,
    source: origin,
    documents: manifest.documents.map((document) => ({
      id: document.id,
      bytes: document.markdown.bytes,
      sha256: document.markdown.sha256,
      file: `${DOCUMENTS_DIR}/${documentFile(document.id)}`,
    })),
  };
}

async function writeMetadata(stage, origin, manifest) {
  await writeFile(join(stage, LOCAL_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(join(stage, STATE_FILE), `${JSON.stringify(stateFor(origin, manifest), null, 2)}\n`, 'utf8');
}

async function replaceDirectory(stage, output) {
  const backup = `${output}.backup-${randomUUID()}`;
  let hadOutput = false;
  try {
    await stat(output);
    hadOutput = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (hadOutput) await rename(output, backup);
  try {
    await rename(stage, output);
  } catch (error) {
    if (hadOutput) {
      try {
        await rename(backup, output);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `新镜像安装失败，旧镜像保留在 ${backup}，请人工恢复。`,
        );
      }
    }
    throw error;
  }
  // 新镜像已经就位后，旧备份清理失败不应把一次成功同步报告成失败。
  // 极少数文件锁场景只会留下一个可人工删除的 backup，不会破坏新旧任一镜像。
  if (hadOutput) await rm(backup, { recursive: true, force: true }).catch(() => {});
}

async function readInitialExport(fetchImpl, origin, documentsDir) {
  const response = await fetchOk(fetchImpl, endpoint(origin, 'content.ndjson'), 'application/x-ndjson');
  if (!response.body) throw new Error('content.ndjson 没有响应正文。');

  const lines = createInterface({ input: Readable.fromWeb(response.body), crlfDelay: Infinity });
  const documents = [];
  const seen = new Set();
  let site = null;

  for await (const line of lines) {
    // NDJSON 1.0 允许解析器选择忽略空行；本同步器明确采用忽略策略。
    if (!line) continue;
    const record = JSON.parse(line);
    if (record?.format !== RECORD_FORMAT || record?.version !== RECORD_VERSION) {
      throw new Error('content.ndjson 包含不支持的记录格式或版本。');
    }
    if (seen.has(record.id)) throw new Error(`content.ndjson 存在重复 ID：${record.id}`);
    seen.add(record.id);

    const { format: _format, version: _version, site: recordSite, content, ...metadata } = record;
    const document = { ...metadata, markdown: { ...content } };
    delete document.markdown.text;
    assertDocument(document);
    if (!recordSite || typeof recordSite.home !== 'string') throw new Error(`${record.id} 缺少 site。`);
    if (site && JSON.stringify(site) !== JSON.stringify(recordSite)) {
      throw new Error('content.ndjson 的记录包含不一致的站点元数据。');
    }
    site = recordSite;

    if (typeof content?.text !== 'string') throw new Error(`${record.id} 缺少正文。`);
    const bytes = Buffer.from(content.text, 'utf8');
    verifyBytes(bytes, document.markdown, record.id);
    await writeFile(join(documentsDir, documentFile(record.id)), bytes);
    documents.push(document);
  }

  if (documents.length === 0) return { site: null, documents: [] };
  return {
    site,
    documents,
  };
}

function assertExportMatchesManifest(exported, manifest) {
  if (exported.documents.length !== manifest.documents.length) {
    throw new Error(
      `content.ndjson 记录数与 manifest 不一致：${exported.documents.length} != ${manifest.documents.length}`,
    );
  }
  if (exported.site && JSON.stringify(exported.site) !== JSON.stringify(manifest.site)) {
    throw new Error('content.ndjson 的站点元数据与 manifest 不一致。');
  }
  for (const [index, document] of exported.documents.entries()) {
    if (JSON.stringify(document) !== JSON.stringify(manifest.documents[index])) {
      throw new Error(`content.ndjson 与 manifest 的第 ${index + 1} 条记录不一致。`);
    }
  }
}

async function fetchManifest(fetchImpl, origin) {
  const response = await fetchOk(fetchImpl, endpoint(origin, 'content-manifest.json'), 'application/json');
  const manifest = await response.json();
  assertManifest(manifest);
  // 不允许清单把同步器变成任意 URL 抓取器；所有正文都必须位于清单声明的站点根下。
  for (const document of manifest.documents) resolveMarkdownUrl(origin, manifest, document);
  return manifest;
}

/**
 * 同步一个公开 Letterpress 站点到本地镜像目录。
 */
export async function syncContent({ origin: originInput, output: outputInput, fetchImpl = fetch }) {
  const origin = normalizeOrigin(originInput);
  if (typeof outputInput !== 'string' || outputInput.trim() === '') {
    throw new Error('必须显式提供输出目录。');
  }
  const output = resolve(outputInput);
  const root = parse(output).root;
  if (output === root || output === resolve('.')) {
    throw new Error(`拒绝把文件系统根目录或当前工作目录作为镜像目录：${output}`);
  }

  const previousState = await readOwnedState(output, origin);
  const previousById = new Map((previousState?.documents ?? []).map((item) => [item.id, item]));
  const parent = dirname(output);
  const stage = join(parent, `.${basename(output)}.staging-${randomUUID()}`);
  await mkdir(join(stage, DOCUMENTS_DIR), { recursive: true });

  const counts = { added: 0, updated: 0, repaired: 0, unchanged: 0, deleted: 0 };
  try {
    let manifest;
    if (!previousState) {
      const exported = await readInitialExport(fetchImpl, origin, join(stage, DOCUMENTS_DIR));
      // 第二个请求只取小型清单，用它检测 NDJSON 在完整记录边界被截断的情况。
      // 这仍然是固定 2 个请求，而不是“清单 + 每篇正文”的 N+1。
      manifest = await fetchManifest(fetchImpl, origin);
      assertExportMatchesManifest(exported, manifest);
      counts.added = manifest.documents.length;
    } else {
      manifest = await fetchManifest(fetchImpl, origin);
      for (const document of manifest.documents) {
        const old = previousById.get(document.id);
        const target = join(stage, DOCUMENTS_DIR, documentFile(document.id));
        const source = join(output, DOCUMENTS_DIR, documentFile(document.id));

        if (old?.sha256 === document.markdown.sha256 && old?.bytes === document.markdown.bytes) {
          try {
            const local = await readFile(source);
            verifyBytes(local, document.markdown, document.id);
            await copyFile(source, target);
            counts.unchanged += 1;
            continue;
          } catch {
            counts.repaired += 1;
          }
        } else if (old) {
          counts.updated += 1;
        } else {
          counts.added += 1;
        }

        const url = resolveMarkdownUrl(origin, manifest, document);
        const response = await fetchOk(fetchImpl, url, 'text/markdown');
        const bytes = Buffer.from(await response.arrayBuffer());
        verifyBytes(bytes, document.markdown, document.id);
        await writeFile(target, bytes);
      }
      counts.deleted = [...previousById.keys()].filter(
        (id) => !manifest.documents.some((document) => document.id === id),
      ).length;
    }

    await writeMetadata(stage, origin, manifest);
    await replaceDirectory(stage, output);
    return { origin, output, documentCount: manifest.documentCount, ...counts };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
