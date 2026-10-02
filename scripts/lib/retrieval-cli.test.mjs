import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const scripts = resolve('scripts');
const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    if (!dir.startsWith(join(tmpdir(), 'lp-cli-strict-'))) throw new Error('Unexpected test directory');
    rmSync(dir, { recursive: true, force: true });
  }
});
function fixture(draft = false) {
  const root = mkdtempSync(join(tmpdir(), 'lp-cli-strict-')); dirs.push(root);
  for (const dir of ['src/content/wiki', 'src/content/posts', 'knowledge']) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, 'src/content/wiki/answer.md'), `---\ntitle: Answer\nsummary: Answer\ndraft: ${draft}\nsources: [{sourceId: spec, revision: v1}]\n---\n` + 'Background\n'.repeat(9) + '\nquasarquux must NOT be enabled.\n');
  writeFileSync(join(root, 'src/content/posts/post.md'), '---\ntitle: Post\nsummary: Background\ndate: 2026-10-02\n---\nUnrelated material.');
  writeFileSync(join(root, 'knowledge/questions.md'), '## Facts\n### quasarquux\n期望命中：answer\n');
  return root;
}
const run = (root, script, args = []) => spawnSync(process.execPath, [join(scripts, script), ...args], { cwd: root, encoding: 'utf8' });

it('draft-only evidence is rejected by both gates and the real CLI', () => {
  const root = fixture(true);
  expect(run(root, 'check-questions.mjs').status).toBe(1);
  expect(run(root, 'check-answers.mjs').status).toBe(1);
  const result = run(root, 'wiki-ask.mjs', ['--json', 'quasarquux']);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).supported).toBe(false);
});
it('both LF and CRLF gold files are accepted by the actual gates', () => {
  const root = fixture();
  for (const newline of ['\n', '\r\n']) {
    writeFileSync(join(root, 'knowledge/questions.md'), ['## Facts', '### quasarquux', '期望命中：answer', ''].join(newline));
    expect(run(root, 'check-questions.mjs').status).toBe(0);
    expect(run(root, 'check-answers.mjs').status).toBe(0);
  }
});
it('the actual default CLI delivers late evidence and its negation', () => {
  const result = run(fixture(), 'wiki-ask.mjs', ['--json', 'quasarquux']);
  expect(result.status).toBe(0);
  const pack = JSON.parse(result.stdout);
  expect(pack.supported).toBe(true);
  expect(pack.passages[0].text).toContain('quasarquux must NOT be enabled.');
});
