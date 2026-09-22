/**
 * `contentDigest` 的用例。
 *
 * 这个值将来要决定「页面还标不标 reviewed」，所以它有**两个方向**必须都测：
 *
 *   - 该变的**必须变**：正文改了却算出同一个摘要 = 改过的内容继续挂着"已复核"，
 *     那正是这个机制要防的事，只是防失败了。
 *   - 不该变的**必须不变**：改个 slug 就判 stale 的话，作者会学会无视这个提示，
 *     机制同样失效——**误报和漏报一样会毁掉一个检查**。
 *
 * 第二组比第一组更容易被忽略，因为它的坏处不显眼。
 */
import { describe, expect, it } from 'vitest';
import { contentDigest } from './digest.js';
import type { Doc } from './graph.js';

function doc(over: Partial<Doc> = {}): Doc {
  return {
    kind: 'wiki',
    wikiKind: 'concept',
    slug: 'demo',
    title: '示例',
    summary: '一句话摘要',
    body: '正文第一行\n正文第二行',
    explicitSlug: false,
    draft: false,
    ...over,
  };
}

describe('contentDigest：稳定性', () => {
  it('同一份内容反复算，结果必须一样', () => {
    const d = doc();
    expect(contentDigest(d)).toBe(contentDigest(doc()));
  });

  it('golden：序列化格式一旦改动，这个值就会变——**那时要先想清楚**', () => {
    // 钉住的不只是"能算出个值"，而是**算出来的具体是什么**。
    // 摘要公式改了（换了字段、换了分隔、换了归一化方式），
    // 所有已复核内容会一次性全部失效。那是需要人判断的事，不该悄悄发生。
    expect(contentDigest(doc())).toBe(
      '1505a58ea37da297fae65fecf7c70e8e10aeb66d203eb8e1106b25c620d7d1cc',
    );
  });
});

describe('contentDigest：该变的必须变', () => {
  const base = contentDigest(doc());

  it('改标题', () => {
    expect(contentDigest(doc({ title: '示例（改）' }))).not.toBe(base);
  });

  it('改摘要', () => {
    expect(contentDigest(doc({ summary: '换了摘要' }))).not.toBe(base);
  });

  it('改正文', () => {
    expect(contentDigest(doc({ body: '正文第一行\n正文第三行' }))).not.toBe(base);
  });

  it('正文改一个字符也要变', () => {
    expect(contentDigest(doc({ body: '正文第一行\n正文第二行。' }))).not.toBe(base);
  });

  it('改**知识类型**（concept → synthesis 是实质变化）', () => {
    // 注意用的是 wikiKind。第一版这里写的是 kind，也就是**文档类型**——
    // 它在知识页上恒为 'wiki'，于是这条断言测的是一个永远不变的东西，
    // 而真正的知识类型改了摘要纹丝不动。**是让构建打印它实际看到的字段
    // 才发现的**，看代码看不出来。
    expect(contentDigest(doc({ wikiKind: 'synthesis' }))).not.toBe(base);
  });

  it('改文档类型不改变摘要（它是恒定的，放进摘要毫无意义）', () => {
    expect(contentDigest(doc({ kind: 'post' }))).toBe(base);
  });

  it('增删 related', () => {
    expect(contentDigest(doc({ declaredRelations: ['a'] }))).not.toBe(base);
  });

  it('related 从无到有', () => {
    const withOne = doc({ declaredRelations: ['a'] });
    expect(contentDigest(withOne)).not.toBe(contentDigest(doc()));
  });
});

describe('contentDigest：不该变的必须不变', () => {
  const base = contentDigest(doc());

  it('改 slug——URL 搬家不是内容变化', () => {
    // 这条很重要：知识身份不该因为改了个路径就"需要重新复核"
    expect(contentDigest(doc({ slug: 'renamed' }))).toBe(base);
  });

  it('改 draft 状态', () => {
    expect(contentDigest(doc({ draft: true }))).toBe(base);
  });

  it('改 explicitSlug', () => {
    expect(contentDigest(doc({ explicitSlug: true }))).toBe(base);
  });
});

describe('contentDigest：归一化', () => {
  const lf = contentDigest(doc({ body: '一\n二\n三' }));

  it('CRLF 与 LF 必须算出同一个摘要', () => {
    // 否则 Windows 检出与 Linux 检出永远是两个值，CI 上永远 stale
    expect(contentDigest(doc({ body: '一\r\n二\r\n三' }))).toBe(lf);
  });

  it('单独的 CR 也要归一', () => {
    expect(contentDigest(doc({ body: '一\r二\r三' }))).toBe(lf);
  });

  it('NFC 与 NFD 必须算出同一个摘要', () => {
    // 「é」有预组合与组合两种写法，肉眼完全一样
    const nfc = 'café';
    const nfd = 'café';
    expect(nfc).not.toBe(nfd); // 先确认这两个确实是不同的码点序列
    expect(contentDigest(doc({ title: nfc }))).toBe(contentDigest(doc({ title: nfd })));
  });

  it('related 的顺序不影响摘要', () => {
    const ab = doc({ declaredRelations: ['a', 'b'] });
    const ba = doc({ declaredRelations: ['b', 'a'] });
    expect(contentDigest(ab)).toBe(contentDigest(ba));
  });

  it('related 里的重复项不影响摘要', () => {
    expect(contentDigest(doc({ declaredRelations: ['a', 'a'] }))).toBe(
      contentDigest(doc({ declaredRelations: ['a'] })),
    );
  });
});

describe('contentDigest：形态', () => {
  it('是完整的 sha256 十六进制串，不截断', () => {
    // 截断会提高碰撞概率，而碰撞的后果是"改了却说没改"——
    // 正是它要防的那件事。要短标识请在展示层截。
    expect(contentDigest(doc())).toMatch(/^[0-9a-f]{64}$/);
  });
});
