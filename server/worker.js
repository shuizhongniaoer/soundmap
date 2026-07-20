#!/usr/bin/env node
// 独立 Worker 进程：消费 Redis 队列中的转写任务
// 用法: node server/worker.js
// 需要: REDIS_URL 环境变量

require('dotenv').config();

const queue = require('./queue');
const pipeline = require('./pipeline');

if (queue.isMemory) {
  console.error('[worker] 当前为内存队列模式，无需独立 Worker。请设置 REDIS_URL 后再启动 Worker。');
  process.exit(1);
}

console.log(`[worker] 启动 BullMQ Worker (queue=${queue.name})`);
console.log(`[worker] ASR provider: ${require('./asr').name} | LLM provider: ${require('./llm').name}`);

queue.start(async (recordingId, options) => {
  await pipeline.process(recordingId, options);
});

// 优雅关闭
async function shutdown(signal) {
  console.log(`[worker] 收到 ${signal}，正在关闭...`);
  await queue.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
