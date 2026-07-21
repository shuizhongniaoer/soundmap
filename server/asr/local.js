// 本地转写 provider：调用同机的 FunASR Python 服务（local-asr/）
// 零 API 成本；质量约等于云端"标准版"，含说话人分离与热词
// 注意：仅适用于本地存储模式（blobs.isLocal）。S3 模式下文件不在本地磁盘，需用云端 ASR。
const path = require('path');
const blobs = require('../blobs');
const { fetchWithTimeout } = require('../http');

const BASE = (process.env.LOCAL_ASR_URL || 'http://127.0.0.1:8100').replace(/\/$/, '');

module.exports = {
  name: 'local',
  async transcribe({ filename, userId }) {
    let hotwords = [];
    try {
      const suffix = userId && userId !== 'local' ? `:${userId}` : '';
      hotwords = await require('../store').getMeta(`hotwords${suffix}`) || [];
    } catch { /* ignore */ }
    // 获取本地文件路径（S3 模式会下载到临时目录）
    const local = await blobs.getAsLocalPath(filename);
    if (!local) throw new Error(`音频文件不存在: ${filename}`);
    const filePath = local.path;
    const cleanup = local.cleanup || (() => {});
    try {
      let res;
      try {
        res = await fetchWithTimeout(`${BASE}/transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath, hotwords }),
        });
      } catch (e) {
        throw new Error(`本地转写服务未启动（${BASE}）。先运行 local-asr/start.sh，首次需下载模型。原始错误: ${e.message}`);
      }
      if (!res.ok) {
        throw new Error(`本地转写服务错误 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      return await res.json();
    } finally {
      cleanup();
    }
  },
};
