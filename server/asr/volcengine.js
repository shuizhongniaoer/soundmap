// 火山引擎·豆包录音文件识别 2.0（Seed-ASR 2.0，字节跳动）
// 文档: https://www.volcengine.com/docs/6561/1354868
// 鉴权: x-api-key（新版豆包语音控制台 https://console.volcengine.com/speech/new/ 创建）
// 音频通过 URL 提交（用 PUBLIC_BASE_URL，与百炼同机制）；自带说话人分离。
const crypto = require('crypto');

const SUBMIT_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit';
const QUERY_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query';
const RESOURCE_ID = 'volc.seedasr.auc';
const { fetchWithTimeout } = require('../http');

function headers(requestId, withSequence) {
  const key = (process.env.VOLC_API_KEY || '').trim();
  if (!key) throw new Error('缺少 VOLC_API_KEY');
  const h = {
    'Content-Type': 'application/json',
    'x-api-key': key,
    'X-Api-Resource-Id': RESOURCE_ID,
    'X-Api-Request-Id': requestId,
  };
  if (withSequence) h['X-Api-Sequence'] = '-1';
  return h;
}

module.exports = {
  name: 'volcengine',
  async transcribe({ fileUrl, filename }) {
    if (!fileUrl || fileUrl.includes('localhost') || fileUrl.includes('127.0.0.1')) {
      throw new Error('豆包需要可公网访问的音频 URL，请确认 PUBLIC_BASE_URL（cpolar）已配置且服务可达。');
    }
    // 预检：先自己从公网下载一下这个地址，确认外部服务器真的能拿到音频
    try {
      const pre = await fetch(fileUrl, {
        headers: { Range: 'bytes=0-1023' },
        signal: AbortSignal.timeout(10000),
        redirect: 'follow',
      });
      const ct = pre.headers.get('content-type') || '';
      if (!pre.ok) throw new Error(`HTTP ${pre.status}`);
      if (/text\/html/i.test(ct)) throw new Error(`返回的是网页（${ct}），隧道在弹拦截页而不是音频`);
    } catch (e) {
      throw new Error(`音频公网地址预检失败: ${e.message}\nURL: ${fileUrl}\n请检查 cpolar 是否在线、地址是否最新、主服务是否在跑`);
    }
    console.log('[volcengine] 预检通过，提交转写:', fileUrl);

    const format = (filename.split('.').pop() || 'mp3').toLowerCase();
    const requestId = crypto.randomUUID();

    // 1. 提交任务（结果状态在响应头 X-Api-Status-Code）
    const sub = await fetchWithTimeout(SUBMIT_URL, {
      method: 'POST',
      headers: headers(requestId, true),
      body: JSON.stringify({
        user: { uid: 'soundmap' },
        audio: { url: fileUrl, format },
        request: {
          model_name: 'bigmodel',
          enable_itn: true,
          enable_punc: true,
          enable_ddc: true,
          show_utterances: true,
          enable_speaker_info: true,
        },
      }),
    });
    const subStatus = sub.headers.get('X-Api-Status-Code');
    if (subStatus !== '20000000') {
      throw new Error(`豆包提交失败 ${subStatus}: ${sub.headers.get('X-Api-Message') || await sub.text()}`);
    }

    // 2. 轮询（20000001/2=处理中, 20000000=完成, 20000003=静音）
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const res = await fetchWithTimeout(QUERY_URL, {
        method: 'POST',
        headers: headers(requestId, false),
        body: '{}',
      });
      const st = res.headers.get('X-Api-Status-Code');
      if (st === '20000001' || st === '20000002') continue;
      if (st === '20000003') return { language: 'zh', segments: [] };
      if (st !== '20000000') {
        throw new Error(`豆包查询失败 ${st}: ${res.headers.get('X-Api-Message') || ''}`);
      }
      const data = await res.json();
      const result = data.result || {};
      const utts = result.utterances || [];
      const segments = [];
      for (const u of utts) {
        const text = (u.text || '').trim();
        if (!text) continue;
        const spk = u.speaker ?? (u.additions && u.additions.speaker);
        segments.push({
          start: Math.round((u.start_time ?? u.start ?? 0) / 1000),
          end: Math.round((u.end_time ?? u.end ?? 0) / 1000),
          speaker: `说话人${spk != null ? spk : '1'}`,
          text,
        });
      }
      if (!segments.length && (result.text || '').trim()) {
        segments.push({ start: 0, end: 0, speaker: '说话人1', text: result.text.trim() });
      }
      return { language: 'zh', segments };
    }
    throw new Error('豆包转写超时');
  },
};
