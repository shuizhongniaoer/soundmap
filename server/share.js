// 公开分享：持久链接（可选密码/有效期），每条录音同一时间只有一个有效分享
// 存储走 store meta 双向索引（share:tok:<hash> -> 详情；share:rec:<id> -> 管理态）
const crypto = require('crypto');
const store = require('./store');

const hash = v => crypto.createHash('sha256').update(String(v)).digest('base64url');
const recKey = id => `share:rec:${id}`;
const tokKey = t => `share:tok:${hash(t)}`;

function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  if (stored.startsWith('scrypt$')) {
    const [, saltText, keyText] = stored.split('$');
    try {
      const salt = Buffer.from(saltText, 'base64url');
      const expected = Buffer.from(keyText, 'base64url');
      const actual = crypto.scryptSync(String(password), salt, expected.length);
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
  // 兼容升级前的无前缀 SHA-256 哈希；成功验证后由调用方迁移为 scrypt。
  const actual = Buffer.from(hash(password));
  const expected = Buffer.from(stored);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function create(recordingId, userId, { password, expiresDays } = {}) {
  await revoke(recordingId);
  const token = crypto.randomBytes(16).toString('base64url');
  const days = Number(expiresDays);
  const share = {
    recordingId,
    userId,
    passwordHash: password ? passwordHash(password) : null,
    expiresAt: days > 0 ? new Date(Date.now() + days * 864e5).toISOString() : null,
    createdAt: new Date().toISOString(),
  };
  await store.setMeta(tokKey(token), share);
  // 管理态只保存 token 哈希，不保存可直接使用的明文分享 token。
  await store.setMeta(recKey(recordingId), {
    tokenHash: hash(token), hasPassword: Boolean(password), expiresAt: share.expiresAt, createdAt: share.createdAt,
  });
  return { token, hasPassword: Boolean(password), expiresAt: share.expiresAt };
}

// 录音维度的分享状态。出于安全原因，不返回可直接访问分享页的 token。
async function statusFor(recordingId) {
  const cur = await store.getMeta(recKey(recordingId));
  if (!cur) return null;
  if (cur.expiresAt && Date.parse(cur.expiresAt) < Date.now()) {
    await revoke(recordingId);
    return null;
  }
  return { ...cur, token: null, active: true };
}

async function revoke(recordingId) {
  const cur = await store.getMeta(recKey(recordingId));
  if (cur && cur.tokenHash) await store.setMeta(`share:tok:${cur.tokenHash}`, null);
  // 兼容旧版本管理态中的明文 token。
  if (cur && cur.token) await store.setMeta(tokKey(cur.token), null);
  if (cur) await store.setMeta(recKey(recordingId), null);
}

// 访客解析：返回 { share } 或 { error: 401|403|404|410 }
async function resolve(token, password) {
  const share = await store.getMeta(tokKey(token));
  if (!share) return { error: 404 };
  if (share.expiresAt && Date.parse(share.expiresAt) < Date.now()) return { error: 410 };
  if (share.passwordHash && !verifyPassword(password, share.passwordHash)) {
    if (!password) return { error: 401 };
    return { error: 403 };
  }
  return { share };
}

module.exports = { create, statusFor, revoke, resolve };
