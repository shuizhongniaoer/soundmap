const test = require('node:test');
const assert = require('node:assert/strict');
const { devLoginAllowed } = require('./index');

function request(remoteAddress, forwardedFor = '') {
  return {
    socket: { remoteAddress },
    get(name) { return name === 'x-forwarded-for' ? forwardedFor : ''; },
  };
}

test('development login is limited to local/private clients and rejects public tunnel traffic', () => {
  process.env.AUTH_DEV_LOGIN = '1';
  assert.equal(devLoginAllowed(request('127.0.0.1')), true);
  assert.equal(devLoginAllowed(request('192.168.1.20')), true);
  assert.equal(devLoginAllowed(request('127.0.0.1', '203.0.113.10')), false);
  assert.equal(devLoginAllowed(request('203.0.113.10', '127.0.0.1')), false);
});
