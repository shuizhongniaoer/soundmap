const test = require('node:test');
const assert = require('node:assert/strict');
const { exchangeWechatCode, WechatApiError } = require('./wechat');

test('exchanges a one-time WeChat code and normalizes the user profile', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(new URL(url));
    const body = urls.length === 1
      ? { access_token: 'access', openid: 'openid-1', unionid: 'union-1' }
      : { openid: 'openid-1', unionid: 'union-1', nickname: '小声', headimgurl: 'https://avatar' };
    return { ok: true, json: async () => body };
  };
  const profile = await exchangeWechatCode({
    code: 'temporary-code', appId: 'wx-app', appSecret: 'server-secret', fetchImpl,
  });

  assert.equal(urls[0].searchParams.get('code'), 'temporary-code');
  assert.equal(urls[0].searchParams.get('secret'), 'server-secret');
  assert.equal(urls[1].searchParams.get('access_token'), 'access');
  assert.deepEqual(profile, {
    appId: 'wx-app', openid: 'openid-1', unionid: 'union-1', nickname: '小声',
    avatarUrl: 'https://avatar', country: null, province: null, city: null,
  });
});

test('surfaces a WeChat API error code', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ errcode: 40029, errmsg: 'invalid code' }) });
  await assert.rejects(
    exchangeWechatCode({ code: 'bad', appId: 'wx-app', appSecret: 'secret', fetchImpl }),
    error => error instanceof WechatApiError && error.code === 40029,
  );
});
