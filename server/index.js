require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const store = require('./store');
const pipeline = require('./pipeline');

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
  const rec = store.create({
    id: crypto.randomUUID(),
    title: (req.body.title || '').trim() || null,
    originalName: req.file.originalname,
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

// 重新生成（转写结果保留时只重跑 LLM；无转写则整条重跑）
app.post('/api/recordings/:id/reprocess', (req, res) => {
  const rec = store.get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  store.update(rec.id, { status: 'uploaded', error: null });
  pipeline.process(rec.id);
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`回声笔记 EchoNote 已启动: http://localhost:${PORT}`);
  console.log(`ASR provider: ${require('./asr').name} | LLM provider: ${require('./llm').name}`);
});
