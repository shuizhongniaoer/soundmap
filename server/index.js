require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const store = require('./store');
const queue = require('./queue');
const blobs = require('./blobs');
const uploads = require('./uploads');
const { buildDocx, buildTxt, buildSrt, buildSproutsMarkdown, buildMindmapMarkdown } = require('./export');
const { searchRecordings } = require('./search');
const auth = require('./auth');
const { createRawToken, hashToken } = require('./auth/token');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// 将逗号或换行分隔的标签字符串解析为数组
function parseTags(input) {
  if (Array.isArray(input)) return [...new Set(input.map(t => String(t).trim()).filter(Boolean))];
  if (typeof input !== 'string') return [];
  return [...new Set(input.split(/[,\n]/).map(t => t.trim()).filter(Boolean))];
}

// 上传临时目录（S3 模式上传后删除本地文件）
const TMP_UPLOAD_DIR = blobs.isLocal
  ? (blobs.uploadDir || path.join(__dirname, '..', 'uploads'))
  : path.join(require('os').tmpdir(), 'soundmap-uploads');
fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_UPLOAD_DIR,
    filename: (req, file, cb) => {
      const id = crypto.randomBytes(6).toString('hex');
      const ext = path.extname(file.originalname) || '.m4a';
      cb(null, `${Date.now()}-${id}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(mp3|m4a|wav|aac|ogg|opus|flac|mp4|webm|amr|3gp)$/i.test(file.originalname);
    cb(ok ? null : new Error('不支持的文件类型'), ok);
  },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'web'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  },
}));
app.use('/api/auth', auth.router);

// ASR 供应商临时拉取音频：短期 HMAC 签名（仅本地存储模式需要；S3 模式直接用预签名 URL）
app.get('/asr-media/:filename', (req, res) => {
  const filename = req.params.filename;
  if (path.basename(filename) !== filename || !blobs.verify(filename, req.query.expires, req.query.signature)) {
    return res.status(403).json({ error: 'invalid or expired media signature' });
  }
  const stream = blobs.getStream(filename);
  if (!stream) return res.status(404).json({ error: 'not found' });
  res.setHeader('Cache-Control', 'private, no-store');
  stream.pipe(res);
});

// 一次性下载凭证（Word/TXT/SRT/发芽报告/查看详情）
app.get('/download/:token', async (req, res) => {
  const grant = await store.consumeDownloadToken(hashToken(req.params.token));
  if (!grant) return res.status(403).json({ error: '下载地址无效或已过期' });
  const rec = await store.get(grant.recordingId);
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
    if (grant.format === 'mindmap') {
      if (!rec.mindmap) return res.status(400).json({ error: '思维导图尚未生成' });
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="mindmap.md"; filename*=UTF-8''${encodeURIComponent(name + '-思维导图.md')}`);
      return res.send('\uFEFF' + buildMindmapMarkdown(rec));
    }
    res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="transcript.srt"; filename*=UTF-8''${encodeURIComponent(name + '.srt')}`);
    return res.send('\uFEFF' + buildSrt(rec));
  } catch (error) {
    return res.status(500).json({ error: `导出失败: ${error.message}` });
  }
});

// App -> 系统浏览器的一次性登录交接
app.get('/open/:token', async (req, res) => {
  const grant = await store.consumeDownloadToken(hashToken(req.params.token));
  if (!grant || grant.format !== 'view') return res.status(403).json({ error: '打开地址无效或已过期' });
  const rec = await store.get(grant.recordingId);
  const user = await store.getUser(grant.userId);
  const owned = rec && (rec.userId === grant.userId || (!rec.userId && grant.userId === 'local'));
  if (!owned || !user) return res.status(404).json({ error: 'not found' });
  auth.issueSession(req, res, user);
  res.redirect(`/detail.html?id=${encodeURIComponent(rec.id)}`);
});

// ---- 公开分享（无需登录，必须注册在 authenticate 之前）----
const share = require('./share');

// 分享数据：密码通过 X-Share-Password 头或 ?password= 传递
app.get('/api/share/:token', async (req, res) => {
  const { share: s, error } = await share.resolve(
    req.params.token, req.get('x-share-password') || req.query.password);
  if (error) {
    const msg = { 401: '需要密码', 403: '密码错误', 410: '分享已过期', 404: '分享不存在或已撤销' };
    return res.status(error).json({ error: msg[error], code: error });
  }
  const rec = await store.get(s.recordingId);
  if (!rec) return res.status(404).json({ error: '分享不存在或已撤销', code: 404 });
  res.json({
    title: rec.title || rec.originalName || '录音',
    createdAt: rec.createdAt,
    transcript: rec.transcript
      ? { segments: (rec.transcript.segments || []).map(({ speaker, text, start, end }) => ({ speaker, text, start, end })) }
      : null,
    summary: rec.summary || null,
    mindmap: rec.mindmap || null,
    sprouts: rec.sprouts || null,
    audioUrl: rec.filename ? await blobs.getUrl(rec.filename, 3600) : null,
  });
});

// 分享落地页
app.get('/share/:token', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', 'web', 'share.html'));
});

app.use('/api', auth.authenticate);

// ---- 分享管理（录音所有者）----
app.get('/api/recordings/:id/share', async (req, res) => {
  const rec = await store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  res.json({ share: await share.statusFor(rec.id) });
});

app.post('/api/recordings/:id/share', async (req, res) => {
  const rec = await store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  const { password, expiresDays } = req.body || {};
  const created = await share.create(rec.id, req.user.id, { password, expiresDays });
  res.json({ ...created, url: `/share/${created.token}` });
});

app.delete('/api/recordings/:id/share', async (req, res) => {
  const rec = await store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  await share.revoke(rec.id);
  res.json({ ok: true });
});

// 上传录音 -> 创建记录并入队处理
app.post('/api/recordings', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '缺少音频文件（字段名 audio）' });
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const asrProvider = ['dashscope', 'xfyun', 'volcengine', 'local', 'mock'].includes(req.body.asrProvider)
    ? req.body.asrProvider : null;
  // multer 生成的 filename 同时作为 blob key
  const blobKey = req.file.filename;
  // S3 模式：上传到对象存储后删除本地临时文件
  if (!blobs.isLocal) {
    try {
      await blobs.save(req.file.path, blobKey);
      fs.unlink(req.file.path, () => {});
    } catch (e) {
      return res.status(500).json({ error: `文件上传到对象存储失败: ${e.message}` });
    }
  }
  const rec = await store.create({
    id: crypto.randomUUID(),
    title: (req.body.title || '').trim() || null,
    asrProvider,
    originalName,
    filename: blobKey,
    size: req.file.size,
    status: 'uploaded',
    userId: req.user.id,
    folder: (req.body.folder || '').trim() || null,
    tags: parseTags(req.body.tags),
    createdAt: new Date().toISOString(),
  });
  await queue.enqueue(rec.id); // 入队（内存模式直接异步执行，Redis 模式入 BullMQ 队列）
  res.status(201).json(rec);
});

// ===== 分片上传（大文件 + 断点续传）=====

// 分片 body 解析器：raw binary，上限 16MB（单分片最大）
const chunkBodyParser = express.raw({
  type: 'application/octet-stream',
  limit: '16mb',
});

// 初始化上传会话
app.post('/api/uploads', async (req, res) => {
  const { filename, size, mimeType, chunkSize } = req.body || {};
  if (!filename || size === undefined || size === null) {
    return res.status(400).json({ error: 'filename 和 size 必填' });
  }
  try {
    const session = uploads.init({
      filename,
      size: Number(size),
      mimeType,
      chunkSize: chunkSize ? Number(chunkSize) : undefined,
      userId: req.user.id,
    });
    res.status(201).json(session);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 查询上传状态（断点续传用）
app.get('/api/uploads/:uploadId', async (req, res) => {
  const info = uploads.status(req.params.uploadId, req.user.id);
  if (!info) return res.status(404).json({ error: '上传会话不存在或已过期' });
  res.json(info);
});

// 上传单个分片
app.post('/api/uploads/:uploadId/chunks/:index', chunkBodyParser, async (req, res) => {
  const uploadId = req.params.uploadId;
  const index = Number(req.params.index);
  if (!Buffer.isBuffer(req.body)) {
    return res.status(400).json({ error: '分片数据为空或 Content-Type 不是 application/octet-stream' });
  }
  try {
    const result = uploads.saveChunk(uploadId, index, req.body, req.user.id);
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// 完成上传：合并分片 → 保存到对象存储 → 创建录音 → 入队
app.post('/api/uploads/:uploadId/complete', async (req, res) => {
  const uploadId = req.params.uploadId;
  const info = uploads.status(uploadId, req.user.id);
  if (!info) return res.status(404).json({ error: '上传会话不存在或已过期' });

  const asrProvider = ['dashscope', 'xfyun', 'volcengine', 'local', 'mock'].includes(req.body?.asrProvider)
    ? req.body.asrProvider : null;

  try {
    const rec = await uploads.complete(uploadId, req.user.id, async (mergedPath, mergedName, meta) => {
      const blobKey = mergedName;
      // S3 模式：上传到对象存储后删除本地合并文件
      if (!blobs.isLocal) {
        try {
          await blobs.save(mergedPath, blobKey);
          fs.unlink(mergedPath, () => {});
        } catch (e) {
          throw new Error(`文件上传到对象存储失败: ${e.message}`);
        }
      } else {
        // 本地模式：移动到 uploads 目录
        const target = path.join(blobs.uploadDir, blobKey);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        await fs.promises.rename(mergedPath, target);
      }
      const originalName = meta.filename;
      const recording = await store.create({
        id: crypto.randomUUID(),
        title: (req.body?.title || '').trim() || null,
        asrProvider,
        originalName,
        filename: blobKey,
        size: meta.size,
        status: 'uploaded',
        userId: req.user.id,
        folder: (req.body?.folder || '').trim() || null,
        tags: parseTags(req.body?.tags),
        createdAt: new Date().toISOString(),
      });
      await queue.enqueue(recording.id);
      return recording;
    });
    const result = rec?.alreadyCompleted
      ? await store.getForUser(rec.recordingId, req.user.id)
      : rec;
    if (!result) return res.status(404).json({ error: '录音不存在' });
    res.status(rec?.alreadyCompleted ? 200 : 201).json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// 中止/删除上传会话
app.delete('/api/uploads/:uploadId', async (req, res) => {
  try {
    uploads.deleteSession(req.params.uploadId, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 404).json({ error: e.message });
  }
});

// 同步状态：汇总录音各状态数量、存储用量、最近活动
app.get('/api/sync/status', async (req, res) => {
  const all = await store.listForUser(req.user.id);
  const stats = {
    total: all.length,
    uploaded: 0,
    transcribing: 0,
    summarizing: 0,
    done: 0,
    error: 0,
    totalSize: 0,
    totalDuration: 0,
    lastSyncAt: null,
  };
  let latestTime = 0;
  for (const r of all) {
    const status = r.status || 'unknown';
    if (stats[status] !== undefined) stats[status]++;
    const size = Number(r.size) || 0;
    stats.totalSize += size;
    const dur = Number(r.duration) || 0;
    stats.totalDuration += dur;
    const updated = r.updatedAt || r.createdAt || '';
    const t = new Date(updated).getTime();
    if (Number.isFinite(t) && t > latestTime) {
      latestTime = t;
      stats.lastSyncAt = updated;
    }
  }
  res.json(stats);
});

app.get('/api/recordings', async (req, res) => {
  const all = await store.listForUser(req.user.id);
  // 文件夹/标签过滤
  const folderFilter = req.query.folder;
  const tagFilter = req.query.tag;
  let filtered = all;
  if (folderFilter !== undefined) {
    // folder= 表示"未分类"，其他值精确匹配
    filtered = filtered.filter(r =>
      folderFilter === '' ? !r.folder : r.folder === folderFilter
    );
  }
  if (tagFilter !== undefined && tagFilter !== '') {
    filtered = filtered.filter(r => (r.tags || []).includes(tagFilter));
  }
  const results = searchRecordings(filtered, req.query.q);
  res.json(results.map(({ rec, match }) => {
    const { transcript, summary, mindmap, sprouts, ...meta } = rec;
    return { ...meta, ...(match ? { match } : {}) };
  }));
});

// 列出当前用户所有文件夹及录音数量
app.get('/api/folders', async (req, res) => {
  const all = await store.listForUser(req.user.id);
  const counts = {};
  let unclassified = 0;
  for (const r of all) {
    if (r.folder) {
      counts[r.folder] = (counts[r.folder] || 0) + 1;
    } else {
      unclassified++;
    }
  }
  const folders = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  res.json({ folders, unclassified });
});

// 列出当前用户所有标签及录音数量
app.get('/api/tags', async (req, res) => {
  const all = await store.listForUser(req.user.id);
  const counts = {};
  for (const r of all) {
    for (const tag of (r.tags || [])) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  const tags = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  res.json({ tags });
});

app.get('/api/recordings/:id', async (req, res) => {
  const rec = await store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  res.json(rec);
});

// 音频播放：本地模式从磁盘流式返回，S3 模式代理流
app.get('/api/recordings/:id/audio', async (req, res) => {
  const rec = await store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  res.setHeader('Cache-Control', 'private, no-store');
  const stream = await blobs.getStream(rec.filename);
  if (!stream) return res.status(404).json({ error: 'audio not found' });
  stream.pipe(res);
});

app.post('/api/recordings/:id/export-link', async (req, res) => {
  const rec = await store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  const format = ['docx', 'txt', 'srt', 'sprouts', 'mindmap', 'view'].includes(req.body?.format) ? req.body.format : null;
  if (!format) return res.status(400).json({ error: 'format must be docx, txt, srt, sprouts, mindmap or view' });
  const token = createRawToken();
  await store.createDownloadToken({
    tokenHash: hashToken(token), recordingId: rec.id, userId: req.user.id, format,
    expiresAt: new Date(Date.now() + (format === 'view' ? 30 : 120) * 1000).toISOString(),
  });
  res.json({
    path: `/${format === 'view' ? 'open' : 'download'}/${encodeURIComponent(token)}`,
    expiresIn: format === 'view' ? 30 : 120,
  });
});

// 按需重新生成
app.post('/api/recordings/:id/reprocess', async (req, res) => {
  const rec = await store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  if (!['done', 'error'].includes(rec.status)) return res.status(409).json({ error: '录音正在处理中，请完成后再重新生成' });
  const part = String(req.query.part || 'ai');
  const choices = {
    summary: ['summary'], sprouts: ['sprouts'], mindmap: ['mindmap'],
    proofread: ['proofread'], ai: ['summary', 'sprouts', 'mindmap'],
    all: ['proofread', 'summary', 'sprouts', 'mindmap'],
  };
  if (!choices[part]) return res.status(400).json({ error: 'part must be summary, sprouts, mindmap, proofread, ai or all' });
  const provider = ['dashscope', 'xfyun', 'volcengine', 'local', 'mock'].includes(req.query.provider)
    ? req.query.provider : null;
  const full = req.query.full === '1' || !!provider;
  const parts = full ? choices.all : choices[part];
  // 场景模板：验证并持久化到 recording，pipeline 生成总结时读取
  const { isValid: isValidTemplate } = require('./llm/templates');
  const templateParam = String(req.query.template || '').trim();
  if (templateParam && !isValidTemplate(templateParam)) {
    return res.status(400).json({ error: `无效的模板: ${templateParam}` });
  }
  const summaryTemplate = templateParam || null;
  const patch = { status: full ? 'uploaded' : 'summarizing', error: null };
  if (summaryTemplate) patch.summaryTemplate = summaryTemplate;
  if (parts.includes('summary')) patch.summary = null;
  if (parts.includes('sprouts')) patch.sprouts = null;
  if (parts.includes('mindmap')) patch.mindmap = null;
  if (full) patch.transcript = null;
  if (provider) { patch.asrProvider = provider; patch.transcript = null; }
  await store.update(rec.id, patch);
  await queue.enqueue(rec.id, { parts, summaryTemplate });
  res.json({ ok: true, part: full ? 'full' : part, parts, summaryTemplate: summaryTemplate || rec.summaryTemplate || 'auto' });
});

// 批量重命名说话人
app.patch('/api/recordings/:id/speakers', async (req, res) => {
  const { from, to } = req.body || {};
  const rec = await store.getForUser(req.params.id, req.user.id);
  if (!rec || !rec.transcript) return res.status(404).json({ error: 'not found' });
  if (!from || !to || !String(to).trim()) return res.status(400).json({ error: '缺少 from/to' });
  let count = 0;
  rec.transcript.segments.forEach(s => { if (s.speaker === from) { s.speaker = String(to).trim(); count++; } });
  await store.update(rec.id, { transcript: rec.transcript });
  res.json({ ok: true, count });
});

// 修改单句
app.patch('/api/recordings/:id/segments/:idx', async (req, res) => {
  const rec = await store.getForUser(req.params.id, req.user.id);
  if (!rec || !rec.transcript) return res.status(404).json({ error: 'not found' });
  const seg = rec.transcript.segments[Number(req.params.idx)];
  if (!seg) return res.status(404).json({ error: 'segment not found' });
  const { speaker, text } = req.body || {};
  if (speaker != null && String(speaker).trim()) seg.speaker = String(speaker).trim();
  if (text != null && String(text).trim()) {
    seg.text = String(text).trim();
    if (seg.orig && seg.text === seg.orig) delete seg.orig;
  }
  await store.update(rec.id, { transcript: rec.transcript });
  res.json({ ok: true, segment: seg });
});

// 更新录音元信息（文件夹、标签）
app.patch('/api/recordings/:id', async (req, res) => {
  const rec = await store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'folder')) {
    const folder = String(req.body.folder || '').trim();
    patch.folder = folder || null;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'tags')) {
    patch.tags = parseTags(req.body.tags);
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: '缺少 folder 或 tags 字段' });
  }
  const updated = await store.update(rec.id, patch);
  const { transcript, summary, mindmap, sprouts, ...meta } = updated;
  res.json(meta);
});

// ---- 场景模板 ----
app.get('/api/templates', (req, res) => {
  res.json(require('./llm/templates').TEMPLATES);
});

// ---- 热词表管理 ----
const vocabulary = require('./asr/vocabulary');

app.get('/api/hotwords', async (req, res) => {
  const suffix = req.user.id === 'local' ? '' : `:${req.user.id}`;
  res.json({
    words: await store.getMeta(`hotwords${suffix}`) || [],
    vocabularyId: await store.getMeta(`vocabularyId${suffix}`) || null,
  });
});

app.put('/api/hotwords', async (req, res) => {
  const words = [...new Set(((req.body || {}).words || []).map(w => String(w).trim()).filter(Boolean))];
  if (words.length > 500) return res.status(400).json({ error: '热词表最多 500 个，请精简' });
  const suffix = req.user.id === 'local' ? '' : `:${req.user.id}`;
  await store.setMeta(`hotwords${suffix}`, words);
  if ((process.env.ASR_PROVIDER || '').toLowerCase() !== 'dashscope' || !process.env.DASHSCOPE_API_KEY) {
    return res.json({ ok: true, words, vocabularyId: null, note: '当前非百炼模式，仅保存未同步' });
  }
  try {
    const id = await vocabulary.sync(words, req.user.id);
    await store.setMeta(`vocabularyId${suffix}`, id);
    res.json({ ok: true, words, vocabularyId: id });
  } catch (e) {
    res.status(500).json({ error: '热词已保存，但同步百炼失败: ' + e.message });
  }
});

// 导出
app.get('/api/recordings/:id/export/docx', async (req, res) => {
  const rec = await store.getForUser(req.params.id, req.user.id);
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

app.get('/api/recordings/:id/export/txt', async (req, res) => {
  const rec = await store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  const name = `${safeExportName(rec)}.txt`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="transcript.txt"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send('\uFEFF' + buildTxt(rec));
});

app.get('/api/recordings/:id/export/srt', async (req, res) => {
  const rec = await store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  const name = `${safeExportName(rec)}.srt`;
  res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="transcript.srt"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send('\uFEFF' + buildSrt(rec));
});

app.get('/api/recordings/:id/export/sprouts.md', async (req, res) => {
  const rec = await store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  const name = `${safeExportName(rec)}-发芽报告.md`;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sprouts.md"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send('\uFEFF' + buildSproutsMarkdown(rec));
});

app.get('/api/recordings/:id/export/mindmap.md', async (req, res) => {
  const rec = await store.getForUser(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  if (!rec.mindmap) return res.status(400).json({ error: '思维导图尚未生成' });
  const name = `${safeExportName(rec)}-思维导图.md`;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="mindmap.md"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send('\uFEFF' + buildMindmapMarkdown(rec));
});

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`声图 SoundMap 已启动: http://localhost:${PORT}`);
  console.log(`ASR provider: ${require('./asr').name} | LLM provider: ${require('./llm').name}`);
  console.log(`存储: ${store.name} | 队列: ${queue.name} | 对象存储: ${blobs.name}`);
  if (blobs.isLocal && !blobs.hasPersistentSecret) {
    console.warn('[security] 未设置 MEDIA_SIGNING_SECRET，当前使用进程级临时密钥；多实例/正式环境必须配置。');
  }
});
