/**
 * Slug 生成。
 *
 * ── 为什么这件事值得单独一个文件 ────────────────────────────────────
 *
 * 绝大多数 slugify 实现（含 npm 上最常用的那几个）的默认行为是
 * 「删掉所有非 ASCII 字母数字」，对中文标题的产物是**空字符串**：
 *
 *     slugify('论可复现的评测')  →  ''
 *     slugify('Hello 世界')      →  'hello'
 *
 * 空 slug 会让所有中文文章塌到同一个路径上互相覆盖，而 `'Hello 世界' → 'hello'`
 * 更隐蔽：标题里信息量最大的那部分被静默丢弃，你只会在某天发现两篇文章撞车。
 *
 * 所以这里**保留 CJK 字符**。中文出现在 URL 里是合法的（百分号编码后传输），
 * 现代浏览器地址栏会显示原文，对中文读者反而比拼音更好认。
 *
 * 但保留不等于放任：`lint` 会对「中文标题 + 未显式指定 slug」的条目给出提示，
 * 因为 URL 复制出去会变成一长串 `%E8%AE%BA...`，很多博主更愿意自己指定一个
 * 英文 slug。**给默认值，同时告诉用户默认值的代价**——这是这个项目的立场。
 */

/** CJK 及相关文字系统的码点区间。这些字符在 slug 里被保留。 */
const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x3040, 0x30ff], // 日文假名
  [0x3400, 0x4dbf], // CJK 扩展 A
  [0x4e00, 0x9fff], // CJK 基本区
  [0xac00, 0xd7af], // 谚文
  [0xf900, 0xfaff], // CJK 兼容表意
];

function isCjk(code: number): boolean {
  return CJK_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

/**
 * 把标题转成 slug。
 *
 * 规则：
 * - 保留 ASCII 字母数字与 CJK 字符
 * - 其余（空格、标点、emoji、控制字符）折叠为单个连字符
 * - 首尾去连字符、连续连字符合并
 * - 截断到 80 字符，避免超长 URL
 *
 * 刻意**不做**的事：不转小写以外的规范化（不做 NFKC）。因为 NFKC 会把
 * 全角字符折叠成半角，而全角标点在中文标题里可能是有意义的。
 */
export function slugify(input: string): string {
  const out: string[] = [];
  let pendingDash = false;

  for (const char of input.normalize('NFC')) {
    const code = char.codePointAt(0) ?? 0;

    const keep =
      (code >= 0x30 && code <= 0x39) || // 0-9
      (code >= 0x61 && code <= 0x7a) || // a-z
      (code >= 0x41 && code <= 0x5a) || // A-Z
      isCjk(code);

    if (keep) {
      if (pendingDash && out.length > 0) out.push('-');
      pendingDash = false;
      out.push(String.fromCodePoint(code).toLowerCase());
    } else {
      // 折叠空白与标点，但不立即写出，避免末尾留下连字符
      pendingDash = out.length > 0;
    }
  }

  const slug = out.join('');
  // 截断时不要在半个字符上切：CJK 在 UTF-16 里是单码元，但 emoji 不是，
  // 用 Array.from 按码点切分更稳。
  const truncated = Array.from(slug).slice(0, 80).join('');
  return truncated.replace(/-+$/, '');
}

/**
 * 决定最终路径片段。优先级：**显式 slug > 文件名 > 标题**。
 *
 * - **显式 slug 最优先**：用户写下的东西不该被机器覆盖。
 * - **文件名次之**：这是 Hugo / Jekyll / Astro 的通行行为，也是最不意外的——
 *   作者给文件起名 `markdown-for-agents.md` 时，他要的就是这个 URL。
 *   而且它顺带解决了中文标题的问题：文件名用英文，URL 就是英文。
 * - **标题兜底**：文件名拿不出有效 slug 时（比如全是标点），才退回标题。
 *
 * 注意 `filename` 传的是**不含扩展名的路径片段**，可以带目录分隔符，
 * 分隔符会被折叠成连字符。
 */
export function resolveSlug(
  title: string,
  explicit?: string | null,
  filename?: string | null,
): string {
  if (explicit !== undefined && explicit !== null && explicit.trim() !== '') {
    return slugify(explicit);
  }
  if (filename !== undefined && filename !== null && filename.trim() !== '') {
    const fromFile = slugify(filename);
    if (fromFile !== '') return fromFile;
  }
  return slugify(title);
}

/** slug 是否含有 CJK 字符。用于 lint 给出「URL 会变长」的提示。 */
export function containsCjk(slug: string): boolean {
  for (const char of slug) {
    if (isCjk(char.codePointAt(0) ?? 0)) return true;
  }
  return false;
}
