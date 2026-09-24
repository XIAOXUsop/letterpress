# 测试样本：线上真实的 v1 内容清单

`manifest-v1.json` 是 **2026-09-24 从线上 Demo 抓下来的真实产物**，
不是手写的、也不是构造的。

```
curl -s https://xiaoxusop.github.io/letterpress/content-manifest.json
```

## 为什么必须是真实产物

路线图阶段 4 的退出条件：「v1 数据可确定性迁移到 v2，失败时有精确诊断」。
**这句话只有在拿真的 v1 跑过之后才算有证据**。

构造一份 v1 是很容易的，而**构造的数据只会测到构造者想象的形状**——
它必然是「干净的、字段整齐的」，而真实的线上产物未必：

- 2026-09-24 实测：这份真实 v1 的 11 篇**一条 `provenance` 都没有**，
  而它与本地 v2 的其余字段**逐条完全吻合**，9 条差异全是「内容变新」
  （`updatedAt` 与 markdown 的 sha256），**没有一处格式不兼容**。
- 这正是「用真实数据」得到的信息——手写的 v1 很可能一开始就把
  `provenance` 填上去了，于是「迁移时**不该**编造 provenance」这条根本测不到。

## 它不参与构建

这个文件**只在两个地方被读**：

- `npm run verify:migrate`（负向验证，5 种坏法）
- 需要手工查迁移行为时：`node scripts/migrate-manifest.mjs knowledge/fixtures/manifest-v1.json --check`

**它不进入 `src/content/`，因此不会被当成一篇内容、不会出现在构建产物里。**

## 什么时候该更新它

**不要更新。** 它的价值恰恰在于「这是 **v1**」——
线上早已升到 v2（那次加 `provenance` 的提交一并升的版本号），
而这份样本是那份提交**之前**的真实产物。

> 换新样本会让 `verify:migrate` 失去意义：
> 它要测的正是「v1 能不能迁到 v2」，样本必须真的是 v1。
