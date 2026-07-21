// 外部 HTTP 请求统一超时，避免供应商连接或响应卡住后长期占用 Worker。
const DEFAULT_HTTP_TIMEOUT_MS = Number(process.env.SOUNDMAP_HTTP_TIMEOUT_MS || 30_000);

function timeoutFor(timeoutMs) {
  const value = Number(timeoutMs || DEFAULT_HTTP_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_HTTP_TIMEOUT_MS;
}

async function fetchWithTimeout(url, options = {}, timeoutMs) {
  const timeout = timeoutFor(timeoutMs);
  const signal = options.signal || AbortSignal.timeout(timeout);
  try {
    return await fetch(url, { ...options, signal });
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new Error(`外部请求超时（${timeout}ms）: ${new URL(url).hostname}`);
    }
    throw error;
  }
}

module.exports = { DEFAULT_HTTP_TIMEOUT_MS, fetchWithTimeout };
