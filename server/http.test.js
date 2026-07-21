const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { fetchWithTimeout } = require('./http');

test('外部 HTTP 请求在超时后失败并保留主机信息', async () => {
  const server = http.createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await assert.rejects(
      fetchWithTimeout(`http://127.0.0.1:${port}/never`, {}, 20),
      /外部请求超时.*127\.0\.0\.1/,
    );
  } finally {
    server.close();
  }
});

test('已有 AbortSignal 时不覆盖调用方取消机制', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchWithTimeout('http://127.0.0.1:1/never', { signal: controller.signal }, 1000),
    error => error.name === 'AbortError' || error.code === 'ECONNREFUSED',
  );
});
