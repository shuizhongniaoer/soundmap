const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('JSON 写操作回收遗留锁并保留最新数据库内容', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soundmap-json-lock-'));
  process.env.SOUNDMAP_DATA_DIR = dir;
  process.env.SOUNDMAP_JSON_LOCK_TTL_MS = '1';
  delete require.cache[require.resolve('./storage/json')];
  const json = require('./storage/json');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'db.json.lock'), 'stale');
  const lock = path.join(dir, 'db.json.lock');
  const old = new Date(Date.now() - 100).getTime() / 1000;
  fs.utimesSync(lock, old, old);
  json.create({ id: 'locked', userId: 'local', createdAt: new Date().toISOString() });
  assert.equal(json.get('locked').id, 'locked');
  assert.equal(fs.existsSync(lock), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
