// Redis 队列适配器（生产模式）—— 基于 BullMQ，支持多 Worker、重试、优先级
// 需要设置 REDIS_URL 环境变量

let Queue, Worker;
try {
  ({ Queue, Worker } = require('bullmq'));
} catch {
  // bullmq 未安装时延迟报错
}

const QUEUE_NAME = 'soundmap:transcribe';
let _queue = null;
let _worker = null;

function requireBullMQ() {
  if (!Queue) throw new Error('Redis 队列模式需要安装 bullmq 和 ioredis');
}

function connection() {
  return {
    url: process.env.REDIS_URL,
    // bullmq 内部用 ioredis，支持 url 或 host/port
    ...(process.env.REDIS_HOST ? { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT || 6379) } : {}),
    ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
    maxRetriesPerRequest: null, // bullmq 要求
  };
}

function getQueue() {
  requireBullMQ();
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, { connection: connection() });
  }
  return _queue;
}

module.exports = {
  name: 'redis',

  async enqueue(recordingId, options = {}) {
    const queue = getQueue();
    await queue.add('transcribe', { recordingId, options }, {
      attempts: 2,           // 失败重试 1 次
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100, // 保留最近 100 条完成记录
      removeOnFail: 200,
    });
  },

  // 启动 Worker 消费队列（在独立 worker 进程中调用）
  async start(processor) {
    requireBullMQ();
    if (_worker) return;
    _worker = new Worker(QUEUE_NAME, async (job) => {
      const { recordingId, options } = job.data;
      console.log(`[queue:redis] 开始处理 ${recordingId} (job=${job.id})`);
      await processor(recordingId, options || {});
      console.log(`[queue:redis] 完成 ${recordingId} (job=${job.id})`);
    }, {
      connection: connection(),
      concurrency: Number(process.env.QUEUE_CONCURRENCY || 2),
    });
    _worker.on('failed', (job, err) => {
      console.error(`[queue:redis] ${job?.data?.recordingId} 失败:`, err.message);
    });
  },

  async close() {
    if (_worker) await _worker.close();
    if (_queue) await _queue.close();
  },

  async getStats() {
    if (!_queue) return { pending: 0, active: 0 };
    const [waiting, active, completed, failed] = await Promise.all([
      _queue.getWaitingCount(),
      _queue.getActiveCount(),
      _queue.getCompletedCount(),
      _queue.getFailedCount(),
    ]);
    return { waiting, active, completed, failed };
  },
};
