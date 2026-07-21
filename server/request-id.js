// 为每个请求生成可追踪的 ID；仅接受安全字符，避免响应头注入。
const crypto = require('crypto');

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function getRequestId(req) {
  const candidate = req.requestId || req.get?.('x-request-id');
  return SAFE_REQUEST_ID.test(String(candidate || '')) ? String(candidate) : crypto.randomUUID();
}

function requestIdMiddleware(req, res, next) {
  req.requestId = getRequestId(req);
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

module.exports = { SAFE_REQUEST_ID, getRequestId, requestIdMiddleware };
