// 兼容层：签名逻辑已迁移到 blobs/local.js
// 保留此文件仅为向后兼容（media.test.js），新代码请使用 blobs 模块
const crypto = require('crypto');

function secret() {
  return process.env.MEDIA_SIGNING_SECRET || crypto.randomBytes(32).toString('base64url');
}
function signature(filename, expires) {
  return crypto.createHmac('sha256', secret()).update(`${filename}\n${expires}`).digest('base64url');
}

module.exports = {
  signedPath(filename, ttlSeconds = 15 * 60) {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `/asr-media/${encodeURIComponent(filename)}?expires=${expires}&signature=${encodeURIComponent(signature(filename, expires))}`;
  },
  verify(filename, expires, provided) {
    if (!filename || !expires || !provided || Number(expires) < Math.floor(Date.now() / 1000)) return false;
    const expected = signature(filename, expires);
    const a = Buffer.from(expected);
    const b = Buffer.from(String(provided));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },
  hasPersistentSecret: Boolean(process.env.MEDIA_SIGNING_SECRET),
};
