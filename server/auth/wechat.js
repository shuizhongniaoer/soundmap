class WechatApiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'WechatApiError';
    this.code = code;
  }
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new WechatApiError(`微信接口 HTTP ${response.status}`);
  const data = await response.json();
  if (data.errcode) throw new WechatApiError(data.errmsg || '微信接口调用失败', data.errcode);
  return data;
}

async function exchangeWechatCode({ code, appId, appSecret, fetchImpl = fetch }) {
  if (!code) throw new WechatApiError('缺少微信授权 code');
  if (!appId || !appSecret) throw new WechatApiError('服务端未配置微信 AppID/AppSecret');
  const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
  tokenUrl.search = new URLSearchParams({
    appid: appId,
    secret: appSecret,
    code,
    grant_type: 'authorization_code',
  });
  const token = await getJson(tokenUrl, fetchImpl);
  if (!token.access_token || !token.openid) throw new WechatApiError('微信未返回 access_token/openid');

  const profileUrl = new URL('https://api.weixin.qq.com/sns/userinfo');
  profileUrl.search = new URLSearchParams({
    access_token: token.access_token,
    openid: token.openid,
    lang: 'zh_CN',
  });
  const profile = await getJson(profileUrl, fetchImpl);
  return {
    appId,
    openid: profile.openid || token.openid,
    unionid: profile.unionid || token.unionid || null,
    nickname: profile.nickname || '微信用户',
    avatarUrl: profile.headimgurl || null,
    country: profile.country || null,
    province: profile.province || null,
    city: profile.city || null,
  };
}

module.exports = { WechatApiError, exchangeWechatCode };
