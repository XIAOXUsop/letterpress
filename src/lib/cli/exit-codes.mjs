#!/usr/bin/env node
/**
 * 面向用户的 CLI 的**稳定错误码**。
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 路线图阶段 4 第 3 项：「CLI 提供**稳定错误码**、JSON 输出和迁移命令」。
 *
 * 2026-09-24 实测：4 个 CLI 共 14 处非零退出，用的只有 `1` 和 `2`，
 * 而语义至少分 5 类：
 *
 * | 曾经的码 | 实际语义 | 处数 |
 * |---|---|---|
 * | 2 | 用法错（没给参数） | 2 |
 * | 1 | 环境错（读不到目录 / 网络失败） | 4 |
 * | 1 | 内容为空（语料 / 来源登记为零） | 3 |
 * | 1 | 查无此项（slug / sourceId / revision 不存在） | 3 |
 * | 1 | **内部不变式被破坏**（三组重叠） | 1 |
 *
 * 最后那类最要紧：它意味着**实现出错了**，却和「用户拼错参数」共用 `exit(1)`——
 * 消费方无法区分「我该改用法」和「这个工具坏了」。
 *
 * ── 码的分配原则 ────────────────────────────────────────────────────
 *
 * - **2–9**：人可读、可记忆，一个语义一个码。
 * - **沿用既有惯例**：`2` 保持「用法错」（POSIX 工具的通用约定，改它会破坏习惯）。
 * - **1 不再表示「任何失败」**：它是「未归类的失败」，
 *   **每个具体出口都必须挑一个具体码**——于是「漏归类」会表现为退化成 1，可被发现。
 * - **≥10 留给未来**，且要占满整段（不与 2–9 混）。
 *
 * ⚠️ **稳定性的含义**：这些码一旦发布就**不再改**——
 * 消费方会把它们写进 `case` 分支。改一个码等于破坏它们。
 * 所以本文件只在**新增语义**时加码，不重排、不复用已废弃的码。
 * 要废弃某个语义时，**保留码并注明「已废弃」**，让它继续被解析。
 *
 * 用法：`node src/lib/cli/exit-codes.mjs`
 */

// ── 码表 ────────────────────────────────────────────────────────────

/** 成功。 */
export const EXIT_OK = 0;

/**
 * 未归类的失败。
 *
 * ⚠️ **它不该被主动使用**——每个出口都该挑一个具体码。
 * 保留它是因为：`process.exit(1)` 一旦漏到某处，退出码仍是 1，
 * **而具体码缺失会表现为「退化成 1」**，比崩溃更容易被忽略。
 * 这条约定由 `check-exit-codes.mjs` 守。
 */
export const EXIT_UNSPECIFIED = 1;

/** 用法错：缺少必需参数、参数格式不对。沿用 POSIX 惯例。 */
export const EXIT_USAGE = 2;

/** 环境错：目录读不到、网络不可达、目标不可写。 */
export const EXIT_ENVIRONMENT = 3;

/** 语料为空：没有可检索的条目、没有已登记的来源。 */
export const EXIT_EMPTY_INPUT = 4;

/** 查无此项：slug / sourceId / revision 不存在。 */
export const EXIT_NOT_FOUND = 5;

/**
 * **内部不变式被破坏**（本工具自己的 bug）。
 *
 * 单独一类：它意味着「问题不在你，在实现」，
 * 消费方（例如 CI 包装脚本）应当**报 bug 而不是提示改用法**。
 * 目前唯一用到它的是 `wiki:impact` 的「三组必须互不重叠」检查。
 */
export const EXIT_INVARIANT = 6;

/** 码 → 语义。供文档与自检使用。 */
export const EXIT_MEANINGS = Object.freeze({
  [EXIT_OK]: '成功',
  [EXIT_UNSPECIFIED]: '未归类的失败（**不该主动使用**）',
  [EXIT_USAGE]: '用法错：缺少必需参数或参数格式不对',
  [EXIT_ENVIRONMENT]: '环境错：目录读不到、网络不可达、目标不可写',
  [EXIT_EMPTY_INPUT]: '语料为空：没有可检索的条目或已登记的来源',
  [EXIT_NOT_FOUND]: '查无此项：slug / sourceId / revision 不存在',
  [EXIT_INVARIANT]: '内部不变式被破坏（本工具的 bug，不是用法问题）',
});

// ── 使用方式 ────────────────────────────────────────────────────────

/**
 * 打印一条机器可读的错误并退出。
 *
 * ⚠️ **人类可读信息与机器可读信息是同一条输出**，不分两处：
 * 分成 stdout/stderr 两条会让「重定向到文件后才知道错在哪」，
 * 而 CLI 的错误信息本来就是给人读的。
 * `--json` 模式另说——那时才需要结构化，见 `wiki:ask --json`。
 */
export function failWith(code, message, extra = {}) {
  if (!Object.prototype.hasOwnProperty.call(EXIT_MEANINGS, code)) {
    // 出口用了没登记的码：这是**本文件的 bug**，必须显式说出来而不是静默用 1
    throw new Error(`未登记的退出码 ${code}——先在 exit-codes.mjs 里登记它`);
  }
  if (code === EXIT_OK) {
    throw new Error('failWith 不能用 0 表示失败');
  }
  if (code === EXIT_UNSPECIFIED) {
    throw new Error(
      '不要用 EXIT_UNSPECIFIED：请挑一个具体码。' +
        '若确实是「以前没归类过的失败」，先在 EXIT_MEANINGS 里给它一个位置。',
    );
  }
  console.error(message);
  if (Object.keys(extra).length > 0) {
    console.error(JSON.stringify(extra, null, 2));
  }
  process.exit(code);
}

/** 给人看的码表，自检时用。 */
export function describeExitCodes() {
  return Object.entries(EXIT_MEANINGS)
    .map(([code, meaning]) => `  ${String(code).padStart(2)}  ${meaning}`)
    .join('\n');
}
