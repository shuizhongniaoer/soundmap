// 对象存储抽象层：根据环境变量自动选择本地磁盘或 S3
// - 无 S3_BUCKET：使用本地磁盘（开发模式）
// - 有 S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY：使用 S3 兼容存储

const local = require('./local');
const s3 = require('./s3');

function select() {
  if (process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
    return s3;
  }
  return local;
}

let adapter = select();

module.exports = {
  get name() { return adapter.name; },
  save: (...a) => adapter.save(...a),
  saveBuffer: (...a) => adapter.saveBuffer(...a),
  getStream: (...a) => adapter.getStream(...a),
  getUrl: (...a) => adapter.getUrl(...a),
  getAsLocalPath: (...a) => adapter.getAsLocalPath(...a),
  exists: (...a) => adapter.exists(...a),
  delete: (...a) => adapter.delete(...a),
  size: (...a) => adapter.size(...a),
  // 本地模式才有 verify（S3 模式直接用预签名 URL，不需要服务器签名验证）
  verify: (...a) => adapter.verify ? adapter.verify(...a) : false,
  get hasPersistentSecret() { return adapter.hasPersistentSecret; },
  get isLocal() { return adapter === local; },
  get uploadDir() { return adapter.uploadDir || null; },
};
