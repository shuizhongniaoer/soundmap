// 本地转写 provider：调用同机的 FunASR Python 服务（local-asr/）
// 零 API 成本；质量约等于云端"标准版"，含说话人分离与热词
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const BASE = (process.env.LOCAL_ASR_URL || 'http://127.0.0.1:8100').replace(/\/$/, '');

module.exports = {
  name: 'local',
  async transcribe({ filename }) {
    let hotwords = [];
    try { hotwords = require('../store').getMeta('hotwords') || []; } catch { /* ignore */ }
    let res;
    try {
      res = await fetch(`${BASE}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path.join(UPLOAD_DIR, filename), hotwords }),
      });
    } catch (e) {
      throw new Error(`本地转写服务未启动（${BASE}）。先运行 local-asr/start.sh，首次需下载模型。原始错误: ${e.message}`);
    }
    if (!res.ok) {
      throw new Error(`本地转写服务错误 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return await res.json();
  },
};
