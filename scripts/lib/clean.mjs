/**
 * 清理 Astro 构建状态与产物。
 *
 * Astro 7 的类型缓存位于根目录 `.astro/`，内容集合的持久缓存却位于
 * `node_modules/.astro/`。只删前者会让 Markdown 插件代码变化后继续复用旧 HTML，
 * 所以所有“干净构建”必须统一经过这里。
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

export async function cleanBuildState(root = process.cwd()) {
  await Promise.all(
    ['.astro', join('node_modules', '.astro'), 'dist'].map((target) =>
      rm(join(root, target), { recursive: true, force: true }),
    ),
  );
}
