// 导出 Word：总结 + 转写稿
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat,
} = require('docx');

const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei' };
const ACCENT = '2E5A88';

const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function transcriptSegments(rec) {
  return (rec.transcript && Array.isArray(rec.transcript.segments))
    ? rec.transcript.segments : [];
}

function buildTxt(rec) {
  const title = rec.title || rec.originalName || '录音记录';
  const lines = [title, ''];
  for (const seg of transcriptSegments(rec)) {
    lines.push(`[${fmt(Number(seg.start) || 0)}] ${seg.speaker || ''}：${seg.text || ''}`);
  }
  return lines.join('\n') + '\n';
}

function srtTime(seconds) {
  const ms = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function buildSrt(rec) {
  return transcriptSegments(rec).map((seg, i) => {
    const start = Number(seg.start) || 0;
    const rawEnd = Number(seg.end);
    const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start + 2;
    return `${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${seg.speaker ? seg.speaker + '：' : ''}${seg.text || ''}`;
  }).join('\n\n') + (transcriptSegments(rec).length ? '\n' : '');
}

function buildSproutsMarkdown(rec) {
  const title = rec.title || rec.originalName || '录音记录';
  const items = (rec.sprouts && Array.isArray(rec.sprouts.items)) ? rec.sprouts.items : [];
  const generatedAt = rec.sprouts && rec.sprouts.generatedAt;
  const date = generatedAt ? new Date(generatedAt).toLocaleDateString('zh-CN') : '';
  const lines = [`# ${title} · 发芽报告`, '', `${date ? `${date} · ` : ''}${items.length} 枚种子`, '', '> 从录音原话出发的 AI 启发式延展；典故与判断请结合上下文继续核验。', ''];
  if (!items.length) return [...lines, '本条录音暂无值得展开的发芽点。', ''].join('\n');
  items.forEach((item, index) => {
    lines.push(`## ${String(index + 1).padStart(2, '0')}. ${item.title}`);
    lines.push('', `**${item.type || '联想'} · 种子 [${fmt(item.start)}] ${item.speaker || ''}**`);
    lines.push('', `> ${item.source || ''}`);
    if (item.seedSummary) lines.push('', item.seedSummary);
    if (item.echo) lines.push('', `### 遥远的回声 · ${item.reference || ''}`, '', item.echo);
    lines.push('', '### 开花', '', item.expansion || '');
    lines.push('', `✨ **Aha：** ${item.aha || ''}`, '');
  });
  return lines.join('\n');
}

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

  const sprouts = rec.sprouts && Array.isArray(rec.sprouts.items) ? rec.sprouts.items : [];
  if (sprouts.length) {
    children.push(h('发芽报告', HeadingLevel.HEADING_1));
    children.push(p('从录音原话出发的 AI 启发式延展；典故与判断请结合上下文继续核验。', { size: 18, color: '888888' }));
    sprouts.forEach((item, index) => {
      children.push(h(`${String(index + 1).padStart(2, '0')}. ${item.title}`, HeadingLevel.HEADING_2));
      children.push(p(`🌱 ${item.type || '联想'} · 种子 [${fmt(item.start)}] ${item.speaker || ''}`, { bold: true, color: '487C3D' }));
      children.push(p(`“${item.source || ''}”`, { italics: true, color: '555555' }));
      if (item.seedSummary) children.push(p(item.seedSummary));
      if (item.echo) {
        children.push(h(`遥远的回声 · ${item.reference || ''}`, HeadingLevel.HEADING_3));
        children.push(p(item.echo));
      }
      children.push(h('开花', HeadingLevel.HEADING_3));
      children.push(p(item.expansion || ''));
      children.push(p(`Aha：${item.aha || ''}`, { bold: true, color: 'B27A00' }));
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

function buildMindmapMarkdown(rec) {
  const title = rec.title || rec.originalName || '录音记录';
  const mindmap = rec.mindmap;
  if (!mindmap) return `# ${title}\n\n思维导图尚未生成。\n`;
  // rec.mindmap 本身就是 markmap 格式的 Markdown 文本
  // 加上标题行和来源信息
  return `# ${title}\n\n> 由声图 SoundMap 生成 · ${new Date(rec.createdAt).toLocaleString('zh-CN')}\n\n${mindmap}\n`;
}

module.exports = { buildDocx, buildTxt, buildSrt, buildSproutsMarkdown, buildMindmapMarkdown, srtTime };
