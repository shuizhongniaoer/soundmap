// 异步处理管线: uploaded -> transcribing -> summarizing -> done | error
// Phase 0 用进程内异步执行；Phase 1 换 Redis 队列 + 独立 Worker
const store = require('./store');
const asr = require('./asr');
const llm = require('./llm');

async function run(id) {
  const rec = store.get(id);
  if (!rec) return;
  try {
    // 1. 转写（已有转写稿则跳过——说话人修正后重新生成时不重复付费转写）
    let transcript = rec.transcript;
    if (!transcript || !transcript.segments || !transcript.segments.length) {
      store.update(id, { status: 'transcribing' });
      const fileUrl = process.env.PUBLIC_BASE_URL
        ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/uploads/${encodeURIComponent(rec.filename)}`
        : null;
      transcript = await asr.transcribe({ fileUrl, filename: rec.filename });
      store.update(id, { transcript, status: 'summarizing' });
    } else {
      store.update(id, { status: 'summarizing' });
    }

    // 2. 总结 + 思维导图（并行）
    const [summary, mindmap] = await Promise.all([
      llm.summarize(transcript.segments, rec.title),
      llm.mindmap(transcript.segments, rec.title),
    ]);

    store.update(id, {
      summary,
      mindmap,
      title: rec.title || summary.title,
      status: 'done',
      providers: { asr: asr.name, llm: llm.name },
    });
    console.log(`[pipeline] ${id} 完成 (asr=${asr.name}, llm=${llm.name})`);
  } catch (err) {
    console.error(`[pipeline] ${id} 失败:`, err.message);
    store.update(id, { status: 'error', error: err.message });
  }
}

module.exports = { process: run };
