const test = require('node:test');
const assert = require('node:assert/strict');
const { redact, logError } = require('./logger');

test('结构化日志脱敏密码、令牌和 URL 查询参数', () => {
  assert.deepEqual(redact({ password: 'p', token: 't', nested: { secret: 's' }, safe: 'ok' }), {
    password: '[REDACTED]', token: '[REDACTED]', nested: { secret: '[REDACTED]' }, safe: 'ok',
  });
  assert.equal(redact('https://example.test/share?t=abc&password=hidden&x=1'), 'https://example.test/share?t=abc&password=%5BREDACTED%5D&x=1');
});

test('异常日志输出为 JSON 且不包含原始密码', () => {
  const original = console.error;
  let line;
  console.error = value => { line = value; };
  try {
    logError('test.failure', new Error('password=password-value'), { password: 'password-value', requestId: 'req-1' });
  } finally {
    console.error = original;
  }
  const parsed = JSON.parse(line);
  assert.equal(parsed.event, 'test.failure');
  assert.equal(parsed.password, '[REDACTED]');
  assert.equal(parsed.error.message, 'password=[REDACTED]');
  assert.equal(parsed.error.code, undefined);
});
