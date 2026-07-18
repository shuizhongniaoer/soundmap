require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const store = require('./store');
const pipeline = require('./pipeline');
const { buildDocx, buildTxt, buildSrt, buildSproutsMarkdown } = require('./export');
const { searchRecordings } = require('./search');
const auth = require('./auth');
const media = require('./media');
const { createRawToken, hashToken } = require('./auth/token');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const id = crypto.randomBytes(6).toString('hex');
      const ext = path.extname(file.originalname) || '.m4a';
      cb(null, `${Date.now()}-${id}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const ok = /\.(mp3|m4a|wav|aac|ogg|opus|flac|mp4|webm|amr|3gp)$/i.test(file.originalname);
    cb(ok ? null : new Error('不支持的文件类型'), ok);
  },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'web'), {
  setHeaders: (res, filePath) => {
    // HTML 不缓存，避免改版后浏览器用旧页面
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  },
}));
app.use('/api/auth', auth.router);

// ASR 供应商临时拉取音频：短期 HMAC 签名，不暴露永久公共文件地址。
app.get('/asr-media/:filename', (req, res) => {
  const filename = req.params.filename;
  if (path.basename(filename) !== filename || !media.verify(filename, req.query.expires, req.query.signature)) {
    return res.status(403).json({ error: 'invalid or expired media signature' });
  }
  const target = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'not found' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(target);
});

// Flutter 会在系统浏览器里打开导出文件，无法复用 App 的 Bearer Token。
// 因此签发 2 分钟、仅可使用一次的下载凭证，而不是把业务会话放进 URL。
app.get('/download/:token', async (req, res) => {
  const grant = store.consumeDownloadToken(hashToken(req.params.token));
  if (!grant) return res.status(403).json({ error: '下载地址无效或已过期' });
  const rec = store.get(grant.recordingId);
  const owned = rec && (rec.userId === grant.userId || (!rec.userId && grant.userId === 'local'));
  if (!owned) return res.status(404).json({ error: 'not found' });
  try {
    const name = safeExportName(rec);
    if (grant.format === 'docx') {
      const buf = await buildDocx(rec);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="export.docx"; filename*=UTF-8''${encodeURIComponent(name + '.docx')}`);
      return res.send(buf);
    }
    if (grant.format === 'txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="transcript.txt"; filename*=UTF-8''${encodeURIComponent(name + '.txt')}`);
      return res.send('\uFEFF' + buildTxt(rec));
    }
    if (grant.format === 'sprouts') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="sprouts.md"; filename*=UTF-8''${encodeURIComponent(name + '-发芽报告.md')}`);
      return res.send('\uFEFF' + buildSproutsMarkdown(rec));
    }
    res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="transcript.srt"; filename*=UTF-8''${encodeURIComponent(name + '.srt')}`);
    return res.send('\uFEFF' + buildSrt(rec));
  } catch (error) {
    return res.status(500).json({ error: `导出失败: ${error.message}` });
  }
});

// App -> 系统浏览器的一次性登录交接，用于打开完整 Web 详情页。
app.get('/open/:token', (req, res) => {
  const grant = store.consumeDownloadToken(hashToken(req.params.token));
  if (!grant || grant.format !== 'view') return res.status(403).json({ error: '打开地址无效或已过期' });
  const rec = store.get(grant.recordingId);
  const user = store.getUser(grant.userId);
  const owned = rec && (rec.userId === grant.userId || (!rec.userId && grant.userId === 'local'));
  if (!owned || !user) return res.status(404).json({ error: 'not found' });
  auth.issueSession(req, res, user);
  res.redirect(`/detail.html?id=${encodeURIComponent(rec.id)}`);
});

app.use('/api', auth.authenticate);

// 上传录音 -> 创建记录并触发处理管线
app.post('/api/recordings', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '缺少音频文件（字段名 audio）' });
  // multer 按 latin1 解码 originalname，中文文件名需转回 utf8
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const asrProvider = ['dashscope', 'xfyun', 'volcengine', 'local', 'mock'].includes(req.body.asrProvider)
    ? req.body.asrProvider : null;
  const rec = store.create({
    id: crypto.randomUUID(),
    title: (req.body.title || '').trim() || null,
    asrProvider, // null = 用 .env 默认引擎
    originalName,
    filename: req.file.filename,
    size: req.file.size,
    status: 'uploaded',
    userId: req.user.id,
    createdAt: new Date().toISOString(),
  });
  pipeline.process(rec.id); // 异步执行，不阻塞响应
  res.status(201).json(rec);
});

app.get('/api/recordings', (req, res) => {
  const results = searchRecordings(store.listForUser(req.user.id), req.query.q);
  res.json(results.map(({ rec, match }) => {
    const { transcript, summary, mindmap, sprouts, ...meta } = rec;
    return { ...meta, ...(match ? { match } : {}) };
  }));
});

app.get('/api/recordings/:id', (req, res) => {
  const rec = store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  res.json(rec);
});

app.get('/api/recordings/:id/audio', (req, res) => {
  const rec = store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  const target = path.join(UPLOAD_DIR, rec.filename);
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'audio not found' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(target);
});

app.post('/api/recordings/:id/export-link', (req, res) => {
  const rec = store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  const format = ['docx', 'txt', 'srt', 'sprouts', 'view'].includes(req.body?.format) ? req.body.format : null;
  if (!format) return res.status(400).json({ error: 'format must be docx, txt, srt, sprouts or view' });
  const token = createRawToken();
  store.createDownloadToken({
    tokenHash: hashToken(token), recordingId: rec.id, userId: req.user.id, format,
    expiresAt: new Date(Date.now() + (format === 'view' ? 30 : 120) * 1000).toISOString(),
  });
  res.json({
    path: `/${format === 'view' ? 'open' : 'download'}/${encodeURIComponent(token)}`,
    expiresIn: format === 'view' ? 30 : 120,
  });
});

// 按需重新生成：part=summary|sprouts|mindmap|proofread|ai|all；full=1 才重新转写。
app.post('/api/recordings/:id/reprocess', (req, res) => {
  const rec = store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  if (!['done', 'error'].includes(rec.status)) return res.status(409).json({ error: '录音正在处理中，请完成后再重新生成' });
  const part = String(req.query.part || 'ai');
  const choices = {
    summary: ['summary'],
    sprouts: ['sprouts'],
    mindmap: ['mindmap'],
    proofread: ['proofread'],
    ai: ['summary', 'sprouts', 'mindmap'],
    all: ['proofread', 'summary', 'sprouts', 'mindmap'],
  };
  if (!choices[part]) return res.status(400).json({ error: 'part must be summary, sprouts, mindmap, proofread, ai or all' });
  const provider = ['dashscope', 'xfyun', 'volcengine', 'local', 'mock'].includes(req.query.provider)
    ? req.query.provider : null;
  const full = req.query.full === '1' || !!provider;
  const parts = full ? choices.all : choices[part];
  const patch = { status: full ? 'uploaded' : 'summarizing', error: null };
  if (parts.includes('summary')) patch.summary = null;
  if (parts.includes('sprouts')) patch.sprouts = null;
  if (parts.includes('mindmap')) patch.mindmap = null;
  if (full) patch.transcript = null;
  if (provider) {
    patch.asrProvider = provider;
    patch.transcript = null; // 换引擎必然重转
  }
  store.update(rec.id, patch);
  pipeline.process(rec.id, { parts });
  res.json({ ok: true, part: full ? 'full' : part, parts });
});

// 批量重命名说话人（"说话人2" -> "张总"）
app.patch('/api/recordings/:id/speakers', (req, res) => {
  const { from, to } = req.body || {};
  const rec = store.getForUser(req.params.id, req.user.id);
  if (!rec || !rec.transcript) return res.status(404).json({ error: 'not found' });
  if (!from || !to || !String(to).trim()) return res.status(400).json({ error: '缺少 from/to' });
  let count = 0;
  rec.transcript.segments.forEach(s => { if (s.speaker === from) { s.speaker = String(to).trim(); count++; } });
  store.update(rec.id, { transcript: rec.transcript });
  res.json({ ok: true, count });
});

// 修改单句：说话人 和/或 文字内容
app.patch('/api/recordings/:id/segments/:idx', (req, res) => {
  const rec = store.getForUser(req.params.id, req.user.id);
  if (!rec || !rec.transcript) return res.status(404).json({ error: 'not found' });
  const seg = rec.transcript.segments[Number(req.params.idx)];
  if (!seg) return res.status(404).json({ error: 'segment not found' });
  const { speaker, text } = req.body || {};
  if (speaker != null && String(speaker).trim()) seg.speaker = String(speaker).trim();
  if (text != null && String(text).trim()) {
    seg.text = String(text).trim();
    // Reverting to the saved ASR text also clears the AI-correction marker.
    if (seg.orig && seg.text === seg.orig) delete seg.orig;
  }
  store.update(rec.id, { transcript: rec.transcript });
  res.json({ ok: true, segment: seg });
});

// ---- 热词表管理（存数据库，变更自动同步百炼）----
const vocabulary = require('./asr/vocabulary');

app.get('/api/hotwords', (req, res) => {
  const suffix = req.user.id === 'local' ? '' : `:${req.user.id}`;
  res.json({
    words: store.getMeta(`hotwords${suffix}`) || [],
    vocabularyId: store.getMeta(`vocabularyId${suffix}`) || null,
  });
});

app.put('/api/hotwords', async (req, res) => {
  const words = [...new Set(((req.body || {}).words || []).map(w => String(w).trim()).filter(Boolean))];
  if (words.length > 500) return res.status(400).json({ error: '热词表最多 500 个（单表容量上限），请精简' });
  const suffix = req.user.id === 'local' ? '' : `:${req.user.id}`;
  store.setMeta(`hotwords${suffix}`, words);
  if ((process.env.ASR_PROVIDER || '').toLowerCase() !== 'dashscope' || !process.env.DASHSCOPE_API_KEY) {
    return res.json({ ok: true, words, vocabularyId: null, note: '当前非百炼模式，仅保存未同步' });
  }
  try {
    const id = await vocabulary.sync(words, req.user.id);
    store.setMeta(`vocabularyId${suffix}`, id);
    res.json({ ok: true, words, vocabularyId: id });
  } catch (e) {
    res.status(500).json({ error: '热词已保存，但同步百炼失败: ' + e.message });
  }
});

// 导出 Word（总结 + 思维导图大纲 + 转写稿全文）
app.get('/api/recordings/:id/export/docx', async (req, res) => {
  const rec = store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  try {
    const buf = await buildDocx(rec);
    const name = `${(rec.title || rec.originalName || '录音记录').replace(/[/\\:*?"<>|]/g, '_')}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="export.docx"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: '导出失败: ' + e.message });
  }
});

function safeExportName(rec) {
  return (rec.title || rec.originalName || '录音记录').replace(/[/\\:*?"<>|]/g, '_');
}

app.get('/api/recordings/:id/export/txt', (req, res) => {
  const rec = store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  const name = `${safeExportName(rec)}.txt`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="transcript.txt"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send('\uFEFF' + buildTxt(rec));
});

app.get('/api/recordings/:id/export/srt', (req, res) => {
  const rec = store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  const name = `${safeExportName(rec)}.srt`;
  res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="transcript.srt"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send('\uFEFF' + buildSrt(rec));
});

app.get('/api/recordings/:id/export/sprouts.md', (req, res) => {
  const rec = store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  const name = `${safeExportName(rec)}-发芽报告.md`;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sprouts.md"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send('\uFEFF' + buildSproutsMarkdown(rec));
});

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`声图 SoundMap 已启动: http://localhost:${PORT}`);
  console.log(`ASR provider: ${require('./asr').name} | LLM provider: ${require('./llm').name}`);
  if (!media.hasPersistentSecret) {
    console.warn('[security] 未设置 MEDIA_SIGNING_SECRET，当前使用进程级临时密钥；多实例/正式环境必须配置。');
  }
});
