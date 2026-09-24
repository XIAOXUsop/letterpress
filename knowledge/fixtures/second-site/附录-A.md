---
title: 附录
summary: 与另一篇同名的「附录」——**存在但没人引用它**，用来触发 ambiguous-title（warn 级）。
kind: concept
slug: 附录-A
---

# 附录

## §1 它的用途

它与 `附录-B.md` **共用标题「附录」**，而**没有任何页面引用那个标题**。

所以 lint 应当报 **`ambiguous-title`（warn 级）**，而不是
`ambiguous-wikilink`（error 级）——后者只在**有人真写了 `[[附录]]`** 时才报。

> 这两条规则**分工不同**，而本 fixture 此前只覆盖了后者：
> 两篇「导出」一个被 `[[导出]]` 引用、一个被 `audience:` 声明，
> 于是 warn 那条**恰好不触发**——
> 而「恰好不触发」与「没有这条规则」在输出里**长得一样**。
