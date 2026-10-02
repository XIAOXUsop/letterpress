import { findCodeSpans } from '../../src/lib/wiki/wikilink.ts';

/** Shared gold reader: normalise Windows line endings and exclude code examples. */
export function parseQuestions(source) {
  const text = source.replace(/\r\n?/g, '\n');
  const code = findCodeSpans(text);
  const cases = [];
  let category = '';
  let current = null;
  let offset = 0;
  const listOf = (value) => value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
  for (const line of text.split('\n')) {
    const start = offset;
    offset += line.length + 1;
    if (code.some(([from, to]) => start >= from && start < to)) continue;
    const section = /^##\s+(.*)$/.exec(line);
    if (section) { category = section[1].trim(); current = null; continue; }
    const heading = /^###\s+(.*)$/.exec(line);
    if (heading) {
      current = { category, question: heading[1].trim(), expect: [], forbid: [], forbidHeading: [], noAnswer: false, hasSpec: false, knownLimit: null };
      cases.push(current);
      continue;
    }
    if (!current) continue;
    const field = /^(期望命中|不得出现|不得首段小节|期望判定|已知局限)：(.*)$/.exec(line);
    if (!field) continue;
    const value = field[2].trim();
    current.hasSpec = true;
    if (field[1] === '期望命中') current.expect = listOf(value);
    if (field[1] === '不得出现') current.forbid = listOf(value);
    if (field[1] === '不得首段小节') current.forbidHeading = listOf(value);
    if (field[1] === '期望判定') {
      if (value !== '无依据') throw new Error('期望判定只支持「无依据」：' + current.question);
      current.noAnswer = true;
    }
    if (field[1] === '已知局限') {
      if (!value) throw new Error('已知局限必须说明理由：' + current.question);
      current.knownLimit = value;
    }
  }
  return cases;
}
