// 统一结构化日志，并对常见凭据字段和 URL 查询参数做脱敏。
const SENSITIVE_KEY = /password|secret|token|authorization|cookie|api[_-]?key|access[_-]?token|appsecret/i;
const SENSITIVE_QUERY = /^(password|token|code|secret|key|signature|authorization)$/i;

function redact(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactUrl(value);
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  }
  return value;
}

function redactUrl(value) {
  if (!/^https?:\/\//i.test(value)) {
    return String(value).replace(/((?:password|token|secret|signature|code|api[_-]?key)=)[^&\s]+/gi, '$1[REDACTED]');
  }
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_QUERY.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return url.toString();
  } catch {
    return value;
  }
}

function write(level, event, fields = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...redact(fields),
  };
  const output = JSON.stringify(entry);
  (console[level] || console.log)(output);
}

function logRequest(req, res, startedAt) {
  write('log', 'http.request', {
    requestId: req.requestId,
    method: req.method,
    path: redactUrl(req.originalUrl || req.url || ''),
    status: res.statusCode,
    durationMs: Date.now() - startedAt,
    userId: req.user?.id || null,
  });
}

function requestLogger(req, res, next) {
  const startedAt = Date.now();
  res.once('finish', () => logRequest(req, res, startedAt));
  next();
}

function logError(event, error, fields = {}) {
  write('error', event, {
    ...fields,
    error: {
      name: error?.name,
      message: redact(error?.message || String(error)),
      code: error?.code,
      status: error?.status,
      stack: error?.stack,
    },
  });
}

module.exports = { redact, write, logRequest, requestLogger, logError };
