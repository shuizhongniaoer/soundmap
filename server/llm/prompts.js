// Prompt 模板（对应产品设计 3.3 节：多维总结 + 思维导图）
// 后续"总结模板中心"= 在 SUMMARY 基础上按场景替换 system 指令

function transcriptText(segments) {
  return segments.map(s => `${s.speaker}: ${s.text}`).join('\n');
}

exports.summaryMessages = (segments, title) => [
  {
    role: 'system',
    content:
      '你是专业的会议/录音纪要助手。根据转写稿输出 JSON（不要输出 JSON 以外的任何内容），字段：' +
      'title(为这段录音起的简短标题), abstract(150字以内摘要), key_points(要点数组，每条一句话), ' +
      'todos(待办数组，每项含 task 与 owner，owner 未知则填 null), quotes(值得记录的原话数组，可为空)。',
  },
  { role: 'user', content: `录音标题: ${title || '未命名'}\n\n转写稿:\n${transcriptText(segments)}` },
];

exports.mindmapMessages = (segments, title) => [
  {
    role: 'system',
    content:
      '你是思维导图生成器。把转写稿内容提炼为层级化 Markdown 大纲：' +
      '第一行是 "# 主题"，之后用 ##、###、- 表达层级；节点文字精炼（不超过15字）；' +
      '总节点数控制在 15~40 个；只输出 Markdown，不要代码块围栏。',
  },
  { role: 'user', content: `录音标题: ${title || '未命名'}\n\n转写稿:\n${transcriptText(segments)}` },
];
