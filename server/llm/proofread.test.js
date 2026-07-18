const test = require('node:test');
const assert = require('node:assert/strict');
const { isSafeCorrection, applyCorrections } = require('./proofread');

test('accepts a small contextual recognition correction', () => {
  assert.equal(isSafeCorrection('最高那个高楼', '最高那个高目标'), true);
});

test('rejects replacement of most of a sentence', () => {
  assert.equal(isSafeCorrection(
    '他说那也行，然后现在就差那个淡旺季那个多少个。',
    '不教我那个嘛，昨天又说那个了，然后我又说完了。',
  ), false);
});

test('rejects a correction that manufactures an adjacent duplicate', () => {
  const segments = [
    { text: '昨天又说那个了。' },
    { text: '昨天说那个了。' },
  ];
  const result = applyCorrections(segments, [{ i: 1, text: '昨天又说那个了。' }]);
  assert.deepEqual(result, { fixed: 0, rejected: 1 });
  assert.equal(segments[1].text, '昨天说那个了。');
});

test('stores the original text for an accepted correction', () => {
  const segments = [{ text: '按蛋王记去' }];
  const result = applyCorrections(segments, [{ i: 0, text: '按淡旺季去' }]);
  assert.deepEqual(result, { fixed: 1, rejected: 0 });
  assert.deepEqual(segments[0], { text: '按淡旺季去', orig: '按蛋王记去' });
});
