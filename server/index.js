require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const store = require('./store');
const pipeline = require('./pipeline');
const { buildDocx } = require('./export');

const app = express();
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
    const ok = /\.(mp3|m4a|wav|aac|ogg|opus|flac|mp4|webm|amr)$/i.test(file.originalname);
    cb(ok ? null : new Error('不支持的文件类型'), ok);
  },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'web')));
app.use('/uploads', express.static(UPLOAD_DIR));

// 上传录音 -> 创建记录并触发处理管线
app.post('/api/recordings', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '缺少音频文件（字段名 audio）' });
  // multer 按 latin1 解码 originalname，中文文件名需转回 utf8
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const asrProvider = ['dashscope', 'xfyun', 'local', 'mock'].includes(req.body.asrProvider)
    ? req.body.asrProvider : null;
  const rec = store.create({
    id: crypto.randomUUID(),
    title: (req.body.title || '').trim() || null,
    asrProvider, // null = 用 .env 默认引擎
    originalName,
    filename: req.file.filename,
    size: req.file.size,
    status: 'uploaded',
    createdAt: new Date().toISOString(),
  });
  pipeline.process(rec.id); // 异步执行，不阻塞响应
  res.status(201).json(rec);
});

app.get('/api/recordings', (req, res) => {
  res.json(store.list().map(({ transcript, summary, mindmap, ...meta }) => meta));
});

app.get('/api/recordings/:id', (req, res) => {
  const rec = store.get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  res.json(rec);
});

// 重新生成（有转写稿时只重跑 LLM，不重复付费转写；加 ?full=1 强制重新转写）
app.post('/api/recordings/:id/reprocess', (req, res) => {
  const rec = store.get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  const patch = { status: 'uploaded', error: null };
  if (req.query.full === '1') patch.transcript = null;
  store.update(rec.id, patch);
  pipeline.process(rec.id);
  res.json({ ok: true });
});

// 批量重命名说话人（"说话人2" -> "张总"）
app.patch('/api/recordings/:id/speakers', (req, res) => {
  const { from, to } = req.body || {};
  const rec = store.get(req.params.id);
  if (!rec || !rec.transcript) return res.status(404).json({ error: 'not found' });
  if (!from || !to || !String(to).trim()) return res.status(400).json({ error: '缺少 from/to' });
  let count = 0;
  rec.transcript.segments.forEach(s => { if (s.speaker === from) { s.speaker = String(to).trim(); count++; } });
  store.update(rec.id, { transcript: rec.transcript });
  res.json({ ok: true, count });
});

// 修改单句：说话人 和/或 文字内容
app.patch('/api/recordings/:id/segments/:idx', (req, res) => {
  const rec = store.get(req.params.id);
  if (!rec || !rec.transcript) return res.status(404).json({ error: 'not found' });
  const seg = rec.transcript.segments[Number(req.params.idx)];
  if (!seg) return res.status(404).json({ error: 'segment not found' });
  const { speaker, text } = req.body || {};
  if (speaker != null && String(speaker).trim()) seg.speaker = String(speaker).trim();
  if (text != null && String(text).trim()) seg.text = String(text).trim();
  store.update(rec.id, { transcript: rec.transcript });
  res.json({ ok: true, segment: seg });
});

// ---- 热词表管理（存数据库，变更自动同步百炼）----
const vocabulary = require('./asr/vocabulary');

app.get('/api/hotwords', (req, res) => {
  res.json({
    words: store.getMeta('hotwords') || [],
    vocabularyId: store.getMeta('vocabularyId') || null,
  });
});

app.put('/api/hotwords', async (req, res) => {
  const words = [...new Set(((req.body || {}).words || []).map(w => String(w).trim()).filter(Boolean))];
  if (words.length > 500) return res.status(400).json({ error: '热词表最多 500 个（单表容量上限），请精简' });
  store.setMeta('hotwords', words);
  if ((process.env.ASR_PROVIDER || '').toLowerCase() !== 'dashscope' || !process.env.DASHSCOPE_API_KEY) {
    return res.json({ ok: true, words, vocabularyId: null, note: '当前非百炼模式，仅保存未同步' });
  }
  try {
    const id = await vocabulary.sync(words);
    res.json({ ok: true, words, vocabularyId: id });
  } catch (e) {
    res.status(500).json({ error: '热词已保存，但同步百炼失败: ' + e.message });
  }
});

// 导出 Word（总结 + 思维导图大纲 + 转写稿全文）
app.get('/api/recordings/:id/export/docx', async (req, res) => {
  const rec = store.get(req.params.id);
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

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`声图 SoundMap 已启动: http://localhost:${PORT}`);
  console.log(`ASR provider: ${require('./asr').name} | LLM provider: ${require('./llm').name}`);
});
