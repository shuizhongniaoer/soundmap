// Redis 队列适配器（生产模式）—— 基于 BullMQ，支持多 Worker、重试、优先级
// 需要设置 REDIS_URL 环境变量

let Queue, Worker;
try {
  ({ Queue, Worker } = require('bullmq'));
} catch {
  // bullmq 未安装时延迟报错
}

const crypto = require('crypto');
const QUEUE_NAME = 'soundmap:transcribe';
let _queue = null;
let _worker = null;

function jobKey(recordingId, options = {}) {
  const payload = JSON.stringify({
    recordingId,
    parts: Array.isArray(options.parts) ? [...options.parts].sort() : null,
    summaryTemplate: options.summaryTemplate || null,
    version: options.version || 1,
  });
  return `recording-${recordingId}-${crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16)}`;
}

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
      jobId: jobKey(recordingId, options),
      attempts: 3,           // 初次执行失败后重试 2 次
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100, // 保留最近 100 条完成记录
      removeOnFail: 200,
    });
  },

  async checkReady() {
    await getQueue().getJobCounts();
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
      // 任务超时由 pipeline 控制；这里让 BullMQ 在 Worker 中断后尽快回收锁并重派任务。
      lockDuration: Number(process.env.QUEUE_LOCK_DURATION_MS || 35 * 60 * 1000),
      stalledInterval: Number(process.env.QUEUE_STALLED_INTERVAL_MS || 30_000),
      maxStalledCount: Number(process.env.QUEUE_MAX_STALLED_COUNT || 1),
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
