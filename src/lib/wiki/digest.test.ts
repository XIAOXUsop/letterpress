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

  it('改**文档类型**（post ↔ wiki）不改变摘要——写进摘要的是 wikiKind', () => {
    // ⚠️ 这条的措辞以前容易读错：它容易被理解成「`kind` 字段进了摘要」，
    // 而**恰恰相反**——`digestInput` 里写的是 `kind:${doc.wikiKind ?? ''}`，
    // 那个 `kind:` 是**知识类型**（concept/entity/synthesis）的标签名，
    // 不是文档类型（post/wiki）。
    //
    // 所以真正该问的是：把一篇文章移进知识层，摘要会不会变？
    // 会——因为 `wikiKind` 从空变成 `concept`（见上一条）。
    // 而这里测的是**只改 `kind`、不动 `wikiKind`** 的情形。
    //
    // 为什么不把 `doc.kind` 也放进去：它对一篇文档确实近乎恒定，
    // 而摘要的用途是判断「正文语义有没有变」——
    // 文档搬了目录但内容一字未改，那不是内容变化。
    expect(contentDigest(doc({ kind: 'post' }))).toBe(base);
  });

  it('文章移入知识层会改变摘要（wikiKind 从空变成 concept）', () => {
    // 这是实践中最常见的迁移：`src/content/posts/x.md` → `src/content/wiki/x.md`。
    // 它**必须**被摘要捕捉到，否则一个标着 reviewed 的页面在搬家之后
    // 仍然显示「已复核」，而它已经是另一种东西了（要参与 lint、影响分析、来源治理）。
    //
    // 上一条说「只改 kind 不变」——合起来才完整：
    // **搬目录这件事通过 wikiKind 被捕捉到，而不需要把 doc.kind 写进摘要。**
    const asPost = doc({ kind: 'post', wikiKind: undefined });
    const asWiki = doc({ kind: 'wiki', wikiKind: 'concept' });
    expect(contentDigest(asPost)).not.toBe(contentDigest(asWiki));
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

// ── 测试自己测对了吗 ──────────────────────────────────────────────────
/**
 * 迭代 Q 抓到的缺口是「有检查 ≠ 检查守住了该守的」：
 * `verify:search` 三项全绿，而它只查「全站 lang 一致」不查「lang 正确」——
 * 把 `zh-CN` 改成不存在的 `xx-YY` 照样绿。
 *
 * 那一类缺陷在**单测**里的形状是：**断言通过，但它比对的是别的东西**。
 * 本文件第一版就有一个真实的例子：
 *
 *   it('改**知识类型**（concept → synthesis 是实质变化）', () => {
 *     expect(contentDigest(doc({ kind: 'synthesis' }))).not.toBe(base);  // ← 测错了字段
 *
 * 那次 `kind` 在知识页上恒为 `'wiki'`，所以这条断言测的是一个**永远不变的东西**——
 * 它必然通过，而真正的知识类型改了摘要纹丝不动。
 * **它是绿的，而且什么都没测。**
 *
 * 下面这组量的是「断言真的会因为它声称的东西而失败」。
 */
describe('这些断言真的会因为它声称的东西而失败', () => {
  /**
   * 把 `contentDigest` 换成一个什么都不做的桩，
   * 上面每一组**应该全部变红**。
   *
   * 逐条试不现实（那是一次大重构），所以这里只钉住最要紧的一条性质：
   * **摘要是真的被算出来的**——不是常量、不是 `base` 自身、不是巧合相等。
   *
   * 一个恒返回同一个值的 `contentDigest` 能让上面 19 条全绿吗？
   * 「同一份内容反复算结果一样」会绿（两边都是同一个常量），
   * 但「改标题要变」「正文改一个字符也要变」必然红。
   * 这组测试量的是**它们的组合**，而组合才是真正的判据。
   */
  it('恒定值实现会让「该变的必须变」那组全部失败', () => {
    const changed = [
      contentDigest(doc({ title: '示例（改）' })),
      contentDigest(doc({ summary: '换了摘要' })),
      contentDigest(doc({ body: '正文第一行\n正文第三行' })),
      contentDigest(doc({ wikiKind: 'synthesis' })),
    ];
    // 四个不同的改动必须给出四个不同的摘要——
    // 一个恒定实现会让它们**全部相等**，于是这条断言立刻失败。
    expect(new Set(changed).size).toBe(changed.length);
  });

  it('摘要确实依赖输入，而不是每次都返回同一个值', () => {
    const a = contentDigest(doc({ body: '甲' }));
    const b = contentDigest(doc({ body: '乙' }));
    expect(a).not.toBe(b);
  });

  it('golden 值不是巧合：改动任何一个字段它都会变', () => {
    // golden 钉住的是「算出来的具体是什么」。若某条改动算不出变化，
    // 那条 golden 就**只覆盖了部分字段**，而覆盖不全的 golden 给了虚假的安全感。
    const golden = '1505a58ea37da297fae65fecf7c70e8e10aeb66d203eb8e1106b25c620d7d1cc';
    expect(contentDigest(doc())).toBe(golden);
    for (const over of [
      { title: '别的' },
      { summary: '别的' },
      { body: '别的' },
      { wikiKind: 'synthesis' },
      { declaredRelations: ['x'] },
    ]) {
      expect(contentDigest(doc(over))).not.toBe(golden);
    }
  });
});
