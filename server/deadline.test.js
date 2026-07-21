const test = require('node:test');
const assert = require('node:assert/strict');
const { withDeadline } = require('./deadline');

test('任务总时限超时并在底层 Promise 结束后清理计时器', async () => {
  await assert.rejects(
    withDeadline(new Promise(resolve => setTimeout(resolve, 50)), Date.now() + 5),
    /任务执行超时/,
  );
});

test('任务总时限不会改变已完成 Promise 的返回值', async () => {
  assert.equal(await withDeadline(Promise.resolve('ok'), Date.now() + 1000), 'ok');
});
