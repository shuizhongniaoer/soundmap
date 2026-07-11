// ASR 供应商抽象层：统一返回 { language, segments: [{ start, end, speaker, text }] }
const mock = require('./mock');
const dashscope = require('./dashscope');

function resolveProvider() {
  const want = (process.env.ASR_PROVIDER || 'mock').toLowerCase();
  if (want === 'dashscope') {
    if (!process.env.DASHSCOPE_API_KEY) {
      console.warn('[asr] ASR_PROVIDER=dashscope 但未配置 DASHSCOPE_API_KEY，降级为 mock');
      return mock;
    }
    return dashscope;
  }
  return mock;
}

module.exports = {
  get name() { return resolveProvider().name; },
  transcribe(opts) { return resolveProvider().transcribe(opts); },
};
