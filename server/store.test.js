const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('recordings are isolated by owner and legacy rows belong only to local mode', () => {
  process.env.SOUNDMAP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'soundmap-store-'));
  delete require.cache[require.resolve('./store')];
  const store = require('./store');
  const now = new Date().toISOString();
  store.create({ id: 'a', userId: 'user-a', title: 'A', createdAt: now });
  store.create({ id: 'b', userId: 'user-b', title: 'B', createdAt: now });
  store.create({ id: 'legacy', title: 'Legacy', createdAt: now });

  assert.deepEqual(store.listForUser('user-a').map(r => r.id), ['a']);
  assert.deepEqual(new Set(store.listForUser('local').map(r => r.id)), new Set(['legacy']));
  assert.equal(store.getForUser('b', 'user-a'), null);
  assert.equal(store.getForUser('a', 'user-a').title, 'A');

  store.createDownloadToken({ tokenHash: 'once', recordingId: 'a', userId: 'user-a', expiresAt: new Date(Date.now() + 1000).toISOString() });
  assert.equal(store.consumeDownloadToken('once').recordingId, 'a');
  assert.equal(store.consumeDownloadToken('once'), null);
});
