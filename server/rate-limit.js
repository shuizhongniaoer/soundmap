// 轻量进程内 API 限流。多实例部署时应在网关或 Redis 层提供共享限流。
function config() {
  return {
    windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60 * 1000),
    maxRequests: Number(process.env.API_RATE_LIMIT_MAX || 120),
  };
}
const buckets = new Map();

function clientKey(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

function createRateLimit({ windowEnv = 'API_RATE_LIMIT_WINDOW_MS', maxEnv = 'API_RATE_LIMIT_MAX' } = {}) {
  return function configuredRateLimit(req, res, next) {
    const windowMs = Number(process.env[windowEnv] || 60 * 1000);
    const maxRequests = Number(process.env[maxEnv] || 120);
    return applyRateLimit(req, res, next, windowMs, maxRequests);
  };
}

function applyRateLimit(req, res, next, windowMs, maxRequests) {
  if (!Number.isFinite(windowMs) || windowMs <= 0 || !Number.isFinite(maxRequests) || maxRequests <= 0) return next();
  const now = Date.now();
  const key = clientKey(req);
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    bucket = { startedAt: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count++;
  const remaining = Math.max(0, maxRequests - bucket.count);
  res.setHeader('X-RateLimit-Limit', String(maxRequests));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil((bucket.startedAt + windowMs) / 1000)));
  if (bucket.count > maxRequests) {
    const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + windowMs - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: '请求过于频繁，请稍后再试', code: 'RATE_LIMITED' });
  }
  return next();
}

const rateLimit = createRateLimit();

function clearRateLimitState() {
  buckets.clear();
}

module.exports = { rateLimit, createRateLimit, clearRateLimitState };
