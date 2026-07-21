const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const chunkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soundmap-chunks-'));
process.env.SOUNDMAP_CHUNK_DIR = chunkDir;
const uploads = require('./uploads');

test('分片上传按用户隔离，并拒绝错误大小的分片', async () => {
  const chunkSize = 256 * 1024;
  const size = chunkSize * 2 + 10;
  const session = uploads.init({
    filename: 'voice.wav',
    size,
    chunkSize,
    userId: 'user-a',
  });

  assert.equal(uploads.status(session.uploadId, 'user-b'), null);
  assert.throws(
    () => uploads.saveChunk(session.uploadId, 0, Buffer.alloc(chunkSize), 'user-b'),
    error => error.status === 404,
  );
  assert.throws(
    () => uploads.saveChunk(session.uploadId, 0, Buffer.alloc(chunkSize - 1), 'user-a'),
    /大小不匹配/,
  );

  uploads.saveChunk(session.uploadId, 0, Buffer.alloc(chunkSize, 1), 'user-a');
  uploads.saveChunk(session.uploadId, 1, Buffer.alloc(chunkSize, 2), 'user-a');
  uploads.saveChunk(session.uploadId, 2, Buffer.alloc(10, 3), 'user-a');
  assert.deepEqual(uploads.status(session.uploadId, 'user-a').received, [0, 1, 2]);

  const first = await uploads.complete(session.uploadId, 'user-a', async (mergedPath) => {
    assert.equal(fs.statSync(mergedPath).size, size);
    return { id: 'recording-1' };
  });
  assert.equal(first.id, 'recording-1');

  let callbackCalled = false;
  const second = await uploads.complete(session.uploadId, 'user-a', async () => {
    callbackCalled = true;
    return { id: 'recording-2' };
  });
  assert.equal(second.alreadyCompleted, true);
  assert.equal(second.recordingId, 'recording-1');
  assert.equal(callbackCalled, false);
  assert.equal(uploads.status(session.uploadId, 'user-b'), null);
});

test('分片完成失败时清理合并文件并恢复会话', async () => {
  const chunkSize = 256 * 1024;
  const session = uploads.init({ filename: 'failed.wav', size: chunkSize, chunkSize, userId: 'user-a' });
  uploads.saveChunk(session.uploadId, 0, Buffer.alloc(chunkSize, 7), 'user-a');
  await assert.rejects(
    uploads.complete(session.uploadId, 'user-a', async mergedPath => {
      assert.equal(fs.existsSync(mergedPath), true);
      throw new Error('模拟数据库失败');
    }),
    /模拟数据库失败/,
  );
  assert.equal(uploads.status(session.uploadId, 'user-a').status, 'uploading');
  assert.equal(fs.readdirSync(chunkDir).some(name => name.includes(session.uploadId) && name.endsWith('.wav')), false);
});
