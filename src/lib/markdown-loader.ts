import { readFileSync } from 'node:fs';
import { glob, type Loader } from 'astro/loaders';
import { markdownBody } from './wiki/markdown.js';

/** Astro trims entry bodies; preserve source whitespace and render the source module. */
export function markdownGlob(options: Parameters<typeof glob>[0]): Loader {
  const loader = glob({ ...options, deferRender: true });
  return {
    name: 'letterpress-markdown-glob',
    async load(context) {
      await loader.load({
        ...context,
        // Invalidate entries cached before this body-preservation contract.
        generateDigest: (input) => context.generateDigest(`preserve-body-v1:${typeof input === 'string' ? input : JSON.stringify(input)}`),
        store: {
          ...context.store,
          set(entry) {
            const body = entry.filePath
              ? markdownBody(readFileSync(new URL(entry.filePath, context.config.root), 'utf8'))
              : entry.body;
            return context.store.set({ ...entry, body });
          },
        },
      });
    },
  };
}
