const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDocx, buildTxt, buildSrt, buildSproutsMarkdown, srtTime } = require('./export');

const recording = {
  title: '测试会议',
  transcript: {
    segments: [
      { start: 1.25, end: 3.5, speaker: '张总', text: '先确认时间。' },
      { start: 65, end: 0, speaker: '李总', text: '明天可以。' },
    ],
  },
};

recording.sprouts = { items: [{
  title: '时间确认背后的协作', type: '方法', start: 1.25, speaker: '张总',
  source: '先确认时间。', expansion: '先确认时间，是在减少协作中的不确定性。',
  aha: '先对齐约束，再讨论方案。',
}] };

test('builds a readable plain-text transcript', () => {
  assert.equal(buildTxt(recording), '测试会议\n\n[00:01] 张总：先确认时间。\n[01:05] 李总：明天可以。\n');
});

test('formats SRT timestamps and supplies a fallback end time', () => {
  assert.equal(srtTime(3661.007), '01:01:01,007');
  assert.equal(buildSrt(recording),
    '1\n00:00:01,250 --> 00:00:03,500\n张总：先确认时间。\n\n' +
    '2\n00:01:05,000 --> 00:01:07,000\n李总：明天可以。\n');
});

test('exports a grounded sprout report as Markdown', () => {
  const markdown = buildSproutsMarkdown(recording);
  assert.match(markdown, /# 测试会议 · 灵感发芽/);
  assert.match(markdown, /种子 \[00:01\] 张总/);
  assert.match(markdown, /> 先确认时间。/);
  assert.match(markdown, /Aha：.*先对齐约束/);
});

test('includes sprouts in the Word document without breaking export', async () => {
  const document = await buildDocx(recording);
  assert.ok(document.length > 1000);
});
