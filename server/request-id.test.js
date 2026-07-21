const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { requestIdMiddleware } = require('./request-id');

test('请求 ID 会透传安全值并拒绝响应头注入字符', async () => {
  const app = express();
  app.use(requestIdMiddleware);
  app.get('/ok', (req, res) => res.json({ requestId: req.requestId }));
  const server = await new Promise(resolve => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  try {
    const result = await new Promise((resolve, reject) => {
      const req = http.get({
        host: '127.0.0.1', port: server.address().port, path: '/ok',
        headers: { 'X-Request-Id': 'client-request-42' },
      }, response => {
        let body = '';
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({ response, body: JSON.parse(body) }));
      });
      req.on('error', reject);
    });
    assert.equal(result.response.headers['x-request-id'], 'client-request-42');
    assert.equal(result.body.requestId, 'client-request-42');

    const generated = await new Promise((resolve, reject) => {
      const req = http.get({
        host: '127.0.0.1', port: server.address().port, path: '/ok',
        headers: { 'X-Request-Id': 'bad value!' },
      }, response => {
        let body = '';
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({ response, body: JSON.parse(body) }));
      });
      req.on('error', reject);
    });
    assert.match(generated.response.headers['x-request-id'], /^[0-9a-f-]{36}$/);
    assert.match(generated.body.requestId, /^[0-9a-f-]{36}$/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
