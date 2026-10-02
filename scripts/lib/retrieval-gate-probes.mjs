import assert from 'node:assert/strict';
import { assess, splitPassages, isSubjectTerm, junctionsOf, termWeight, coverageWeights } from '../../src/lib/wiki/retrieve.ts';

// Independent semantic contracts complement the limited real-site gold set.
const corpus = ['aa', 'bb', 'cc', 'dd'].flatMap((term) => splitPassages(term, term));
assert.equal(assess(corpus, 'aa bb cc dd', { limit: 4, perDoc: 1 }).supported, false, 'coverage must not combine unrelated documents');
assert.equal(isSubjectTerm('什么'), false, 'question words are not subject evidence');
assert.equal(junctionsOf(['样式', '式方', '方案'], new Map([['样式', 1], ['方案', 1]])).has('式方'), true, 'a junction does not add a missing subject');
assert.equal(termWeight(new Map([['t', 1]]), 1, 't', 1), 0, 'a single Latin letter is not evidence');
assert.deepEqual([...coverageWeights(['什么', '行宽'], new Map([['什么', 1], ['行宽', 1]])).keys()], ['行宽'], 'coverage excludes question words');
