const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SOUNDMAP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'soundmap-pipeline-'));
process.env.ASR_PROVIDER = 'mock';
process.env.LLM_PROVIDER = 'mock';

const store = require('./store');
const pipeline = require('./pipeline');

function recording(id) {
  const now = new Date().toISOString();
  return {
    id,
    userId: 'local',
    title: '按项生成测试',
    filename: 'unused.mp3',
    status: 'done',
    createdAt: now,
    updatedAt: now,
    transcript: {
      segments: [{ start: 3, end: 9, speaker: '甲', text: '规划不是预言，而是共同修正的坐标。' }],
    },
    summary: { title: '旧总结', abstract: '保持不变' },
    mindmap: '# 旧导图',
  };
}

test('regenerating sprouts preserves summary and mindmap', async () => {
  const rec = recording('sprouts-only');
  store.create(rec);
  await pipeline.process(rec.id, { parts: ['sprouts'] });
  const result = store.get(rec.id);
  assert.deepEqual(result.summary, rec.summary);
  assert.equal(result.mindmap, rec.mindmap);
  assert.equal(result.sprouts.items.length, 1);
  assert.ok(result.sprouts.generatedAt);
});

test('proofreading only does not regenerate other AI content', async () => {
  const rec = recording('proofread-only');
  store.create(rec);
  await pipeline.process(rec.id, { parts: ['proofread'] });
  const result = store.get(rec.id);
  assert.deepEqual(result.summary, rec.summary);
  assert.equal(result.mindmap, rec.mindmap);
  assert.equal(result.sprouts, undefined);
  assert.ok(result.lastProofread.generatedAt);
});
