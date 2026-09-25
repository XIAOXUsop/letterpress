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
  return problems;
}
