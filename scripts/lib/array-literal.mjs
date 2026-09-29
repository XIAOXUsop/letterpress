/**
 * 共用的名值解析器——**「`const X = [` 」这个字符串在文件里可能不止一处**，
 * 而取到错误的那一处**不会报错，只会量出一个看似合法的数**。
 *
 * ⚠️⚠️ **2026-09-29 踩到的就是这一条，本项目栽过同族三次。**
 *
 * 本文件里 `GATE_COUNT` 那个辅助函数的**函数体**写着
 * `src.indexOf('const GATES = [')`——**而那是个字符串字面量**。
 * 于是 `indexOf` 找到的是**它自己**（第 125 行），
 * 而不是第 533 行那个真正的 `const GATES = [` 声明。
 *
 * > **「取到了」与「取到的是那一处」在输出上完全一样**——
 * > 而量出来的 20 是个**完全合法的数**，所以没有任何东西会拦它。
 *
 * ⚠️ **而 `MUT_COUNT` 早就知道这件事**——它用的是 `lastIndexOf`，
 * 注释里写着「这段自省代码自己就含 `const CASES = [`」。
 * **同一个陷阱在同一个文件里有两处，一处记着，一处没记。**
 *
 * 所以这里**不猜**：从**文件末尾**找最后一个 `const <名字> = [`，
 * 并在自省处打印**行号**——行号对不上时要立刻能看出来。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 从 `file` 里切出**最后一个** `const <name> = [` 到其配对的 `\n];` 之间的正文。
 *
 * ⚠️ **用 `lastIndexOf` 而不是 `indexOf`**：声明总在被测者之后，
 * 而自省代码在前面（且自省代码里**必然**含这个字符串字面量）。
 *
 * @param {string} file   相对仓库根的路径
 * @param {string} name   变量名
 * @returns {{ body: string, at: number, line: number } | null}
 */
export function sliceArrayLiteral(file, name) {
  const src = readFileSync(join(process.cwd(), file), 'utf8');
  const marker = `const ${name} = [`;
  const start = src.lastIndexOf(marker);
  if (start < 0) return null;
  const end = src.indexOf('\n];', start);
  if (end < 0) return null;
  return {
    body: src.slice(start, end),
    at: start,
    line: src.slice(0, start).split('\n').length,
  };
}
