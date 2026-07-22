#!/usr/bin/env node
// 独立 Worker 进程：消费 Redis 队列中的转写任务
// 用法: node server/worker.js
// 需要: REDIS_URL 环境变量

require('dotenv').config();

const queue = require('./queue');
const store = require('./store');
const pipeline = require('./pipeline');
const { createShutdown } = require('./lifecycle');
const { write: writeLog } = require('./logger');

if (queue.isMemory) {
  console.error('[worker] 当前为内存队列模式，无需独立 Worker。请设置 REDIS_URL 后再启动 Worker。');
  process.exit(1);
}

writeLog('log', 'worker.started', {
  queue: queue.name,
  asrProvider: require('./asr').name,
  llmProvider: require('./llm').name,
});

queue.start(async (recordingId, options) => {
  await pipeline.process(recordingId, options);
});

const shutdown = createShutdown({
  server: null,
  cleanupTimer: null,
  closeQueue: () => queue.close(),
  closeStore: () => store.close(),
  onExit: (code, error, signal) => {
    if (error) writeLog('error', 'worker.shutdown_failed', { signal, error: error.message, code: error.code });
    else writeLog('log', 'worker.stopped', { code });
    process.exit(code);
  },
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
