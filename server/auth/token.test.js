const test = require('node:test');
const assert = require('node:assert/strict');
const { createRawToken, hashToken } = require('./token');

test('session tokens are random and only their hashes need persistence', () => {
  const first = createRawToken();
  const second = createRawToken();
  assert.notEqual(first, second);
  assert.equal(hashToken(first).length, 64);
  assert.notEqual(hashToken(first), hashToken(second));
});
