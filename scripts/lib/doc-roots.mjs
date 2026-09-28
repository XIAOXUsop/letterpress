/**
 * **「哪些文件算文档」只有这一份清单。**
 *
 * ⚠️ **2026-09-28 抽出来的。** 它此前是**两份逐字相同的拷贝**：
 * `check-doc-refs.mjs` 的 `DOC_GLOBS` 与 `check-anchor-links.mjs` 的 `ROOTS`
 * （变量名不同、值一模一样），各自决定「扫哪些文档」。
 *
 * > 同一类缺陷的第四次：两份实现不同步时**不报错**，
 * > 而是「两道门禁扫了不同的东西」——而**两边都是绿的**。
 * > 本仓库已经吃过：frontmatter 两套解析、`urlFor` 与 remark 各写一份前缀、
 * > `related` 方括号处理不一致、`readContentDirs` 与 `readContentPage` 各算一遍。
 *
 * 为什么值得抽：**漂开的后果不是某道门禁失效，是「文档里提到的东西」有两套定义**，
 * 而读者只会看到其中一道的结论。
 */

/** 文档根。相对仓库根。 */
export const DOC_ROOTS = ['README.md', 'AGENTS.md', 'docs', 'src/content'];
