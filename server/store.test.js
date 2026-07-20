const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('recordings are isolated by owner and legacy rows belong only to local mode', async () => {
  process.env.SOUNDMAP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'soundmap-store-'));
  delete require.cache[require.resolve('./store')];
  const store = require('./store');
  const now = new Date().toISOString();
  await store.create({ id: 'a', userId: 'user-a', title: 'A', createdAt: now });
  await store.create({ id: 'b', userId: 'user-b', title: 'B', createdAt: now });
  await store.create({ id: 'legacy', title: 'Legacy', createdAt: now });

  assert.deepEqual((await store.listForUser('user-a')).map(r => r.id), ['a']);
  const localList = await store.listForUser('local');
  assert.ok(new Set(localList.map(r => r.id)).has('legacy'));
  assert.equal(await store.getForUser('b', 'user-a'), null);
  assert.equal((await store.getForUser('a', 'user-a')).title, 'A');

  await store.createDownloadToken({ tokenHash: 'once', recordingId: 'a', userId: 'user-a', expiresAt: new Date(Date.now() + 1000).toISOString() });
  assert.equal((await store.consumeDownloadToken('once')).recordingId, 'a');
  assert.equal(await store.consumeDownloadToken('once'), null);
});
