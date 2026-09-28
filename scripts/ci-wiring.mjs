export function checkCiWiring(workflow) {
  const problems = [];
  const pushBranches = workflow.match(/^  push:\s*\r?\n\s+branches:\s*\[([^\]]+)\]/m);
  const branches = pushBranches?.[1].split(',').map((branch) => branch.trim()) ?? [];
  if (!branches.includes('test')) {
    problems.push('CI 的 push 触发分支缺少 test');
  }

  let inFullGates = false;
  const fullGatesLines = [];
  for (const line of workflow.split(/\r?\n/)) {
    const job = /^  ([\w-]+):\s*$/.exec(line);
    if (job) {
      inFullGates = job[1] === 'full-gates';
      continue;
    }
    if (inFullGates) fullGatesLines.push(line);
  }
  if (fullGatesLines.length === 0) {
    problems.push('CI 缺少 full-gates job');
  } else if (!fullGatesLines.some((line) => /^\s+- run: npm run verify:all\s*$/.test(line))) {
    problems.push('full-gates job 没有实际执行 npm run verify:all');
  }

  /*
   * ⚠️ **2026-09-28 加：full-gates 必须在 verify:all 之前 build。**
   *
   * `verify:all` 第 4 步 `npm run verify` **打在 `dist` 上**，而 CI 是全新
   * checkout——没有 `dist`。实测把 `dist` 移走再跑 `verify`，**退出码 2**。
   *
   * 也就是说：**`full-gates` 这个 job 从被加上那天起就是红的。**
   * 它一直没被发现，是因为没人推过那个分支——
   * **「接了线」不等于「线通了」**，要问的是「它跑起来是什么结果」。
   *
   * ⚠️ 判据是「在 `verify:all` 那一步**之前**存在一次 build」，
   * 不是「文件里出现过 build」——顺序反了同样会红。
   */
  if (fullGatesLines.length > 0) {
    const verifyAllAt = fullGatesLines.findIndex((l) => /^\s+- run: npm run verify:all\s*$/.test(l));
    /*
     * ⚠️ **两种写法都要认**：`- run: npm run build`（行内式）
     * 与 `- name: …\n  run: npm run build`（带名字式）。
     * 第一版只认前者，于是「文件里明明有 build」被判成没有——
     * **判据自己红了，而被测对象是对的**。那正是最坏的一种失败。
     */
    const buildAt = fullGatesLines.findIndex((l) => /^\s*(?:- run: |run: )npm run build\s*$/.test(l));
    if (verifyAllAt >= 0 && buildAt < 0) {
      problems.push(
        'full-gates job 在 `verify:all` 之前没有 build，而 `verify:all` 第 4 步 `npm run verify` '
        + '**打在 `dist` 上**——全新 checkout 里没有产物，那一步必然红（实测退出码 2）。',
      );
    } else if (verifyAllAt >= 0 && buildAt > verifyAllAt) {
      problems.push('full-gates job 的 build 排在 `verify:all` 之后——顺序不对，等于没 build。');
    }
  }
  return problems;
}
