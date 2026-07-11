// 阿里百炼 Paraformer 录音文件转写（异步任务模式）
// 文档: https://help.aliyun.com/zh/model-studio/recording-file-recognition
// 注意: file_urls 必须可公网访问。本地开发需配置 PUBLIC_BASE_URL（ngrok/cpolar 等），
//       生产环境上传 OSS 后用 OSS URL。
const BASE = 'https://dashscope.aliyuncs.com/api/v1';

async function dsFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`DashScope ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

module.exports = {
  name: 'dashscope',
  /**
   * @param {{ fileUrl?: string, filename: string }} opts
   */
  async transcribe({ fileUrl }) {
    if (!fileUrl || fileUrl.includes('localhost') || fileUrl.includes('127.0.0.1')) {
      throw new Error('paraformer 需要可公网访问的音频 URL。请设置 PUBLIC_BASE_URL（如 ngrok 公网地址），或将 ASR_PROVIDER 设为 mock。');
    }

    // 1. 提交异步转写任务
    const task = await dsFetch(`${BASE}/services/audio/asr/transcription`, {
      method: 'POST',
      headers: { 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({
        model: process.env.ASR_MODEL || 'paraformer-v2',
        input: { file_urls: [fileUrl] },
        parameters: { diarization_enabled: true, language_hints: ['zh', 'en'] },
      }),
    });
    const taskId = task.output && task.output.task_id;
    if (!taskId) throw new Error('提交转写任务失败: ' + JSON.stringify(task));

    // 2. 轮询任务状态（最长 10 分钟）
    let result;
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000));
      result = await dsFetch(`${BASE}/tasks/${taskId}`);
      const st = result.output && result.output.task_status;
      if (st === 'SUCCEEDED') break;
      if (st === 'FAILED') throw new Error('转写任务失败: ' + JSON.stringify(result.output));
    }
    const item = result.output.results && result.output.results[0];
    if (!item || item.subtask_status !== 'SUCCEEDED') {
      throw new Error('转写子任务失败: ' + JSON.stringify(item));
    }

    // 3. 拉取转写结果 JSON 并归一化
    const detail = await (await fetch(item.transcription_url)).json();
    const segments = [];
    for (const tr of detail.transcripts || []) {
      for (const s of tr.sentences || []) {
        segments.push({
          start: Math.round((s.begin_time || 0) / 1000),
          end: Math.round((s.end_time || 0) / 1000),
          speaker: s.speaker_id != null ? `说话人${s.speaker_id + 1}` : '说话人1',
          text: (s.text || '').trim(),
        });
      }
    }
    return { language: 'zh', segments };
  },
};
