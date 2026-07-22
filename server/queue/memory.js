// 内存队列适配器（开发模式）—— 直接在进程内异步执行 pipeline
// 与 Phase 0 行为完全一致，保证零配置开箱即用

const pending = new Map();
let closing = false;

module.exports = {
  name: 'memory',

  async enqueue(recordingId, options = {}) {
    if (closing) throw new Error('内存队列正在关闭，暂不接受新任务');
    const pipeline = require('../pipeline');
    const taskKey = `${recordingId}:${JSON.stringify(options)}`;
    if (pending.has(taskKey)) return { deduplicated: true };
    let resolveTask;
    const task = new Promise(resolve => { resolveTask = resolve; });
    pending.set(taskKey, task);
    setImmediate(async () => {
      try {
        await pipeline.process(recordingId, options);
      } catch (err) {
        console.error(`[queue:memory] ${recordingId} 失败:`, err.message);
      } finally {
        pending.delete(taskKey);
        resolveTask();
      }
    });
    return { deduplicated: false };
  },

  // 内存模式下 start 是空操作（pipeline 在 enqueue 时已直接执行）。
  async checkReady() { /* 内存队列始终可用。 */ },
  async start() { /* no-op */ },
  async close() {
    closing = true;
    await Promise.all([...pending.values()]);
  },
  get stats() { return { pending: pending.size, active: pending.size }; },
};
