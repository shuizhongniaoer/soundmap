// 让 Express 4 自动捕获异步路由的 rejected Promise，交给统一错误中间件处理。
function wrapAsync(handler) {
  if (handler?.constructor?.name !== 'AsyncFunction') return handler;
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function installAsyncRouteHandling(app) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const original = app[method].bind(app);
    app[method] = (path, ...handlers) => original(path, ...handlers.map(wrapAsync));
  }
  return app;
}

module.exports = { wrapAsync, installAsyncRouteHandling };
