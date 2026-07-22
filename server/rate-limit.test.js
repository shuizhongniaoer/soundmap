const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { rateLimit, createRateLimit, clearRateLimitState } = require('./rate-limit');

test('API 限流返回 429 和 Retry-After，并按客户端隔离', async () => {
  const oldMax = process.env.API_RATE_LIMIT_MAX;
  const oldWindow = process.env.API_RATE_LIMIT_WINDOW_MS;
  process.env.API_RATE_LIMIT_MAX = '2';
  process.env.API_RATE_LIMIT_WINDOW_MS = '60000';
  clearRateLimitState();
  const app = express();
  app.set('trust proxy', true);
  app.use(rateLimit);
  app.get('/', (req, res) => res.json({ ok: true }));
  const server = await new Promise(resolve => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  const call = (forwarded) => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: server.address().port, path: '/', headers: { 'X-Forwarded-For': forwarded } }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ response, body }));
    });
    req.on('error', reject);
  });
  try {
    assert.equal((await call('10.0.0.1')).response.statusCode, 200);
    assert.equal((await call('10.0.0.1')).response.statusCode, 200);
    const limited = await call('10.0.0.1');
    assert.equal(limited.response.statusCode, 429);
    assert.ok(Number(limited.response.headers['retry-after']) >= 1);
    assert.equal((await call('10.0.0.2')).response.statusCode, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    clearRateLimitState();
    if (oldMax === undefined) delete process.env.API_RATE_LIMIT_MAX; else process.env.API_RATE_LIMIT_MAX = oldMax;
    if (oldWindow === undefined) delete process.env.API_RATE_LIMIT_WINDOW_MS; else process.env.API_RATE_LIMIT_WINDOW_MS = oldWindow;
  }
});


test('认证限流使用独立环境变量', async () => {
  const oldMax = process.env.AUTH_RATE_LIMIT_MAX;
  const oldWindow = process.env.AUTH_RATE_LIMIT_WINDOW_MS;
  process.env.AUTH_RATE_LIMIT_MAX = '1';
  process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000';
  clearRateLimitState();
  const app = express();
  app.use(createRateLimit({ windowEnv: 'AUTH_RATE_LIMIT_WINDOW_MS', maxEnv: 'AUTH_RATE_LIMIT_MAX', namespace: 'auth-test' }));
  app.get('/', (req, res) => res.json({ ok: true }));
  const server = await new Promise(resolve => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  const call = () => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: server.address().port, path: '/' }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject);
  });
  try {
    assert.equal(await call(), 200);
    assert.equal(await call(), 429);
  } finally {
    await new Promise(resolve => server.close(resolve));
    clearRateLimitState();
    if (oldMax === undefined) delete process.env.AUTH_RATE_LIMIT_MAX; else process.env.AUTH_RATE_LIMIT_MAX = oldMax;
    if (oldWindow === undefined) delete process.env.AUTH_RATE_LIMIT_WINDOW_MS; else process.env.AUTH_RATE_LIMIT_WINDOW_MS = oldWindow;
  }
});


test('认证限流默认上限为每分钟 20 次', () => {
  const oldMax = process.env.AUTH_RATE_LIMIT_MAX;
  delete process.env.AUTH_RATE_LIMIT_MAX;
  const middleware = createRateLimit({ maxEnv: 'AUTH_RATE_LIMIT_MAX', defaultMaxRequests: 20, namespace: 'default-test' });
  const headers = {};
  const req = { ip: 'default-limit-test' };
  const res = {
    setHeader(name, value) { headers[name] = value; },
    status() { return this; },
    json() {},
  };
  let nextCount = 0;
  for (let i = 0; i < 20; i++) middleware(req, res, () => { nextCount++; });
  assert.equal(nextCount, 20);
  assert.equal(headers['X-RateLimit-Limit'], '20');
  if (oldMax === undefined) delete process.env.AUTH_RATE_LIMIT_MAX; else process.env.AUTH_RATE_LIMIT_MAX = oldMax;
  clearRateLimitState();
});
