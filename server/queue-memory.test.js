const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LLM_PROVIDER = 'mock';
const queue = require('./queue/memory');

function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('等待队列任务超时'));
      setTimeout(check, 10);
    };
    check();
  });
}

test('内存队列对同一任务去重并正确报告 active', async () => {
  const first = await queue.enqueue('missing-recording', { parts: ['summary'] });
  const second = await queue.enqueue('missing-recording', { parts: ['summary'] });
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.ok(queue.stats.active >= 1);
  await waitFor(() => queue.stats.active === 0);
});
