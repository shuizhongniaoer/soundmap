const crypto = require('crypto');
const express = require('express');
const store = require('../store');
const { createRawToken, hashToken, SESSION_TTL_MS } = require('./token');
const { exchangeWechatCode } = require('./wechat');

const router = express.Router();
const COOKIE_NAME = 'soundmap_session';

function enabled(value) {
  return /^(1|true|yes)$/i.test(value || '');
}

function normalizeIp(value) {
  return String(value || '').replace(/^::ffff:/, '').trim();
}

function privateIp(value) {
  const ip = normalizeIp(value);
  if (ip === '::1' || ip === '127.0.0.1') return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip)) return true;
  const match = ip.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function devLoginAllowed(req) {
  if (!enabled(process.env.AUTH_DEV_LOGIN)) return false;
  if (!req) return false;
  const socketIp = normalizeIp(req.socket?.remoteAddress);
  const forwardedIp = normalizeIp(String(req.get('x-forwarded-for') || '').split(',')[0]);
  const clientIp = forwardedIp && privateIp(socketIp) ? forwardedIp : socketIp;
  return privateIp(clientIp);
}

function config(req) {
  return {
    required: enabled(process.env.AUTH_REQUIRED),
    wechatEnabled: Boolean(process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET),
    wechatAppId: process.env.WECHAT_APP_ID || null,
    wechatUniversalLink: process.env.WECHAT_UNIVERSAL_LINK || null,
    devLoginEnabled: devLoginAllowed(req),
  };
}

function publicUser(user) {
  if (!user) return null;
  const { openid, unionid, appId, ...safe } = user;
  return safe;
}

function parseCookie(header) {
  return Object.fromEntries(String(header || '').split(';').map(part => {
    const i = part.indexOf('=');
    return i < 0 ? [part.trim(), ''] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1))];
  }).filter(([key]) => key));
}

function requestToken(req) {
  const auth = req.get('authorization') || '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return parseCookie(req.get('cookie'))[COOKIE_NAME] || null;
}

// Express 4 支持 async 中间件，但需要手动捕获错误
// 这里用包装器确保 reject 会被 next(err) 捕获
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const authenticate = wrap(async (req, res, next) => {
  const rawToken = requestToken(req);
  if (rawToken) {
    const session = await store.findSession(hashToken(rawToken));
    const user = session && await store.getUser(session.userId);
    if (user) {
      req.authTokenHash = session.tokenHash;
      req.user = user;
      return next();
    }
  }
  if (!config().required) {
    req.user = await store.getOrCreateLocalUser();
    return next();
  }
  return res.status(401).json({ error: '请先登录', code: 'AUTH_REQUIRED' });
});

async function issueSession(req, res, user) {
  const token = createRawToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await store.createSession({
    tokenHash: hashToken(token),
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.get('x-forwarded-proto') === 'https',
    expires: expiresAt,
    path: '/',
  });
  return token;
}

router.get('/config', (req, res) => res.json(config(req)));

router.get('/wechat/state', wrap(async (req, res) => {
  if (!config().wechatEnabled) return res.status(503).json({ error: '微信登录尚未配置' });
  const state = createRawToken();
  await store.createOauthState({
    stateHash: hashToken(state),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  res.json({ state });
}));

router.post('/wechat', wrap(async (req, res) => {
  const { code, state } = req.body || {};
  if (!state || !(await store.consumeOauthState(hashToken(state)))) {
    return res.status(400).json({ error: '微信登录 state 无效或已过期，请重试' });
  }
  try {
    const profile = await exchangeWechatCode({
      code,
      appId: process.env.WECHAT_APP_ID,
      appSecret: process.env.WECHAT_APP_SECRET,
    });
    const user = await store.upsertWechatUser(profile);
    const token = await issueSession(req, res, user);
    res.json({ token, user: publicUser(user) });
  } catch (error) {
    res.status(502).json({ error: `微信登录失败: ${error.message}`, code: error.code || null });
  }
}));

router.post('/dev', wrap(async (req, res) => {
  if (!devLoginAllowed(req)) return res.status(404).json({ error: '本地测试登录未开启' });
  const user = await store.getOrCreateLocalUser();
  const token = await issueSession(req, res, user);
  res.json({ token, user: publicUser(user) });
}));

router.get('/me', authenticate, wrap(async (req, res) => {
  const user = publicUser(req.user);
  // 附加用户统计信息
  let stats = { total: 0, done: 0, totalSize: 0, totalDuration: 0 };
  try {
    const all = await store.listForUser(req.user.id);
    stats.total = all.length;
    stats.done = all.filter(r => r.status === 'done').length;
    stats.totalSize = all.reduce((sum, r) => sum + (Number(r.size) || 0), 0);
    stats.totalDuration = all.reduce((sum, r) => sum + (Number(r.duration) || 0), 0);
  } catch {}
  res.json({ user: { ...user, stats } });
}));

router.post('/logout', wrap(async (req, res) => {
  const token = requestToken(req);
  if (token) await store.deleteSession(hashToken(token));
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
}));

module.exports = { router, authenticate, config, publicUser, devLoginAllowed, issueSession };
