const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createShutdown } = require('./lifecycle');

test('优雅关闭只执行一次，并按 HTTP、队列、存储顺序收尾', async () => {
  const events = [];
  const server = new EventEmitter();
  server.listening = true;
  server.close = callback => {
    events.push('http');
    setImmediate(callback);
  };
  const timer = setInterval(() => {}, 60_000);
  const shutdown = createShutdown({
    server,
    cleanupTimer: timer,
    closeQueue: async () => events.push('queue'),
    closeStore: async () => events.push('store'),
    onExit: async code => events.push(`exit:${code}`),
  });
  assert.equal(await shutdown('SIGTERM'), true);
  assert.equal(await shutdown('SIGINT'), false);
  assert.deepEqual(events, ['http', 'queue', 'store', 'exit:0']);
});

test('HTTP 关闭失败时仍返回失败退出码', async () => {
  const events = [];
  const server = { listening: true, close: callback => setImmediate(() => callback(Object.assign(new Error('busy'), { code: 'EBUSY' }))) };
  const shutdown = createShutdown({
    server,
    cleanupTimer: null,
    closeQueue: async () => events.push('queue'),
    closeStore: async () => events.push('store'),
    onExit: async (code, error) => events.push([code, error.message]),
  });
  assert.equal(await shutdown('SIGTERM'), false);
  assert.deepEqual(events, [[1, 'busy']]);
});
