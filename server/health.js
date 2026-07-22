// 健康检查与就绪检查：就绪检查不返回依赖的内部错误细节。
async function checkReadiness({ store, queue }) {
  const checks = {};
  try {
    await store.checkReady();
    checks.storage = 'ok';
  } catch {
    checks.storage = 'failed';
  }
  try {
    await queue.checkReady();
    checks.queue = 'ok';
  } catch {
    checks.queue = 'failed';
  }
  const ready = Object.values(checks).every(value => value === 'ok');
  return { ready, checks };
}

module.exports = { checkReadiness };
