import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { site } from '../src/config.ts';
import { runNodeBin } from './lib/astro.mjs';

if (site.search.enabled) {
  process.exitCode = await runNodeBin('pagefind', ['--site', 'dist']);
} else {
  await rm(join(process.cwd(), 'dist', 'pagefind'), { recursive: true, force: true });
  console.log('搜索已关闭，不生成索引。');
}
