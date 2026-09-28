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
   * ⚠️ **不要加「full-gates 必须在 verify:all 之前 build」这条判据。**
   *
   * 2026-09-28 我加过，理由是「`verify:all` 第 4 步 `npm run verify`
   * 打在 `dist` 上，而 CI 是全新 checkout」。**那个理由是错的**——
   * `package.json` 里 `verify` = `clean && build && node scripts/bundle-and-verify.mjs`，
   * **它自己先 build**。我当时没读那条定义就下了结论，
   * 还为它配了两条自测（删 build / build 挪后）。
   *
   * **证据**：加之前 `full-gates` 在 CI 上就是 success（run 36171364455）。
   *
   * > 这条记在这里，是因为**错误的判据比没有判据更坏**：
   * > 它会让人以为「原来设计上就需要 build」，于是照着它继续加东西。
   * > 判据的依据必须能指到**一份产物或一次运行**，
   * > 「我以为」不构成依据。
   */
  return problems;
}
