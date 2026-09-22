/**
 * 语义正文摘要（content digest）。
 *
 * ── 它是用来回答一个具体问题的 ──────────────────────────────────────
 *
 * 「这条内容**这次**被复核过，但复核之后正文改了吗？」
 *
 * 没有它的话，"已复核"会变成一个**永久绿色标记**：作者改了正文，
 * 页面上仍写着「已复核于 2026-09-01」。读者看到的是一个已经不成立的承诺，
 * 而没有任何东西会提醒任何人。
 *
 * 有了它：复核记录里存下当时的摘要，每次构建现算一次，**对不上就是 stale**。
 *
 * ── 摘要覆盖什么、不覆盖什么 ────────────────────────────────────────
 *
 * 覆盖（改了就该重新复核）：
 *   - `kind`：同一个标题从 concept 改成 synthesis，是实质变化
 *   - `title`、`summary`：对外呈现的结论
 *   - `body`：正文
 *   - `declaredRelations`：声明的关系是内容的一部分
 *
 * **不覆盖**（改了不该触发重新复核）：
 *   - `slug`：URL 可以演化，知识身份不该因此断裂。改 slug 是搬家，不是改内容。
 *   - `draft`、`explicitSlug`：发布状态与 URL 选择，不是内容
 *   - 将来会有的 `review` 字段本身——**自引用**：把复核结果算进摘要，
 *     会让"标记已复核"这个动作本身改变摘要，于是永远对不上
 *
 * ── 归一化是必须的，不是讲究 ────────────────────────────────────────
 *
 * 同一段内容在不同环境下的字节可能不同，而摘要要跨环境可比：
 *
 *   - **行尾统一成 LF**：Windows 检出的是 CRLF，Linux 是 LF。
 *     不归一化的话，同一次提交在两台机器上算出两个摘要，
 *     CI 上永远是 stale 而本地永远不是。
 *   - **Unicode 归一成 NFC**：中文有组合字符与预组合字符两种写法，
 *     肉眼完全一样。
 *   - **关系排序**：`related: [a, b]` 与 `related: [b, a]` 语义相同。
 *     不排序的话，调换顺序会误判成内容变更。
 */

import { createHash } from 'node:crypto';
import type { Doc } from './graph.js';

/** 行尾统一成 LF。CRLF 与 CR 都收进来。 */
function toLf(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * 计算一条文档的语义正文摘要。
 *
 * 返回完整的 sha256 十六进制串。**不截断**——截断会提高碰撞概率，
 * 而这个值要用来判断"内容变没变"，碰撞的后果是"改了却说没改"，
 * 正是它要防的那件事。要短标识就在展示层截。
 */
export function contentDigest(doc: Doc): string {
  /*
   * 用**带标签的行**而不是 JSON：JSON 的键序、空格、转义规则都可能随
   * 实现变化，而这个值必须永远算出同一个结果。行格式没有这些自由度，
   * 而且出问题时 `diff` 一眼能看出是哪个字段变了。
   *
   * 分隔符用换行——正文里本来就有换行，所以字段边界靠**标签**区分，
   * 不靠分隔符唯一。这足够：`title:` 开头的行与 `body:` 开头的行
   * 不会混淆，因为每个字段的行首标签是固定的。
   */
  const canonical = [
    `kind:${doc.kind}`,
    `title:${toLf(doc.title).normalize('NFC')}`,
    `summary:${toLf(doc.summary).normalize('NFC')}`,
    `body:${toLf(doc.body).normalize('NFC')}`,
    // 排序去重：关系的**集合**才是语义，写的顺序不是
    `related:${[...new Set(doc.declaredRelations ?? [])].sort().join(',')}`,
  ].join('\n');

  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
