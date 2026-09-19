#!/usr/bin/env node
import { cleanBuildState } from './lib/clean.mjs';

await cleanBuildState();
console.log('已清理 .astro/、node_modules/.astro/ 与 dist/。');
