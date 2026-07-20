// 队列抽象层：根据环境变量自动选择内存队列或 Redis 队列
// - 无 REDIS_URL：使用内存队列（开发模式，pipeline 在 API 进程内执行）
// - 有 REDIS_URL：使用 BullMQ 队列（生产模式，需配合 worker.js 独立进程消费）

const memory = require('./memory');
const redis = require('./redis');

function select() {
  if (process.env.REDIS_URL || process.env.REDIS_HOST) {
    try {
      require('bullmq');
      return redis;
    } catch {
      console.warn('[queue] REDIS_URL 已设置但 bullmq 未安装，降级为内存队列');
    }
  }
  return memory;
}

let adapter = select();

module.exports = {
  get name() { return adapter.name; },
  enqueue: (...a) => adapter.enqueue(...a),
  start: (...a) => adapter.start(...a),
  close: (...a) => adapter.close(...a),
  getStats: () => adapter.getStats ? adapter.getStats() : Promise.resolve({}),
  get isMemory() { return adapter === memory; },
};
