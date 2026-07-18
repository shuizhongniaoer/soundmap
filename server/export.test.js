const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTxt, buildSrt, srtTime } = require('./export');

const recording = {
  title: '测试会议',
  transcript: {
    segments: [
      { start: 1.25, end: 3.5, speaker: '张总', text: '先确认时间。' },
      { start: 65, end: 0, speaker: '李总', text: '明天可以。' },
    ],
  },
};

test('builds a readable plain-text transcript', () => {
  assert.equal(buildTxt(recording), '测试会议\n\n[00:01] 张总：先确认时间。\n[01:05] 李总：明天可以。\n');
});

test('formats SRT timestamps and supplies a fallback end time', () => {
  assert.equal(srtTime(3661.007), '01:01:01,007');
  assert.equal(buildSrt(recording),
    '1\n00:00:01,250 --> 00:00:03,500\n张总：先确认时间。\n\n' +
    '2\n00:01:05,000 --> 00:01:07,000\n李总：明天可以。\n');
});
