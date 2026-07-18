const crypto = require('crypto');
const ephemeralSecret = crypto.randomBytes(32).toString('base64url');

function secret() {
  return process.env.MEDIA_SIGNING_SECRET || ephemeralSecret;
}

function signature(filename, expires) {
  return crypto.createHmac('sha256', secret()).update(`${filename}\n${expires}`).digest('base64url');
}

function signedPath(filename, ttlSeconds = 15 * 60) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/asr-media/${encodeURIComponent(filename)}?expires=${expires}&signature=${encodeURIComponent(signature(filename, expires))}`;
}

function verify(filename, expires, provided) {
  if (!filename || !expires || !provided || Number(expires) < Math.floor(Date.now() / 1000)) return false;
  const expected = signature(filename, expires);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(provided));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { signedPath, verify, hasPersistentSecret: Boolean(process.env.MEDIA_SIGNING_SECRET) };
