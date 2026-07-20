// 内存队列适配器（开发模式）—— 直接在进程内异步执行 pipeline
// 与 Phase 0 行为完全一致，保证零配置开箱即用

const pending = new Map(); // id -> AbortController（用于取消正在执行的任务）

module.exports = {
  name: 'memory',

  async enqueue(recordingId, options = {}) {
    // 异步执行，不阻塞 API 响应
    const pipeline = require('../pipeline');
    setImmediate(async () => {
      try {
        await pipeline.process(recordingId, options);
      } catch (err) {
        console.error(`[queue:memory] ${recordingId} 失败:`, err.message);
      }
    });
  },

  // 内存模式下 start 是空操作（pipeline 在 enqueue 时已直接执行）
  async start() { /* no-op */ },
  async close() { /* no-op */ },
  get stats() { return { pending: 0, active: pending.size }; },
};
