// S3 兼容对象存储适配器（支持 AWS S3 / MinIO / 阿里云 OSS / 腾讯云 COS）
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pipeline } = require('stream/promises');

let S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand;
let getSignedUrl;

try {
  ({ S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3'));
  ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
} catch {
  // SDK 未安装时延迟报错
}

function requireSdk() {
  if (!S3Client) throw new Error('S3 模式需要安装 @aws-sdk/client-s3 和 @aws-sdk/s3-request-presigner');
}

function client() {
  requireSdk();
  const endpoint = process.env.S3_ENDPOINT; // 如 https://s3.amazonaws.com 或 MinIO 地址
  const region = process.env.S3_REGION || 'us-east-1';
  const forcePathStyle = /^(true|1|yes)$/i.test(process.env.S3_FORCE_PATH_STYLE || '');
  return new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
}

let _client;
function getClient() {
  if (!_client) _client = client();
  return _client;
}

const bucket = () => process.env.S3_BUCKET;

module.exports = {
  name: 's3',

  async save(localPath, key, contentType) {
    requireSdk();
    const Body = fs.createReadStream(localPath);
    await getClient().send(new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body,
      ContentType: contentType || 'application/octet-stream',
    }));
    return key;
  },

  async saveBuffer(buffer, key, contentType) {
    requireSdk();
    await getClient().send(new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    }));
    return key;
  },

  // 返回可读流（用于 HTTP 代理响应）
  async getStream(key) {
    requireSdk();
    const res = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return res.Body; // S3 返回的流
  },

  // 返回预签名 URL（ASR 供应商直接从 S3 拉取，不走我们的服务器）
  async getUrl(key, ttlSeconds = 15 * 60) {
    requireSdk();
    return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: ttlSeconds });
  },

  // 下载到本地临时文件（ffmpeg 预处理需要本地文件）
  async getAsLocalPath(key) {
    requireSdk();
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'soundmap-blob-'));
    const tmpPath = path.join(tmpDir, path.basename(key));
    const res = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    await pipeline(res.Body, fs.createWriteStream(tmpPath));
    return {
      path: tmpPath,
      cleanup: () => { fs.rm(tmpDir, { recursive: true, force: true }, () => {}); },
    };
  },

  async exists(key) {
    requireSdk();
    try {
      await getClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
      return true;
    } catch { return false; }
  },

  async delete(key) {
    requireSdk();
    try { await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })); } catch { /* ignore */ }
  },

  async size(key) {
    requireSdk();
    try {
      const res = await getClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
      return res.ContentLength || 0;
    } catch { return 0; }
  },

  get hasPersistentSecret() { return true; },
};
