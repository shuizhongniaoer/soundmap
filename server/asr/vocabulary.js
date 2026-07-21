// 百炼热词表同步：本地存热词列表（store.meta.hotwords），
// 变更时通过 speech-biasing 定制接口创建/更新词表，转写时引用 vocabulary_id。
// 文档: https://www.alibabacloud.com/help/zh/model-studio/custom-hot-words/
const store = require('../store');

const HOST = (process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com').replace(/\/$/, '');
const URL = `${HOST}/api/v1/services/audio/asr/customization`;
const { fetchWithTimeout } = require('../http');

async function call(input) {
  const res = await fetchWithTimeout(URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'speech-biasing', input }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch {
    throw new Error(`热词接口返回非 JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`热词接口 ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

// words: string[] -> 同步到百炼，返回 vocabulary_id（空列表则删除词表并返回 null）
async function sync(words, userId = 'local') {
  const suffix = userId && userId !== 'local' ? `:${userId}` : '';
  const key = `vocabularyId${suffix}`;
  const existing = await store.getMeta(key);
  if (!words.length) {
    if (existing) {
      try { await call({ action: 'delete_vocabulary', vocabulary_id: existing }); } catch {}
      await store.setMeta(key, null);
    }
    return null;
  }
  const vocabulary = words.map(w => ({ text: w, weight: 4, lang: 'zh' }));
  if (existing) {
    await call({ action: 'update_vocabulary', vocabulary_id: existing, vocabulary });
    return existing;
  }
  const out = await call({
    action: 'create_vocabulary',
    target_model: process.env.ASR_MODEL || 'fun-asr',
    prefix: 'sndmp',
    vocabulary,
  });
  const id = out.output && out.output.vocabulary_id;
  if (!id) throw new Error('创建热词表未返回 ID: ' + JSON.stringify(out));
  await store.setMeta(key, id);
  return id;
}

module.exports = { sync };
