#!/usr/bin/env node
/**
 * 把公开内容同步成本地镜像。
 *
 * 首次消费 NDJSON（一次请求拿全），后续按 manifest 的 sha256 增量更新。
 * 详细的同步算法与失败回滚见 `scripts/lib/content-sync.mjs`。
 */
import { syncContent } from './lib/content-sync.mjs';
import { EXIT_ENVIRONMENT, EXIT_USAGE } from '../src/lib/cli/exit-codes.mjs';
import { failWithJson, jsonOk } from '../src/lib/cli/json-output.mjs';

const args = process.argv.slice(2);
const valueOf = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const origin = valueOf('origin');
const output = valueOf('output');
const asJson = args.includes('--json');

if (!origin || !output) {
  const missing = [!origin ? '--origin' : null, !output ? '--output' : null].filter(Boolean);
  failWithJson(asJson ? 'json' : 'text', EXIT_USAGE, `缺少必填参数：${missing.join('、')}。`, {
    hint: 'npm run sync:content -- --origin=https://example.com --output=.verify/content-mirror',
  });
}

try {
  const result = await syncContent({ origin, output });
  if (asJson) {
    // 同步器返回解析后的绝对路径。JSON 明确标记 absolute，调用方不必猜。
    console.log(
      JSON.stringify(
        jsonOk({
          origin,
          output: { path: result.output, absolute: true },
          documentCount: result.documentCount,
          added: result.added,
          updated: result.updated,
          repaired: result.repaired,
          unchanged: result.unchanged,
          deleted: result.deleted,
        }),
      ),
    );
  } else {
    console.log(`\n内容镜像同步完成：${result.documentCount} 篇`);
    console.log(
      `新增 ${result.added} · 更新 ${result.updated} · 修复 ${result.repaired} · 未变 ${result.unchanged} · 删除 ${result.deleted}`,
    );
    console.log(`镜像目录：${result.output}`);
  }
} catch (error) {
  failWithJson(
    asJson ? 'json' : 'text',
    EXIT_ENVIRONMENT,
    `内容镜像同步失败：${error instanceof Error ? error.message : String(error)}`,
  );
}
