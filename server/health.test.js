const test = require('node:test');
const assert = require('node:assert/strict');
const { checkReadiness } = require('./health');

test('就绪检查在存储和队列正常时通过', async () => {
  const result = await checkReadiness({
    store: { checkReady: async () => {} },
    queue: { checkReady: async () => {} },
  });
  assert.deepEqual(result, { ready: true, checks: { storage: 'ok', queue: 'ok' } });
});

test('就绪检查隐藏依赖错误并返回失败状态', async () => {
  const result = await checkReadiness({
    store: { checkReady: async () => { throw new Error('数据库密码=secret'); } },
    queue: { checkReady: async () => {} },
  });
  assert.deepEqual(result, { ready: false, checks: { storage: 'failed', queue: 'ok' } });
});
