const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installProcessErrorHandlers } = require('./process-errors');

test('进程级异常记录后只触发一次优雅退出', async () => {
  const logs = [];
  const shutdowns = [];
  const processObject = new EventEmitter();
  const remove = installProcessErrorHandlers({
    logError: (event, error) => logs.push([event, error.message]),
    shutdown: async source => { shutdowns.push(source); },
    processObject,
  });
  try {
    processObject.emit('unhandledRejection', new Error('第一次异常'));
    processObject.emit('uncaughtException', new Error('第二次异常'));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(logs, [
      ['process.unhandled_rejection', '第一次异常'],
      ['process.uncaught_exception', '第二次异常'],
    ]);
    assert.deepEqual(shutdowns, ['unhandled_rejection']);
  } finally {
    remove();
  }
});
