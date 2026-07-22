// 服务生命周期辅助函数：停止接收请求后，再关闭队列和存储连接。

function closeHttpServer(server, timeoutMs) {
  if (!server || typeof server.close !== 'function') return Promise.resolve();
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      const error = new Error(`HTTP 服务关闭超时（${timeoutMs}ms）`);
      error.code = 'SHUTDOWN_TIMEOUT';
      finish(error);
    }, timeoutMs);
    server.close(finish);
  });
}

function createShutdown({ server, cleanupTimer, closeQueue, closeStore, timeoutMs = 30_000, onExit = () => {} }) {
  let shuttingDown = false;
  return async function shutdown(signal) {
    if (shuttingDown) return false;
    shuttingDown = true;
    clearInterval(cleanupTimer);
    try {
      await closeHttpServer(server, timeoutMs);
      await closeQueue();
      await closeStore();
      await onExit(0);
      return true;
    } catch (error) {
      await onExit(1, error, signal);
      return false;
    }
  };
}

module.exports = { closeHttpServer, createShutdown };
