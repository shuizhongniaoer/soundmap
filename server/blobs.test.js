const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soundmap-blobs-'));
process.env.SOUNDMAP_UPLOAD_DIR = dir;
const blobs = require('./blobs/local');

test('local blob storage rejects path traversal and supports ranged streams', async () => {
  const key = 'sample.mp3';
  await blobs.saveBuffer(Buffer.from('0123456789'), key);
  assert.equal(await blobs.size(key), 10);
  assert.equal(blobs.getStream('../sample.mp3'), null);
  assert.equal(await blobs.exists('../sample.mp3'), false);

  const stream = blobs.getStream(key, { start: 2, end: 5 });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), '2345');
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
