// 异步处理管线: uploaded -> transcribing -> summarizing -> done | error
// 支持 Redis 队列 + 独立 Worker（生产）或进程内异步执行（开发）
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const store = require('./store');
const blobs = require('./blobs');
const asr = require('./asr');
const llm = require('./llm');
const { applyCorrections } = require('./llm/proofread');

let ffmpegOk = null;
function hasFfmpeg() {
  if (ffmpegOk === null) {
    try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); ffmpegOk = true; }
    catch { ffmpegOk = false; console.warn('[pipeline] 未检测到 ffmpeg，跳过单声道预处理（brew install ffmpeg 可提升识别与说话人分离质量）'); }
  }
  return ffmpegOk;
}

// 说话人分离仅支持单声道；转写前统一转 16kHz 单声道 mp3。
// 使用 blob 存储抽象层获取本地文件路径（S3 模式会下载到临时目录）。
async function preprocess(filename) {
  if (!hasFfmpeg()) return { key: filename, cleanup: () => {} };
  const local = await blobs.getAsLocalPath(filename);
  if (!local) return { key: filename, cleanup: () => {} };
  const outName = filename.replace(/\.[^.]+$/, '') + '.asr.mp3';
  const outPath = blobs.isLocal
    ? path.join(blobs.uploadDir, outName)  // 本地模式直接写到 UPLOAD_DIR
    : path.join(path.dirname(local.path), outName); // S3 模式写临时目录
  try {
    if (!fs.existsSync(outPath)) {
      execFileSync('ffmpeg', ['-y', '-i', local.path, '-ac', '1', '-ar', '16000', '-b:a', '64k', outPath], { stdio: 'ignore' });
    }
    // S3 模式：上传预处理后的文件到对象存储
    if (!blobs.isLocal) {
      await blobs.save(outPath, outName, 'audio/mpeg');
    }
    return { key: outName, cleanup: local.cleanup };
  } catch (e) {
    console.warn('[pipeline] 音频预处理失败，使用原始文件:', e.message);
    local.cleanup();
    return { key: filename, cleanup: () => {} };
  }
}

// 公网地址实时探测：优先问本机 cpolar/ngrok 客户端接口（地址重启会变），失败才用 .env 固定值
// 仅本地存储模式需要（S3 模式直接返回预签名 URL，不需要公网地址）
async function publicBase() {
  if (!blobs.isLocal) return null;
  try {
    const res = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      const port = String(process.env.PORT || 3000);
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

// 为 ASR 供应商生成可访问的音频 URL
async function asrFileUrl(key) {
  const url = await blobs.getUrl(key, 15 * 60); // 15 分钟有效
  if (blobs.isLocal) {
    // 本地模式返回相对路径，需要拼接公网地址
    const base = await publicBase();
    return base ? `${base}${url}` : null;
  }
  // S3 模式返回完整的预签名 URL
  return url;
}

async function optimizeTranscript(rec, transcript) {
  try {
    const suffix = rec.userId && rec.userId !== 'local' ? `:${rec.userId}` : '';
    const hotwords = await store.getMeta(`hotwords${suffix}`) || [];
    const corrections = await llm.proofread(transcript.segments, hotwords);
    const { fixed, rejected } = applyCorrections(transcript.segments, corrections);
    if (fixed) console.log(`[pipeline] ${rec.id} LLM 校对修正 ${fixed} 处`);
    if (rejected) console.warn(`[pipeline] ${rec.id} 拒绝 ${rejected} 处过度校对`);
    return { fixed, rejected, generatedAt: new Date().toISOString() };
  } catch (error) {
    console.warn(`[pipeline] ${rec.id} 校对跳过:`, error.message);
    return { fixed: 0, rejected: 0, error: error.message, generatedAt: new Date().toISOString() };
  }
}

async function run(id, options = {}) {
  const rec = await store.get(id);
  if (!rec) return;
  const requested = new Set(Array.isArray(options.parts)
    ? options.parts
    : ['proofread', 'summary', 'mindmap', 'sprouts']);
  let preprocessCleanup = () => {};
  try {
    // 1. 转写（已有转写稿则跳过）
    let transcript = rec.transcript;
    if (!transcript || !transcript.segments || !transcript.segments.length) {
      await store.update(id, { status: 'transcribing' });
      const { key: asrKey, cleanup } = await preprocess(rec.filename);
      preprocessCleanup = cleanup;
      const fileUrl = await asrFileUrl(asrKey);
      const provider = asr.resolve(rec.asrProvider);
      transcript = await provider.transcribe({ fileUrl, filename: asrKey, userId: rec.userId || 'local' });

      const segs = transcript.segments || [];
      const duration = segs.length ? Math.ceil(segs[segs.length - 1].end || 0) : null;
      await store.update(id, { transcript, duration, status: 'summarizing', providers: { ...(rec.providers || {}), asr: provider.name } });
    } else {
      await store.update(id, { status: 'summarizing' });
    }

    // 2. 转写稿优化先完成，其余并行生成
    let proofreadResult;
    if (requested.has('proofread')) {
      proofreadResult = await optimizeTranscript(rec, transcript);
      await store.update(id, { transcript, lastProofread: proofreadResult });
    }
    const summaryPromise = requested.has('summary')
      ? llm.summarize(transcript.segments, rec.title, rec.summaryTemplate || options.summaryTemplate) : Promise.resolve(undefined);
    const mindmapPromise = requested.has('mindmap')
      ? llm.mindmap(transcript.segments, rec.title) : Promise.resolve(undefined);
    const sproutsPromise = requested.has('sprouts')
      ? llm.sprouts(transcript.segments, rec.title).catch(error => {
        console.warn(`[pipeline] ${id} 灵感发芽跳过:`, error.message);
        return { items: [], error: error.message };
      }) : Promise.resolve(undefined);
    const [summary, mindmap, sprouts] = await Promise.all([
      summaryPromise, mindmapPromise, sproutsPromise,
    ]);

    const cur = await store.get(id) || {};
    const patch = {
      status: 'done',
      providers: { ...(cur.providers || {}), llm: llm.name },
    };
    if (summary !== undefined) {
      patch.summary = summary;
      patch.title = rec.title || summary.title;
    }
    if (mindmap !== undefined) patch.mindmap = mindmap;
    if (sprouts !== undefined) patch.sprouts = { ...sprouts, generatedAt: new Date().toISOString() };
    await store.update(id, patch);
    console.log(`[pipeline] ${id} 完成 parts=${[...requested].join(',')} (asr=${(cur.providers || {}).asr || asr.name}, llm=${llm.name})`);
  } catch (err) {
    console.error(`[pipeline] ${id} 失败:`, err.message);
    await store.update(id, { status: 'error', error: err.message });
    throw err;
  } finally {
    preprocessCleanup();
  }
}

module.exports = { process: run };
