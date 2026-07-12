// 异步处理管线: uploaded -> transcribing -> summarizing -> done | error
// Phase 0 用进程内异步执行；Phase 1 换 Redis 队列 + 独立 Worker
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const store = require('./store');
const asr = require('./asr');
const llm = require('./llm');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

let ffmpegOk = null;
function hasFfmpeg() {
  if (ffmpegOk === null) {
    try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); ffmpegOk = true; }
    catch { ffmpegOk = false; console.warn('[pipeline] 未检测到 ffmpeg，跳过单声道预处理（brew install ffmpeg 可提升识别与说话人分离质量）'); }
  }
  return ffmpegOk;
}

// 说话人分离仅支持单声道；立体声/低码率会伤识别。
// 转写前统一转 16kHz 单声道 mp3（百炼与讯飞大模型版格式交集，m4a 讯飞不支持）。
function preprocess(filename) {
  if (!hasFfmpeg()) return filename;
  const src = path.join(UPLOAD_DIR, filename);
  const outName = filename.replace(/\.[^.]+$/, '') + '.asr.mp3';
  const out = path.join(UPLOAD_DIR, outName);
  try {
    if (!fs.existsSync(out)) {
      execFileSync('ffmpeg', ['-y', '-i', src, '-ac', '1', '-ar', '16000', '-b:a', '64k', out], { stdio: 'ignore' });
    }
    return outName;
  } catch (e) {
    console.warn('[pipeline] 音频预处理失败，使用原始文件:', e.message);
    return filename;
  }
}

async function run(id) {
  const rec = store.get(id);
  if (!rec) return;
  try {
    // 1. 转写（已有转写稿则跳过——说话人修正后重新生成时不重复付费转写）
    let transcript = rec.transcript;
    if (!transcript || !transcript.segments || !transcript.segments.length) {
      store.update(id, { status: 'transcribing' });
      const asrFile = preprocess(rec.filename);
      const fileUrl = process.env.PUBLIC_BASE_URL
        ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/uploads/${encodeURIComponent(asrFile)}`
        : null;
      const provider = asr.resolve(rec.asrProvider); // 支持按录音指定引擎
      transcript = await provider.transcribe({ fileUrl, filename: asrFile });
      store.update(id, { transcript, status: 'summarizing', providers: { ...(rec.providers || {}), asr: provider.name } });
    } else {
      store.update(id, { status: 'summarizing' });
    }

    // 2. 总结 + 思维导图（并行）
    const [summary, mindmap] = await Promise.all([
      llm.summarize(transcript.segments, rec.title),
      llm.mindmap(transcript.segments, rec.title),
    ]);

    const cur = store.get(id) || {};
    store.update(id, {
      summary,
      mindmap,
      title: rec.title || summary.title,
      status: 'done',
      providers: { ...(cur.providers || {}), llm: llm.name },
    });
    console.log(`[pipeline] ${id} 完成 (asr=${(cur.providers || {}).asr || asr.name}, llm=${llm.name})`);
  } catch (err) {
    console.error(`[pipeline] ${id} 失败:`, err.message);
    store.update(id, { status: 'error', error: err.message });
  }
}

module.exports = { process: run };
