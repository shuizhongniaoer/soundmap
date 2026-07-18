// 异步处理管线: uploaded -> transcribing -> summarizing -> done | error
// Phase 0 用进程内异步执行；Phase 1 换 Redis 队列 + 独立 Worker
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const store = require('./store');
const asr = require('./asr');
const llm = require('./llm');
const { applyCorrections } = require('./llm/proofread');
const { signedPath } = require('./media');

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

// 公网地址实时探测：优先问本机 cpolar/ngrok 客户端接口（地址重启会变），失败才用 .env 固定值
async function publicBase() {
  try {
    const res = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      const port = String(process.env.PORT || 3000);
      // 只认指向本服务端口的隧道（cpolar 默认配置可能带 8080 等无关隧道）
      const list = (data.tunnels || []).filter(t =>
        /^https?:/.test(t.public_url || '') &&
        String((t.config && t.config.addr) || t.local_addr || '').includes(':' + port));
      const t = list.find(x => x.public_url.startsWith('https')) || list[0];
      if (t) {
        console.log('[pipeline] 探测到隧道公网地址:', t.public_url, '->', (t.config && t.config.addr) || '');
        return t.public_url.replace(/\/$/, '');
      }
    }
  } catch { /* 探测失败走 .env */ }
  return (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') || null;
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
      const base = await publicBase();
      const fileUrl = base ? `${base}${signedPath(asrFile)}` : null;
      const provider = asr.resolve(rec.asrProvider); // 支持按录音指定引擎
      transcript = await provider.transcribe({ fileUrl, filename: asrFile, userId: rec.userId || 'local' });

      // LLM 自动校对：修正上下文明显矛盾的误识别词（原文保留在 seg.orig，前端可查看）
      try {
        const suffix = rec.userId && rec.userId !== 'local' ? `:${rec.userId}` : '';
        const hotwords = store.getMeta(`hotwords${suffix}`) || [];
        const corrections = await llm.proofread(transcript.segments, hotwords);
        const { fixed, rejected } = applyCorrections(transcript.segments, corrections);
        if (fixed) console.log(`[pipeline] ${id} LLM 校对修正 ${fixed} 处`);
        if (rejected) console.warn(`[pipeline] ${id} 拒绝 ${rejected} 处过度校对`);
      } catch (e) {
        console.warn(`[pipeline] ${id} 校对跳过:`, e.message);
      }

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
