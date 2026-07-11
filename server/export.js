// 导出 Word：总结 + 转写稿
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat,
} = require('docx');

const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei' };
const ACCENT = '2E5A88';

const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const p = (text, opts = {}) => new Paragraph({
  spacing: { after: 120, line: 300 },
  children: [new TextRun({ text, font: FONT, size: 21, ...opts })],
});
const h = (text, level) => new Paragraph({
  heading: level, spacing: { before: 280, after: 140 },
  children: [new TextRun({ text, font: FONT })],
});
const bullet = text => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  spacing: { after: 80, line: 300 },
  children: [new TextRun({ text, font: FONT, size: 21 })],
});

async function buildDocx(rec) {
  const children = [];
  const title = rec.title || rec.originalName || '录音记录';

  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: title, font: FONT, size: 40, bold: true, color: ACCENT })],
  }));
  children.push(p(`${new Date(rec.createdAt).toLocaleString('zh-CN')} · 由声图 SoundMap 生成`, { size: 18, color: '888888' }));

  const s = rec.summary;
  if (s) {
    children.push(h('摘要', HeadingLevel.HEADING_1));
    children.push(p(s.abstract || ''));
    if ((s.key_points || []).length) {
      children.push(h('关键要点', HeadingLevel.HEADING_1));
      s.key_points.forEach(k => children.push(bullet(k)));
    }
    if ((s.todos || []).length) {
      children.push(h('待办事项', HeadingLevel.HEADING_1));
      s.todos.forEach(t => children.push(bullet(t.owner ? `${t.task}（${t.owner}）` : t.task)));
    }
    if ((s.quotes || []).length) {
      children.push(h('原话摘录', HeadingLevel.HEADING_1));
      s.quotes.forEach(q => children.push(bullet(`"${q}"`)));
    }
  }

  if (rec.mindmap) {
    children.push(h('思维导图大纲', HeadingLevel.HEADING_1));
    rec.mindmap.split('\n').forEach(line => {
      const t = line.trim();
      if (t) children.push(p(t, { size: 20 }));
    });
  }

  if (rec.transcript && rec.transcript.segments) {
    children.push(h('转写稿全文', HeadingLevel.HEADING_1));
    rec.transcript.segments.forEach(seg => {
      children.push(new Paragraph({
        spacing: { after: 100, line: 300 },
        children: [
          new TextRun({ text: `[${fmt(seg.start)}] `, font: FONT, size: 18, color: '999999' }),
          new TextRun({ text: `${seg.speaker}：`, font: FONT, size: 21, bold: true, color: ACCENT }),
          new TextRun({ text: seg.text, font: FONT, size: 21 }),
        ],
      }));
    });
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 21 } },
        heading1: { run: { font: FONT, size: 28, bold: true, color: ACCENT } },
      },
    },
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 620, hanging: 300 } } } }],
      }],
    },
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildDocx };
