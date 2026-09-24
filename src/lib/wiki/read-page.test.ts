import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readContentDirs, readContentPage } from './read-page.js';

/**
 * `read-page.ts` 此前**没有自己的测试文件**——
 * 453 条里只有 `context-pack.test.ts` 间接用到它。
 *
 * 而它犯过**两次同型的静默 bug**（都是「解析 review: 块」）：
 *   ① 捕获组恒为空 → 恒返回 `undefined`（迭代 I 修的）
 *   ② 捕获组只有第一行 → `contentDigest` 读不到（迭代 AO 修的）
 *
 * > 两次都是「修好了」而没有「修对」：①的验收标准是「能读到 status」，
 * > 那个标准通过了，而「能读到全部三行」从没被测过。
 *
 * 所以这组用例的判据是**行为本身**，不是「某个字段能读到」。
 */
describe('readContentPage', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'read-page-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, content: string) =>
    writeFileSync(join(dir, name), content, 'utf8');

  describe('review: 块', () => {
    it('拿到块里的全部字段，而不是只有第一行', () => {
      // ⚠️ **这条正对着第二次那个 bug**：`\r?\n?$` 里的 `\n?` 可选，
      // 而多行模式下 `$` 匹配每行行尾——于是在 `status` 行末零消耗地成立。
      write('a.md', [
        '---',
        'title: 甲',
        'review:',
        '  status: reviewed',
        '  checkedAt: 2026-09-24',
        '  contentDigest: abc123',
        '---',
        '',
        '正文第一行。',
        '正文第二行。',
        '',
      ].join('\n'));

      expect(readContentPage(dir, 'a.md').review).toEqual({
        status: 'reviewed',
        checkedAt: '2026-09-24',
        contentDigest: 'abc123',
      });
    });

    it('review: 后面紧跟另一个顶层字段时，不会把它吃进来', () => {
      write('a.md', [
        '---',
        'review:',
        '  status: reviewed',
        '  contentDigest: abc123',
        'id: keep-me',
        '---',
        '',
        '正文。',
        '',
      ].join('\n'));

      const page = readContentPage(dir, 'a.md');
      expect(page.review?.contentDigest).toBe('abc123');
      // 顶层字段不属于 review 块——若被吃进捕获组，get('id') 就会命中
      expect(page.review).not.toHaveProperty('id');
    });

    it('没有 review: 块时是 undefined，而不是一个空对象', () => {
      // 「没有」与「有但是空的」必须可区分，否则调用方无从判断
      write('a.md', ['---', 'title: 甲', '---', '', '正文。', ''].join('\n'));
      expect(readContentPage(dir, 'a.md').review).toBeUndefined();
    });

    it('review: 存在但没有 status 时也是 undefined', () => {
      // 只有 status 是必填的（它是这条状态机的主键）
      write('a.md', ['---', 'review:', '  checkedAt: 2026-09-24', '---', '', '正文。', ''].join('\n'));
      expect(readContentPage(dir, 'a.md').review).toBeUndefined();
    });

    it('CRLF 换行同样能解析', () => {
      // Windows 上 checkout 出来就是 CRLF（本仓库有 .gitattributes 统一 LF，
      // 但 readContentPage 也被 scripts/*.mjs 直接调用，不该依赖它）
      write('a.md', ['---', 'review:', '  status: reviewed', '  contentDigest: abc', '---', '', '正文。', ''].join('\r\n'));
      expect(readContentPage(dir, 'a.md').review).toEqual({ status: 'reviewed', contentDigest: 'abc' });
    });

    /*
     * ── 下面三组对着「空行让块提前结束」那个 bug ──────────────────────
     *
     * 2026-09-24 实测：`review:` 块里夹一个空行（**YAML 里完全合法**），
     * `(?:^[ \t]+.*\r?\n?)+` 就在空行处停住，后面的 `contentDigest` **静默丢失**。
     * 症状是「摘要对账那道检查把 6 个知识页全判成没写 contentDigest 然后跳过」，
     * 最后报一句「全部一致」——**静默跳过的检查等于没有检查**。
     *
     * 修法是**不用正则**（三次正则都试过，都不对，见 parseReview 的注释）。
     */
    it('块中间夹空行不会丢掉后面的字段', () => {
      write('a.md', [
        '---',
        'review:',
        '  status: reviewed',
        '',
        '  contentDigest: abc',
        '---',
        '',
        '正文。',
        '',
      ].join('\n'));
      expect(readContentPage(dir, 'a.md').review).toEqual({ status: 'reviewed', contentDigest: 'abc' });
    });

    it('多个空行夹在每个字段之间也照样读全', () => {
      write('a.md', [
        '---',
        'review:',
        '  status: reviewed',
        '',
        '  checkedAt: 2026-09-24',
        '',
        '  contentDigest: abc',
        '---',
        '',
        '正文。',
        '',
      ].join('\n'));
      expect(readContentPage(dir, 'a.md').review).toEqual({
        status: 'reviewed',
        checkedAt: '2026-09-24',
        contentDigest: 'abc',
      });
    });

    it('CRLF + 空行：两种边界叠加', () => {
      write('a.md', ['---', 'review:', '  status: reviewed', '', '  contentDigest: abc', '---', '', '正文。', ''].join('\r\n'));
      expect(readContentPage(dir, 'a.md').review).toEqual({ status: 'reviewed', contentDigest: 'abc' });
    });
  });

  describe('body', () => {
    it('与 Astro 的 entry.body 同口径：首尾都 trim 过', () => {
      // ⚠️ **这条正对着「trim 只写在调用方注释里」的坑**：
      // wiki-review 算摘要时要求 body 已 trim，而那个约定曾只写在它自己的注释里，
      // 换实现时就丢了——症状是**静默算出错的摘要**。
      write('a.md', ['---', 'title: 甲', '---', '', '', '第一段。', '', '第二段。', '', ''].join('\n'));
      const { body } = readContentPage(dir, 'a.md');
      expect(body.startsWith('第一段。')).toBe(true);
      expect(body.endsWith('第二段。')).toBe(true);
      expect(body).not.toMatch(/^\n/);
    });

    it('body 不含 frontmatter', () => {
      write('a.md', ['---', 'title: 甲', 'summary: 摘要', '---', '', '只有这段。', ''].join('\n'));
      const { body } = readContentPage(dir, 'a.md');
      expect(body).toBe('只有这段。');
      expect(body).not.toContain('summary:');
    });
  });

  describe('related 与 sources', () => {
    it('related 读成数组，缺失时是空数组', () => {
      write('a.md', ['---', 'related: [x, y]', '---', '', '正文。', ''].join('\n'));
      expect(readContentPage(dir, 'a.md').related).toEqual(['x', 'y']);
    });

    it('sources 逐条读出 sourceId / revision / locator', () => {
      write('a.md', [
        '---',
        'sources:',
        '  - sourceId: css-values-4',
        '    revision: WD-20240312',
        '    locator: §5.1.1 长度单位 · ch',
        '  - sourceId: other',
        '---',
        '',
        '正文。',
        '',
      ].join('\n'));

      // 缺省的 revision / locator 是**空串而不是缺席**——
      // 统一形状让消费方不必写 `'revision' in ref` 这种判断。
      // （实测：给 `{ sourceId: 'other' }` 的结果是 `revision: '', locator: ''`。）
      expect(readContentPage(dir, 'a.md').sources).toEqual([
        { sourceId: 'css-values-4', revision: 'WD-20240312', locator: '§5.1.1 长度单位 · ch' },
        { sourceId: 'other', revision: '', locator: '' },
      ]);
    });
  });

  describe('readContentDirs', () => {
    it('跨目录汇总，counts 按**目录**给出文档数', () => {
      // ⚠️ 它**不递归**：传进来的是内容目录本身（`src/content/wiki` 等），
      // 子目录不会被扫。第一次写这条测试时我把文件放在了 `dir/wiki/` 下，
      // 结果只收到一个文件——**是我的测试写错了，不是实现**。
      //
      // ⚠️ `counts` 的键是**目录**不是 slug——它的用途是
      // 「哪个内容目录是空的」（`check-answers.mjs` / `check-impact.mjs` 靠它报错），
      // 而不是「某篇文档出现了几次」。第一次写时我按 slug 查，拿到 undefined。
      write('a.md', '---\ntitle: 甲\n---\n\n甲。\n');
      const dir2 = mkdtempSync(join(tmpdir(), 'read-page2-'));
      try {
        writeFileSync(join(dir2, 'b.md'), '---\ntitle: 乙\n---\n\n乙。\n', 'utf8');
        const { pages, counts } = readContentDirs([dir, dir2]);
        expect(pages.map((p) => p.slug).sort()).toEqual(['a', 'b']);
        expect(counts.get(dir)).toBe(1);
        expect(counts.get(dir2)).toBe(1);
      } finally {
        rmSync(dir2, { recursive: true, force: true });
      }
    });

    it('空目录的计数是 0 而不是缺席——消费方靠它报错', () => {
      // 缺席的话 `[...counts.values()].some((n) => n === 0)` 永远不成立，
      // 而那正是「语料里一半是空的」要报的错。
      const empty = mkdtempSync(join(tmpdir(), 'read-page-empty-'));
      try {
        const { counts } = readContentDirs([empty]);
        expect(counts.get(empty)).toBe(0);
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    });
  });
});
