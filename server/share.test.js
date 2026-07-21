const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soundmap-share-'));
process.env.SOUNDMAP_DATA_DIR = dataDir;
const share = require('./share');

test('分享密码使用加盐 scrypt，并支持安全校验', async () => {
  const created = await share.create('rec-1', 'user-1', { password: 'correct horse', expiresDays: 1 });
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const tokenMeta = Object.values(stored.meta).find(value => value && value.recordingId === 'rec-1');
  assert.match(tokenMeta.passwordHash, /^scrypt\$/);
  assert.notEqual(tokenMeta.passwordHash, 'correct horse');

  assert.equal((await share.resolve(created.token)).error, 401);
  for (let i = 0; i < 4; i++) {
    assert.equal((await share.resolve(created.token, 'wrong', 'client-1')).error, 403);
  }
  assert.equal((await share.resolve(created.token, 'wrong', 'client-1')).error, 429);
  assert.equal((await share.resolve(created.token, 'correct horse', 'client-1')).error, 429);
  assert.equal((await share.resolve(created.token, 'correct horse', 'client-2')).share.recordingId, 'rec-1');

  const status = await share.statusFor('rec-1');
  assert.equal(status.token, null);
  assert.equal(status.active, true);
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
