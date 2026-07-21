// 为单个异步任务提供可配置的总时限，避免第三方轮询或本地服务无响应长期占用 Worker。
function withDeadline(task, deadlineAt, message = '任务执行超时') {
  if (!deadlineAt) return Promise.resolve(task);
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return Promise.reject(new Error(message));

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), remaining);
    timer.unref?.();
  });
  return Promise.race([Promise.resolve(task), timeout]).finally(() => clearTimeout(timer));
}

module.exports = { withDeadline };
