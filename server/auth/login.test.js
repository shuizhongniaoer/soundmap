const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const store = require('../store');
const { router } = require('./index');

function request(app, path) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request({
        host: '127.0.0.1', port, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': '2' },
      }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => {
          server.close(() => resolve({ response, body: JSON.parse(body) }));
        });
      });
      req.on('error', reject);
      req.end('{}');
    });
    server.on('error', reject);
  });
}

test('本地开发登录会创建用户并签发会话', async () => {
  const previous = process.env.AUTH_DEV_LOGIN;
  process.env.AUTH_DEV_LOGIN = '1';
  const user = { id: `dev-login-${Date.now()}`, provider: 'dev', nickname: '测试用户' };
  const originalGetOrCreate = store.getOrCreateLocalUser;
  const originalCreateSession = store.createSession;
  const sessions = [];
  store.getOrCreateLocalUser = async () => user;
  store.createSession = async session => { sessions.push(session); return session; };
  try {
    const app = express();
    app.use(express.json());
    app.use(router);
    const result = await request(app, '/dev');
    assert.equal(result.response.statusCode, 200);
    assert.equal(result.body.user.id, user.id);
    assert.ok(result.body.token.length >= 32);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].userId, user.id);
  } finally {
    store.getOrCreateLocalUser = originalGetOrCreate;
    store.createSession = originalCreateSession;
    if (previous === undefined) delete process.env.AUTH_DEV_LOGIN;
    else process.env.AUTH_DEV_LOGIN = previous;
  }
});
