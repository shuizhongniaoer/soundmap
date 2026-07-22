// 轻量进程内 API 限流。多实例部署时应在网关或 Redis 层提供共享限流。
const buckets = new Map();
let lastSweepAt = 0;

function clientKey(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

function createRateLimit({
  windowEnv = 'API_RATE_LIMIT_WINDOW_MS',
  maxEnv = 'API_RATE_LIMIT_MAX',
  defaultWindowMs = 60 * 1000,
  defaultMaxRequests = 120,
  namespace = 'api',
} = {}) {
  return function configuredRateLimit(req, res, next) {
    const windowMs = Number(process.env[windowEnv] || defaultWindowMs);
    const maxRequests = Number(process.env[maxEnv] || defaultMaxRequests);
    return applyRateLimit(req, res, next, windowMs, maxRequests, namespace);
  };
}

function applyRateLimit(req, res, next, windowMs, maxRequests, namespace) {
  if (!Number.isFinite(windowMs) || windowMs <= 0 || !Number.isFinite(maxRequests) || maxRequests <= 0) return next();
  const now = Date.now();
  const key = `${namespace}:${clientKey(req)}`;
  const sweepIntervalMs = Math.min(windowMs, 60 * 1000);
  if (now - lastSweepAt >= sweepIntervalMs) {
    lastSweepAt = now;
    for (const [bucketKey, bucket] of buckets) {
      if (now - bucket.startedAt >= windowMs) buckets.delete(bucketKey);
    }
  }
  if (buckets.size >= 10000 && !buckets.has(key)) return next();
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

const rateLimit = createRateLimit({ namespace: 'api' });

function clearRateLimitState() {
  buckets.clear();
  lastSweepAt = 0;
}

function getRateLimitStateSize() {
  return buckets.size;
}

module.exports = { rateLimit, createRateLimit, clearRateLimitState, getRateLimitStateSize };
