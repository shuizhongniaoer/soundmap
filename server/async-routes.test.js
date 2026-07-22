const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { installAsyncRouteHandling } = require('./async-routes');

test('异步路由异常会进入 Express 错误中间件', async () => {
  const app = installAsyncRouteHandling(express());
  app.get('/failure', async () => {
    const error = new Error('异步路由失败');
    error.status = 418;
    throw error;
  });
  app.use((error, req, res, next) => res.status(error.status).json({ error: error.message }));
  const server = await new Promise(resolve => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  try {
    const result = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: server.address().port, path: '/failure' }, response => {
        let body = '';
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
      }).on('error', reject);
    });
    assert.equal(result.status, 418);
    assert.deepEqual(result.body, { error: '异步路由失败' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
