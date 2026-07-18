const test = require('node:test');
const assert = require('node:assert/strict');
const { searchRecordings, trimSnippet } = require('./search');

const rows = [
  {
    id: 'a', title: '产品会', originalName: 'meeting.mp3',
    transcript: { segments: [{ speaker: '张总', text: '下周发布新版本' }] },
    summary: { abstract: '讨论产品发布' },
  },
  { id: 'b', title: '采访', transcript: { segments: [{ speaker: '王老师', text: '聊教育' }] } },
];

test('searches title, transcript, speaker and summary text', () => {
  assert.deepEqual(searchRecordings(rows, '新版本').map(x => x.rec.id), ['a']);
  assert.deepEqual(searchRecordings(rows, '王老师').map(x => x.rec.id), ['b']);
  assert.deepEqual(searchRecordings(rows, '产品发布').map(x => x.rec.id), ['a']);
});

test('returns a transcript snippet and preserves all rows for an empty query', () => {
  assert.equal(searchRecordings(rows, '新版本')[0].match, '张总：下周发布新版本');
  assert.equal(searchRecordings(rows, ' ').length, 2);
});

test('limits long snippets while keeping the matching text', () => {
  const result = trimSnippet(`开头${'很长'.repeat(100)}目标词${'结尾'.repeat(100)}`, '目标词');
  assert.ok(result.length <= 182);
  assert.match(result, /目标词/);
  assert.ok(result.startsWith('…'));
  assert.ok(result.endsWith('…'));
});
