// 进程级异常兜底：记录结构化上下文，并交由调用方执行优雅退出。
function installProcessErrorHandlers({ logError, shutdown, processObject = process }) {
  let handling = false;
  const handle = (error, source) => {
    logError(`process.${source}`, error);
    if (handling) return;
    handling = true;
    Promise.resolve(shutdown(source)).catch(exitError => {
      logError('process.shutdown_failed', exitError, { source });
      process.exitCode = 1;
    });
  };
  const onException = error => handle(error, 'uncaught_exception');
  const onRejection = reason => handle(reason instanceof Error ? reason : new Error(String(reason)), 'unhandled_rejection');
  processObject.on('uncaughtException', onException);
  processObject.on('unhandledRejection', onRejection);
  return () => {
    processObject.off('uncaughtException', onException);
    processObject.off('unhandledRejection', onRejection);
  };
}

module.exports = { installProcessErrorHandlers };
