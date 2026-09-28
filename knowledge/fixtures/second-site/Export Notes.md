---
title: 导出说明
# ⚠️ **2026-09-28：这一行原先没加引号，而它是「非法 YAML」。**
# 裸的 `*` 在 YAML 里是**别名语法**，所以 `parseDocument` 直接报错。
# 读路径改成按 YAML 解析之后（见 `read-page.ts` 的 `dataOf`），
# `check:onboarding-doc` 在这里崩了——**而它崩得对**：
# 这一篇若进真实构建，Astro 的 YAML 解析器**也会拒绝它**。
# 加引号是修内容，**不是回退实现**。
summary: "**文件名与 slugify 结果不同**的那一篇——用来暴露 read-page 与构建侧的 slug 不一致。"
kind: concept
slug: 导出说明
---

# 导出说明

## §1 这一页存在的唯一理由

它的文件名是 `Export Notes.md`，而**构建侧**的 slug 会经过 `slugify`：
大写转小写、空格转连字符 → `export-notes`。

而 `readContentPage` 曾经**直接用文件名**给出 `Export Notes`。

**后果不是「不好看」**，是 `wiki:ask` 回答里的 `docId`
与 `content-manifest.json` 里的 `wiki:export-notes` **对不上**——
而订阅者正是靠那个 id 做增量同步的。

## §2 它也是全语料里唯一的一篇

其余 5 篇的文件名都已经是「slug 形态」（中文原样、小写连字符），
所以那条不一致**只在这一篇上可见**。

> 这是异构内容集的价值：**它专挑那些「本站恰好不会触发」的形状。**
