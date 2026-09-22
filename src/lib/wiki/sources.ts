/**
 * 来源登记表：读入、校验、以及把页面上的引用解析成可展示的投影。
 *
 * ── 它解决的问题 ────────────────────────────────────────────────────
 *
 * 在此之前，页面上的「依据」只是一串链接：**没有版本、没有定位、
 * 没有"这段话引自哪里"**。于是：
 *
 *   - 规范出了新版，没人知道哪些页面该复查（链接还是一样的）；
 *   - 读者点过去看到的是**今天的**规范，而作者读的可能是半年前那版；
 *   - 一条引用被删掉之后，无从知道它当时到底支持了哪句话。
 *
 * 登记表把「来源」从**一个 URL** 变成**一个具体版本**。
 *
 * ── 它**不做**什么 ──────────────────────────────────────────────────
 *
 * 它不判断来源里的话是否真的支持页面上的结论——那是**人工复核**的事。
 * 机械能做的只有：引用能不能解析到已登记的版本、定位字段在不在、
 * 摘录是否与登记的一致。把"有引用"说成"已证实"是这一整套东西最容易
 * 制造出来的错觉，所以每个字段的注释都在强调它证明不了什么。
 *
 * ── 为什么在 `knowledge/` 而不是 `src/content/` ─────────────────────
 *
 * 它是**作者侧的脚手架**，不是内容。放 `src/content/` 会被当成可发布的
 * 内容页；放 `public/` 会被直接拷进产物。`knowledge/` 既不是内容集合，
 * 也不进构建产物——但**它在 Git 里，是公开的**，所以只放允许公开的材料。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 一个来源的某个具体版本。 */
export interface SourceRevision {
  /** 稳定版本标识。规范用 WD 日期、仓库用提交 SHA、在线文档用 `online-<日期>`。 */
  readonly id: string;
  /** **实际取得材料的日期**，写入后固定——不是每次构建的日期。 */
  readonly capturedAt: string;
  /** 章节、页码、仓库路径等定位信息。 */
  readonly locator?: string;
  /**
   * 可核验的摘录。
   *
   * ⚠️ **它是"这段话出自哪里"的证据，不是"结论成立"的证据。**
   * 准确引用一段不支持结论的话，照样能通过所有机械检查。
   */
  readonly evidence?: string;
  /** 人工说明。不参与身份计算。 */
  readonly note?: string;
}

export interface Source {
  readonly id: string;
  readonly title: string;
  /** 先只支持实际用到的两种。加第三种之前先想清楚它的校验规则。 */
  readonly kind: 'web' | 'repository';
  readonly url: string;
  readonly revisions: readonly SourceRevision[];
}

/** 页面上一处来源引用。 */
export interface SourceRef {
  readonly sourceId: string;
  readonly revision: string;
  /** 本页具体用了这个版本的哪一段。 */
  readonly locator?: string;
}

/**
 * 读入 `knowledge/sources/*.json`。
 *
 * 目录不存在时返回空表——**关掉知识层或还没开始登记都是合法状态**，
 * 不该让构建失败。但"声明了引用却解析不到"是错误，见 `validateSourceRefs`。
 */
export function loadSources(root: string): Map<string, Source> {
  const out = new Map<string, Source>();
  let files: string[];
  try {
    files = readdirSync(root).filter((f) => f.endsWith('.json'));
  } catch {
    return out;
  }

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(root, file), 'utf8')) as Source;
    if (!raw.id) throw new Error(`${file} 缺少 id`);
    if (!Array.isArray(raw.revisions) || raw.revisions.length === 0) {
      throw new Error(`${file} 至少要有一个 revision`);
    }
    // **文件名与 id 必须一致**：否则按 id 找文件会找错，
    // 而那种错在只有几条时完全看不出来。
    if (`${raw.id}.json` !== file) {
      throw new Error(`${file} 里的 id 是 "${raw.id}"，与文件名对不上`);
    }
    out.set(raw.id, raw);
  }
  return out;
}

/**
 * 校验页面上的来源引用。
 *
 * 只查**能不能解析**：来源存在吗、版本登记过吗。不查"引用得对不对"。
 */
export function validateSourceRefs(
  where: string,
  refs: readonly SourceRef[],
  sources: ReadonlyMap<string, Source>,
): string[] {
  const problems: string[] = [];
  for (const ref of refs) {
    const source = sources.get(ref.sourceId);
    if (!source) {
      const known = [...sources.keys()].sort().join('、') || '（一个都没有）';
      problems.push(
        `${where} 引用了未登记的来源 "${ref.sourceId}"。已登记的有：${known}。`,
      );
      continue;
    }
    if (!source.revisions.some((r) => r.id === ref.revision)) {
      const known = source.revisions.map((r) => r.id).sort().join('、');
      problems.push(
        `${where} 引用了 "${ref.sourceId}" 的版本 "${ref.revision}"，但没有登记过。` +
          `已登记：${known}。`,
      );
    }
  }
  return problems;
}
