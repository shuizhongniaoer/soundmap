// 本地磁盘对象存储适配器（开发/单机模式）
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const UPLOAD_DIR = process.env.SOUNDMAP_UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 签名密钥：优先用环境变量（多实例必须一致）；
// 未配置时自动生成并持久化到 data/.media-secret（0600），重启后已发出的签名链接不再失效
function loadOrCreatePersistedSecret() {
  const dir = path.join(__dirname, '..', '..', 'data');
  const file = path.join(dir, '.media-secret');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch { /* 不存在则创建 */ }
  const secret = crypto.randomBytes(32).toString('base64url');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
  } catch (e) {
    console.warn('[blobs] 持久化签名密钥失败，退回进程级临时密钥:', e.message);
  }
  return secret;
}
const persistedSecret = process.env.MEDIA_SIGNING_SECRET || loadOrCreatePersistedSecret();
function signingSecret() {
  return persistedSecret;
}
function signature(filename, expires) {
  return crypto.createHmac('sha256', signingSecret()).update(`${filename}\n${expires}`).digest('base64url');
}

function isSafeKey(key) {
  return typeof key === 'string' && Boolean(key) && path.basename(key) === key && !key.includes('..');
}

function assertSafeKey(key) {
  if (!isSafeKey(key)) throw new Error('invalid blob key');
}

module.exports = {
  name: 'local',
  uploadDir: UPLOAD_DIR,

  // 保存本地文件到存储（本地模式下就是移动/复制到 UPLOAD_DIR）
  async save(localPath, key, contentType) {
    assertSafeKey(key);
    const target = path.join(UPLOAD_DIR, key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // 如果已在 UPLOAD_DIR 内则跳过
    if (path.resolve(localPath) === path.resolve(target)) return key;
    await fs.promises.copyFile(localPath, target);
    return key;
  },

  // 保存 Buffer
  async saveBuffer(buffer, key) {
    assertSafeKey(key);
    const target = path.join(UPLOAD_DIR, key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, buffer);
    return key;
  },

  // 获取可读流（用于 HTTP 响应）
  getStream(key, options = {}) {
    if (!isSafeKey(key)) return null;
    const target = path.join(UPLOAD_DIR, key);
    if (!fs.existsSync(target)) return null;
    return fs.createReadStream(target, options);
  },

  // 获取 ASR 可访问的签名 URL（本地模式下是 /asr-media/ 路径）
  async getUrl(key, ttlSeconds = 15 * 60) {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `/asr-media/${encodeURIComponent(key)}?expires=${expires}&signature=${encodeURIComponent(signature(key, expires))}`;
  },

  // 获取本地路径（ffmpeg 预处理用。本地模式直接返回，无需清理）
  async getAsLocalPath(key) {
    if (!isSafeKey(key)) return null;
    const target = path.join(UPLOAD_DIR, key);
    return { path: target, cleanup: () => {} };
  },

  async exists(key) {
    if (!isSafeKey(key)) return false;
    const target = path.join(UPLOAD_DIR, key);
    return fs.existsSync(target);
  },

  async delete(key) {
    if (!isSafeKey(key)) return;
    try { await fs.promises.unlink(path.join(UPLOAD_DIR, key)); } catch { /* ignore */ }
  },

  async size(key) {
    try { return (await fs.promises.stat(path.join(UPLOAD_DIR, key))).size; } catch { return 0; }
  },

  // 验证签名（供 /asr-media/ 端点调用）
  verify(key, expires, provided) {
    if (!key || !expires || !provided || Number(expires) < Math.floor(Date.now() / 1000)) return false;
    const expected = signature(key, expires);
    const a = Buffer.from(expected);
    const b = Buffer.from(String(provided));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },

  // env 配置或已持久化到 data/.media-secret 都算持久（重启不失效）
  get hasPersistentSecret() {
    if (process.env.MEDIA_SIGNING_SECRET) return true;
    try { return Boolean(fs.readFileSync(path.join(__dirname, '..', '..', 'data', '.media-secret'), 'utf8').trim()); }
    catch { return false; }
  },
};
