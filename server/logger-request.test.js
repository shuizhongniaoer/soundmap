const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { requestIdMiddleware } = require('./request-id');
const { requestLogger } = require('./logger');

test('请求日志关联 request ID 和认证用户', async () => {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(requestLogger);
  app.use((req, res, next) => {
    req.user = { id: 'user-log-test' };
    next();
  });
  app.get('/ok', (req, res) => res.json({ ok: true }));

  const original = console.log;
  const lines = [];
  console.log = value => lines.push(value);
  const server = await new Promise(resolve => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  try {
    const response = await new Promise((resolve, reject) => {
      const req = http.get({
        host: '127.0.0.1',
        port: server.address().port,
        path: '/ok',
        headers: { 'X-Request-Id': 'request-log-test' },
      }, result => {
        result.resume();
        result.on('end', () => resolve(result));
      });
      req.on('error', reject);
    });
    assert.equal(response.statusCode, 200);
    const entry = JSON.parse(lines.find(line => JSON.parse(line).event === 'http.request'));
    assert.equal(entry.requestId, 'request-log-test');
    assert.equal(entry.userId, 'user-log-test');
    assert.equal(entry.status, 200);
  } finally {
    console.log = original;
    await new Promise(resolve => server.close(resolve));
  }
});
