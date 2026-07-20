// 公开分享：持久链接（可选密码/有效期），每条录音同一时间只有一个有效分享
// 存储走 store meta 双向索引（share:tok:<hash> -> 详情；share:rec:<id> -> 管理态），JSON/PG 通吃
const crypto = require('crypto');
const store = require('./store');

const hash = v => crypto.createHash('sha256').update(String(v)).digest('base64url');
const recKey = id => `share:rec:${id}`;
const tokKey = t => `share:tok:${hash(t)}`;

async function create(recordingId, userId, { password, expiresDays } = {}) {
  await revoke(recordingId);
  const token = crypto.randomBytes(16).toString('base64url');
  const days = Number(expiresDays);
  const share = {
    recordingId,
    userId,
    passwordHash: password ? hash(password) : null,
    expiresAt: days > 0 ? new Date(Date.now() + days * 864e5).toISOString() : null,
    createdAt: new Date().toISOString(),
  };
  await store.setMeta(tokKey(token), share);
  await store.setMeta(recKey(recordingId), {
    token, hasPassword: Boolean(password), expiresAt: share.expiresAt, createdAt: share.createdAt,
  });
  return { token, hasPassword: Boolean(password), expiresAt: share.expiresAt };
}

// 录音维度的分享状态（含明文 token 供再次复制链接）
async function statusFor(recordingId) {
  const cur = await store.getMeta(recKey(recordingId));
  if (!cur) return null;
  if (cur.expiresAt && Date.parse(cur.expiresAt) < Date.now()) {
    await revoke(recordingId); // 过期即清理
    return null;
  }
  return cur;
}

async function revoke(recordingId) {
  const cur = await store.getMeta(recKey(recordingId));
  if (cur && cur.token) await store.setMeta(tokKey(cur.token), null);
  if (cur) await store.setMeta(recKey(recordingId), null);
}

// 访客解析：返回 { share } 或 { error: 401|403|404|410 }
async function resolve(token, password) {
  const share = await store.getMeta(tokKey(token));
  if (!share) return { error: 404 };
  if (share.expiresAt && Date.parse(share.expiresAt) < Date.now()) return { error: 410 };
  if (share.passwordHash) {
    if (!password) return { error: 401 };
    if (hash(password) !== share.passwordHash) return { error: 403 };
  }
  return { share };
}

module.exports = { create, statusFor, revoke, resolve };
