// 分片上传会话管理（支持断点续传）
// 会话存储在文件系统：{TMP_UPLOAD_DIR}/chunks/{uploadId}/
//   meta.json     — 会话元数据
//   chunk_{index} — 单个分片文件
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { pipeline } = require('stream/promises');

const blobs = require('./blobs');

// 分片上传临时目录
const CHUNK_DIR = process.env.SOUNDMAP_CHUNK_DIR
  || path.join(blobs.isLocal ? (blobs.uploadDir || path.join(__dirname, '..', 'uploads')) : os.tmpdir(), 'chunks');
fs.mkdirSync(CHUNK_DIR, { recursive: true });

// 默认分片大小：2MB
const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024;
// 会话过期时间：24 小时
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
// 允许的文件扩展名（与 multer fileFilter 保持一致）
const ALLOWED_EXT = /\.(mp3|m4a|wav|aac|ogg|opus|flac|mp4|webm|amr|3gp)$/i;

// uploadId 白名单：服务端生成的格式是 hex-时间戳36进制，防御纵深（防路径穿越，不依赖会话存在性检查）
const VALID_UPLOAD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
function assertUploadId(uploadId) {
  if (!VALID_UPLOAD_ID.test(String(uploadId || ''))) {
    const err = new Error('非法的 uploadId');
    err.status = 400;
    throw err;
  }
}

function sessionDir(uploadId) {
  assertUploadId(uploadId);
  return path.join(CHUNK_DIR, uploadId);
}

function metaPath(uploadId) {
  return path.join(sessionDir(uploadId), 'meta.json');
}

function chunkPath(uploadId, index) {
  return path.join(sessionDir(uploadId), `chunk_${index}`);
}

function readMeta(uploadId) {
  try {
    const raw = fs.readFileSync(metaPath(uploadId), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeMeta(uploadId, meta) {
  fs.mkdirSync(sessionDir(uploadId), { recursive: true });
  const target = metaPath(uploadId);
  const temp = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(meta, null, 2), { mode: 0o600 });
    fs.renameSync(temp, target);
  } finally {
    try { fs.unlinkSync(temp); } catch { /* ignore */ }
  }
}

function assertOwner(meta, userId) {
  if (userId !== undefined && meta.userId !== userId) {
    const err = new Error('上传会话不存在或无权访问');
    err.status = 404;
    throw err;
  }
}

function listReceivedChunks(uploadId) {
  const dir = sessionDir(uploadId);
  const received = [];
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const m = f.match(/^chunk_(\d+)$/);
      if (m) received.push(Number(m[1]));
    }
  } catch { /* dir not exists */ }
  return received.sort((a, b) => a - b);
}

function deleteSession(uploadId, userId) {
  if (!VALID_UPLOAD_ID.test(String(uploadId || ''))) return false; // 非法 ID 直接忽略
  const meta = readMeta(uploadId);
  if (!meta) return false;
  assertOwner(meta, userId);
  const dir = sessionDir(uploadId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch { /* ignore */ }
  return false;
}

// 清理过期会话（best-effort，每次 init 时调用）
function cleanExpired() {
  try {
    const entries = fs.readdirSync(CHUNK_DIR, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = readMeta(entry.name);
      if (!meta) {
        // 无 meta 的目录，检查目录修改时间
        try {
          const stat = fs.statSync(path.join(CHUNK_DIR, entry.name));
          if (now - stat.mtimeMs > SESSION_TTL_MS) deleteSession(entry.name);
        } catch { /* ignore */ }
        continue;
      }
      if (now - meta.createdAt > SESSION_TTL_MS) {
        deleteSession(entry.name);
      }
    }
  } catch { /* ignore */ }
}

/**
 * 初始化上传会话
 * @param {object} params - { filename, size, mimeType, chunkSize, userId }
 * @returns {{ uploadId, chunkSize, totalChunks, received: [] }}
 */
function init({ filename, size, mimeType, chunkSize, userId }) {
  if (!filename || !size) throw new Error('filename 和 size 必填');
  if (!ALLOWED_EXT.test(filename)) throw new Error('不支持的文件类型');

  const normalizedSize = Number(size);
  if (!Number.isSafeInteger(normalizedSize) || normalizedSize <= 0 || normalizedSize > 500 * 1024 * 1024) {
    throw new Error('文件大小必须是 1 至 500MB 的整数');
  }
  const requestedChunkSize = Number(chunkSize || DEFAULT_CHUNK_SIZE);
  if (!Number.isSafeInteger(requestedChunkSize) || requestedChunkSize < 256 * 1024 || requestedChunkSize > 16 * 1024 * 1024) {
    throw new Error('分片大小必须是 256KB 至 16MB 的整数');
  }
  const cs = requestedChunkSize;
  const totalChunks = Math.ceil(normalizedSize / cs);

  cleanExpired();

  const uploadId = crypto.randomBytes(8).toString('hex') + '-' + Date.now().toString(36);
  const meta = {
    uploadId,
    filename,
    size: normalizedSize,
    mimeType: mimeType || 'application/octet-stream',
    chunkSize: cs,
    totalChunks,
    userId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'uploading',
  };
  writeMeta(uploadId, meta);
  return { uploadId, chunkSize: cs, totalChunks, received: [] };
}

/**
 * 查询上传状态
 */
function status(uploadId, userId) {
  if (!VALID_UPLOAD_ID.test(String(uploadId || ''))) return null; // 非法 ID 视同不存在
  const meta = readMeta(uploadId);
  if (!meta || (userId !== undefined && meta.userId !== userId)) return null;
  const received = listReceivedChunks(uploadId);
  return {
    uploadId,
    status: meta.status,
    filename: meta.filename,
    size: meta.size,
    chunkSize: meta.chunkSize,
    totalChunks: meta.totalChunks,
    received,
    recordingId: meta.recordingId || null,
  };
}

/**
 * 保存单个分片
 * @param {string} uploadId
 * @param {number} index
 * @param {Buffer} data
 */
function saveChunk(uploadId, index, data, userId) {
  const meta = readMeta(uploadId);
  if (!meta) throw new Error('上传会话不存在或已过期');
  assertOwner(meta, userId);
  if (meta.status !== 'uploading') throw new Error(`会话状态为 ${meta.status}，不能上传分片`);
  if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) {
    throw new Error(`分片序号 ${index} 超出范围（0..${meta.totalChunks - 1}）`);
  }
  if (!Buffer.isBuffer(data)) throw new Error('分片数据无效');
  if (data.length === 0 || data.length > meta.size - index * meta.chunkSize) {
    throw new Error(`分片 ${index} 大小超出剩余文件大小`);
  }
  const expectedSize = index === meta.totalChunks - 1
    ? meta.size - index * meta.chunkSize
    : meta.chunkSize;
  if (data.length !== expectedSize) {
    throw new Error(`分片 ${index} 大小不匹配：期望 ${expectedSize}，实际 ${data.length}`);
  }

  fs.mkdirSync(sessionDir(uploadId), { recursive: true });
  fs.writeFileSync(chunkPath(uploadId, index), data);

  meta.updatedAt = Date.now();
  writeMeta(uploadId, meta);

  return { ok: true, index, received: listReceivedChunks(uploadId) };
}

/**
 * 完成上传：合并分片→保存到对象存储→创建录音
 * @param {string} uploadId
 * @param {function} createRecording - (mergedFile, meta) => recording
 * @returns {Promise<object>} recording
 */
const completing = new Map();

async function complete(uploadId, userId, createRecording) {
  // 兼容旧的内部调用签名 complete(uploadId, callback)
  if (typeof userId === 'function') {
    createRecording = userId;
    userId = undefined;
  }
  const meta = readMeta(uploadId);
  if (!meta) throw new Error('上传会话不存在或已过期');
  assertOwner(meta, userId);
  if (meta.status === 'completed' && meta.recordingId) {
    return { id: meta.recordingId, recordingId: meta.recordingId, alreadyCompleted: true };
  }
  if (meta.status === 'completing' || completing.has(uploadId)) {
    throw new Error('上传正在完成，请稍后重试');
  }
  if (meta.status !== 'uploading') throw new Error(`会话状态为 ${meta.status}，不能完成上传`);

  meta.status = 'completing';
  meta.updatedAt = Date.now();
  writeMeta(uploadId, meta);
  const task = (async () => {
    try {
      const received = listReceivedChunks(uploadId);
      if (received.length !== meta.totalChunks) {
        throw new Error(`分片不完整：已收到 ${received.length}/${meta.totalChunks}，缺失: ${findMissing(received, meta.totalChunks).join(',')}`);
      }

      const ext = path.extname(meta.filename) || '.m4a';
      const mergedName = `${Date.now()}-${uploadId}${ext}`;
      const mergedPath = path.join(CHUNK_DIR, mergedName);
      try {
        const out = fs.createWriteStream(mergedPath);
        for (let i = 0; i < meta.totalChunks; i++) {
          const cp = chunkPath(uploadId, i);
          if (!fs.existsSync(cp)) throw new Error(`分片 ${i} 文件丢失`);
          await pipeline(fs.createReadStream(cp), out, { end: false });
        }
        out.end();
        await new Promise((resolve, reject) => {
          out.on('finish', resolve);
          out.on('error', reject);
        });

        const stat = fs.statSync(mergedPath);
        if (stat.size !== meta.size) {
          throw new Error(`合并后文件大小不匹配：期望 ${meta.size}，实际 ${stat.size}`);
        }

        const recording = await createRecording(mergedPath, mergedName, meta);
        meta.status = 'completed';
        meta.recordingId = recording?.id || recording?.recordingId || null;
        meta.updatedAt = Date.now();
        writeMeta(uploadId, meta);
        // 录音创建成功后只清理分片，保留 meta 供重复 complete 幂等返回。
        for (let i = 0; i < meta.totalChunks; i++) {
          try { fs.unlinkSync(chunkPath(uploadId, i)); } catch { /* ignore */ }
        }
        try { if (fs.existsSync(mergedPath)) fs.unlinkSync(mergedPath); } catch { /* ignore */ }
        return recording;
      } catch (error) {
        try { if (fs.existsSync(mergedPath)) fs.unlinkSync(mergedPath); } catch { /* ignore */ }
        throw error;
      }
    } catch (error) {
      const latest = readMeta(uploadId);
      if (latest && latest.status === 'completing') {
        latest.status = 'uploading';
        latest.updatedAt = Date.now();
        writeMeta(uploadId, latest);
      }
      throw error;
    } finally {
      completing.delete(uploadId);
    }
  })();
  completing.set(uploadId, task);
  return task;
}

function findMissing(received, total) {
  const set = new Set(received);
  const missing = [];
  for (let i = 0; i < total; i++) {
    if (!set.has(i)) missing.push(i);
  }
  return missing;
}

module.exports = {
  DEFAULT_CHUNK_SIZE,
  init,
  status,
  saveChunk,
  complete,
  deleteSession,
  cleanExpired,
};
