/**
 * 面向机器的 CLI 输出。
 *
 * ── 为什么 ──────────────────────────────────────────────────────────
 *
 * 路线图阶段 4 第 3 项：「CLI 提供稳定错误码、**JSON 输出**和迁移命令」。
 * 错误码（迭代 AM）与迁移命令（迭代 AN）已做，**JSON 输出还欠着**。
 *
 * 2026-09-24 实测缺口：`wiki-ask --json` 在**成功时**输出结构化数据，
 * 但**失败时 stdout 完全为空**——错误只出现在 stderr 的人话里，
 * 而消费方能拿到的只有退出码。
 *
 * > 退出码能回答「哪一类失败」，回答不了「**什么**失败了」与
 * > 「**能怎么改**」。于是消费方要么解析中文句子（脆），
 * > 要么只能显示一句「命令失败了」。
 *
 * ── 形状为什么这样定 ────────────────────────────────────────────────
 *
 * 判据是「**消费方要区分什么**」，不是「我觉得该有哪些字段」：
 *
 * | 消费方要做的判断 | 靠哪个字段 |
 * |---|---|
 * | 是「我用法错了」还是「工具坏了」 | `error.code`（与退出码同一个数） |
 * | 给人看的一句话 | `error.message` |
 * | 能不能自己修（比如换个 slug） | `error.hint` |
 * | 「还有哪些值合法」 | `error.valid`（可选数组） |
 *
 * `ok` 字段是为了**让消费方不必先看进程退出码**——
 * 很多运行时会丢掉退出码（容器、某些 CI 包装），
 * 而 stdout 里的 JSON 总是拿得到的。
 *
 * ⚠️ **成功时也带 `ok`**，形状固定。消费方写
 * `const r = JSON.parse(out); if (!r.ok) …` 就能覆盖两种情况，
 * **不必在解析前先判断这次是不是成功**。
 *
 * ── 输出到哪 ────────────────────────────────────────────────────────
 *
 * **JSON 进 stdout，人类可读信息进 stderr。** 两者不混。
 * 理由：`--json` 的使用场景就是**重定向到文件或喂给程序**，
 * 人话混进 stdout 会让 `JSON.parse` 失败——
 * 而「JSON.parse 失败」是一个**极难定位**的故障。
 *
 * 但**即使在 `--json` 模式下，人话也要照打**（只是走 stderr）：
 * 一个正在排查问题的人会直接看终端，而不是先去翻管道。
 * 让人和机器各取所需，比二选一更实用。
 */

/** 成功时的统一形状。 */
export function jsonOk(data, extra = {}) {
  return { ok: true, ...extra, ...data };
}

/** 失败时的统一形状。 */
export function jsonError(code, message, { hint, valid } = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(hint ? { hint } : {}),
      ...(valid && valid.length > 0 ? { valid } : {}),
    },
  };
}

/**
 * 按模式输出：JSON 走 stdout（单行，便于管道），人话走 stderr。
 *
 * @param {'json'|'text'} mode
 * @param {object} payload   JSON 模式下的结构化内容
 * @param {string} humanText 人类可读的一行摘要（两种模式都会打）
 */
export function emit(mode, payload, humanText) {
  if (mode === 'json') {
    // 单行：既省 token，也让 `jq` 处理更顺手
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }
  if (humanText) process.stderr.write(`${humanText}\n`);
}

/** 判断是否要 JSON 模式。`--json` 与 `--json=...` 都认。 */
export function wantsJson(args) {
  return args.some((a) => a === '--json' || a.startsWith('--json='));
}

/**
 * 输出错误并退出。**人话与 JSON 都给**，然后用同一个码退出——
 * 退出码与 `error.code` 必须一致，否则消费方两边看到的事实会打架。
 */
export function failWithJson(mode, code, message, options = {}) {
  if (mode === 'json') {
    process.stdout.write(`${JSON.stringify(jsonError(code, message, options))}\n`);
  }
  if (options.hint) process.stderr.write(`${message}\n提示：${options.hint}\n`);
  else process.stderr.write(`${message}\n`);
  process.exit(code);
}
