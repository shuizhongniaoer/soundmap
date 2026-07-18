const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSprouts } = require('./sprouts');

const segments = [
  { start: 12, speaker: '甲', text: '真正有用的功能，是用户永远不会主动点击的地方。' },
  { start: 30, speaker: '乙', text: '嗯。' },
];

test('grounds every sprout in a real transcript segment', () => {
  const result = normalizeSprouts({ sprouts: [{
    segment_index: 0, type: '反常识', title: '隐形功能的价值',
    seed_summary: '主动与无感之间，藏着产品价值的矛盾。',
    reference: '老子《道德经》',
    echo: '“无为”不是不作为，而是不让作为本身成为负担。',
    expansion: '可以继续分析主动操作与自动触发之间的产品取舍。',
    aha: '好功能不一定需要用户主动寻找。', score: 0.86,
  }] }, segments);
  assert.equal(result.items[0].source, segments[0].text);
  assert.equal(result.items[0].start, 12);
  assert.equal(result.items[0].end, 30);
  assert.equal(result.items[0].segmentIndex, 0);
  assert.equal(result.items[0].reference, '老子《道德经》');
});

test('drops weak, duplicate and ungrounded sprouts instead of forcing output', () => {
  const base = {
    segment_index: 0, type: '方法', title: '同一个点', seed_summary: '种子提炼',
    reference: '《庄子》', echo: '遥远回声', expansion: '有内容', aha: '有洞见',
  };
  const result = normalizeSprouts({ sprouts: [
    { ...base, score: 0.4 },
    { ...base, score: 0.8 },
    { ...base, score: 0.9 },
    { ...base, segment_index: 99, title: '不存在', score: 0.9 },
  ] }, segments);
  assert.equal(result.items.length, 1);
});
