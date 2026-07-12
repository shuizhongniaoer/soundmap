// ASR 供应商抽象层：统一返回 { language, segments: [{ start, end, speaker, text }] }
// 支持按录音指定引擎（长录音/重要内容用讯飞，短对话用百炼，各取所长）
const mock = require('./mock');
const dashscope = require('./dashscope');
const xfyun = require('./xfyun');

function available(name) {
  if (name === 'dashscope') return !!process.env.DASHSCOPE_API_KEY;
  if (name === 'xfyun') {
    return !!(process.env.XFYUN_APPID && process.env.XFYUN_API_KEY && process.env.XFYUN_API_SECRET);
  }
  return name === 'mock';
}

// name 可为 'dashscope' | 'xfyun' | 'mock' | 空（用 .env 默认）
function resolve(name) {
  const want = (name || process.env.ASR_PROVIDER || 'mock').toLowerCase();
  if (want === 'dashscope' && available('dashscope')) return dashscope;
  if (want === 'xfyun' && available('xfyun')) return xfyun;
  if (want !== 'mock') console.warn(`[asr] ${want} 不可用（缺少凭证），降级为 mock`);
  return mock;
}

module.exports = {
  resolve,
  available,
  get name() { return resolve().name; },
  transcribe(opts) { return resolve().transcribe(opts); },
};
