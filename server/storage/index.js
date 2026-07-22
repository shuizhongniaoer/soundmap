// 存储抽象层：根据环境变量自动选择 JSON 文件存储或 PostgreSQL
// - 无 DATABASE_URL：使用 JSON 文件存储（开发模式，同步）
// - 有 DATABASE_URL：使用 PostgreSQL（需先执行 migrations.sql，异步）
// 所有方法统一返回 Promise，调用方需 await

const json = require('./json');
const pg = require('./pg');
const { write: writeLog } = require('../logger');

function select() {
  if (process.env.DATABASE_URL) {
    try {
      require('pg');
      writeLog('log', 'storage.selected', { adapter: 'postgresql' });
      return pg;
    } catch {
      throw new Error('DATABASE_URL 已设置但 pg 未安装，拒绝降级为 JSON 存储');
    }
  }
  if (/^(production|prod)$/i.test(process.env.NODE_ENV || '')) {
    throw new Error('生产环境必须配置 DATABASE_URL，拒绝使用 JSON 文件存储');
  }
  return json;
}

const adapter = select();
const isJson = adapter === json;

// 同步方法包装为 Promise（JSON 适配器用）
function p(fn) {
  return function (...args) {
    try {
      return Promise.resolve(fn.apply(this, args));
    } catch (err) {
      return Promise.reject(err);
    }
  };
}

// 列出所有需要包装的方法
const methods = [
  'list', 'listForUser', 'get', 'getForUser', 'create', 'update',
  'getMeta', 'setMeta',
  'findWechatUser', 'upsertWechatUser', 'getOrCreateLocalUser', 'getUser',
  'createSession', 'findSession', 'deleteSession',
  'createOauthState', 'consumeOauthState',
  'createDownloadToken', 'consumeDownloadToken', 'checkReady',
];

const facade = {};
for (const m of methods) {
  const fn = adapter[m];
  if (isJson) {
    facade[m] = p(fn.bind(adapter));
  } else {
    facade[m] = fn.bind(adapter); // PG 已是 async
  }
}
facade.name = adapter.name;
facade.isJson = isJson;
facade.close = () => adapter.close ? adapter.close() : Promise.resolve();

module.exports = facade;
