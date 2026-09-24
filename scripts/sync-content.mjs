#!/usr/bin/env node
import { syncContent } from './lib/content-sync.mjs';
import { EXIT_ENVIRONMENT, EXIT_USAGE } from '../src/lib/cli/exit-codes.mjs';

const args = process.argv.slice(2);
const valueOf = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const origin = valueOf('origin');
const output = valueOf('output');

if (!origin || !output) {
  console.error('用法：npm run sync:content -- --origin=https://example.com --output=.verify/content-mirror');
  process.exit(EXIT_USAGE);
}

try {
  const result = await syncContent({ origin, output });
  console.log(`\n内容镜像同步完成：${result.documentCount} 篇`);
  console.log(
    `新增 ${result.added} · 更新 ${result.updated} · 修复 ${result.repaired} · 未变 ${result.unchanged} · 删除 ${result.deleted}`,
  );
  console.log(`镜像目录：${result.output}`);
} catch (error) {
  console.error(`\n内容镜像同步失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(EXIT_ENVIRONMENT);
}

