/**
 * **命令名 → 脚本文件名。**
 *
 * ── 为什么需要这张表 ────────────────────────────────────────────────
 *
 * 2026-09-28 实测：48 个单文件脚本的命令里，**8 个的命令名与脚本名对不上**。
 * 照着命令名去 `grep` 脚本会落空——**我今天因此 ENOENT 了两次**。
 *
 * 它不是 bug（`npm run` 照常工作），但它让一种**很常见的查法**失效：
 * 「这条门禁的判据在哪写的」。而这种查法在审计时天天用。
 *
 * ── 三种成因，处置不同 ──────────────────────────────────────────────
 *
 * | 类型 | 例 | 处置 |
 * |---|---|---|
 * | **有意** | `verify:only` → `bundle-and-verify.mjs` | 保留，它表达「只跑契约」这个意图 |
 * | **前缀不同** | `verify:gates` → `check-gate-list.mjs` | 保留，表里登记 |
 * | **历史漂移** | `check:anchors` → `check-anchor-links.mjs` | 保留，表里登记 |
 *
 * ⚠️ **不要「顺手把文件名改成命令名」**——那要同时动引用、CI、文档，
 * 而收益仅仅是让一种查法好走。**登记 + 让门禁守住**，成本低一个数量级。
 *
 * ⚠️ **这张表也必须被核对**：它今天就是「同一份事实写两遍」——
 * `package.json` 里有一份「命令 → 脚本」，这里又有一份。
 * 所以 `scripts/check-gate-list.mjs` 有一条断言：
 * **表里每一条都必须与 `package.json` 逐字一致**，
 * 而**没登记在表里的分叉就是漏登记**。
 * 见 `check-command-scripts.mjs`——它专治这件事。
 */

/**
 * 只需要登记**对不上**的：对得上的由命名规律直接推出来。
 *
 * ⚠️ 「对得上」的判据是**脚本名包含命令名去掉前缀后的词**，
 * 也就是探针 `tmp-naming.mjs` 用过的那个口径。
 * 换口径的话，这里与 `check-command-scripts.mjs` 要同步改。
 */
export const NAME_DIVERGENCE = [
  // 有意：它是 verify 的别名，脚本名是「构建并验证」这个动作
  ['verify:only', 'scripts/bundle-and-verify.mjs', '**`verify` 的别名**——刻意不同名以表达「只跑契约」'],
  // 前缀差：命令叫「门禁编排」，脚本叫「检查门禁清单」，是同一个东西的两种叫法
  ['verify:gates', 'scripts/check-gate-list.mjs', '同一件事的两种叫法（编排 vs 清单）'],
  ['verify:testcount', 'scripts/check-test-count.mjs', 'verify vs check 的前缀差'],
  // 历史漂移：verify:anchors（产物里的锚点契约）与 check:anchors（文档里的锚点链接）是两回事
  ['check:anchors', 'scripts/check-anchor-links.mjs', '**与 `verify:anchors` 是两回事**——那个验产物，这个验文档'],
  // 以下四条是同一规律：verify:X-mutations ↔ X.mutations.mjs
  ['verify:site-mutations', 'scripts/site-agnostic.mutations.mjs', '`verify:X-mutations` ↔ `X.mutations.mjs`'],
  ['verify:new-gates-mutations', 'scripts/new-gates.mutations.mjs', '同上'],
  ['verify:json-mutations', 'scripts/json-output.mutations.mjs', '同上'],
  ['verify:second-site-real-mutations', 'scripts/second-site-real.mutations.mjs', '同上'],
];
