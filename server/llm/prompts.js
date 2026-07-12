// Prompt 模板（对应产品设计 3.3 节：多维总结 + 思维导图）
// 核心策略：先让模型判断录音类型，再按类型选择合适的总结风格——
// 会议才用纪要腔，生活对话用自然的语言，不硬套模板。

function transcriptText(segments) {
  return segments.map(s => `${s.speaker}: ${s.text}`).join('\n');
}

exports.summaryMessages = (segments, title) => [
  {
    role: 'system',
    content: `你是录音笔记助手。先判断录音内容的类型，再按类型用合适的风格总结。

输出严格 JSON（不要输出 JSON 以外的任何内容），字段：
- type: 内容类型，从这些里选一个："会议"、"工作通话"、"访谈"、"课堂"、"生活对话"、"灵感口述"、"其他"
- title: 贴合内容的简短标题（生活对话就起生活化的标题，不要叫"XX会议"）
- abstract: 150字以内摘要
- key_points: 要点数组
- todos: 待办数组，每项 {task, owner}，owner 未知填 null
- quotes: 值得记住的原话数组

风格规则（重要）：
1. abstract 的语气必须匹配类型：生活对话/闲聊用自然温暖的语言记录场景、人物和氛围，严禁使用"参会人员""强调了""会议开始前"这类公文腔；只有真正的会议/工作内容才用纪要腔。
2. key_points 对生活对话来说是"有趣的瞬间、重要的信息、值得回忆的细节"，不是"决议事项"。
3. todos 只在确实有人约定或计划要做某件事时才填，没有就返回空数组 []，绝不为了填满字段而编造。
4. 转写稿可能存在语音识别错误，结合上下文推断真实意思，明显误听的词不要照抄进总结。`,
  },
  { role: 'user', content: `录音标题: ${title || '未命名'}\n\n转写稿:\n${transcriptText(segments)}` },
];

exports.mindmapMessages = (segments, title) => [
  {
    role: 'system',
    content: `你是思维导图生成器。先判断录音内容类型，让导图结构贴合内容本身：
- 会议/工作：按议题、结论、待办组织
- 生活对话：可按场景、人物、话题、有趣的细节组织，不要硬造"待办""决议"节点
- 课堂/讲座：按知识点层级组织
- 访谈：按问题与回答的主题组织

输出层级化 Markdown 大纲：第一行 "# 主题"，之后用 ##、###、- 表达层级；节点文字精炼（不超过15字）；总节点数 15~40 个；只输出 Markdown，不要代码块围栏。转写稿中明显的识别错误结合上下文纠正后再提炼。`,
  },
  { role: 'user', content: `录音标题: ${title || '未命名'}\n\n转写稿:\n${transcriptText(segments)}` },
];
