// 场景模板定义（对应设计文档 3.3：多维总结 + 场景模板）
// 每个模板的 instruction 会被注入到 summaryMessages 的 system prompt 中，
// 覆盖默认的"自动判断类型"行为，让 LLM 按指定场景的风格和侧重点总结。

const TEMPLATES = [
  {
    id: 'auto',
    name: '通用自动',
    desc: 'AI 自动判断录音类型，按匹配风格总结',
    // auto 不注入额外指令，使用默认行为
    instruction: null,
  },
  {
    id: 'meeting',
    name: '会议纪要',
    desc: '议题、决议、待办，结构化会议记录',
    instruction: `本次录音是会议。请按会议纪要风格总结：
- abstract 用简练的纪要语言概括会议主旨和核心结论
- key_points 按议题组织，每个议题包含讨论要点和决议
- todos 严格提取所有明确的行动项（谁、做什么、何时），没有行动项则返回空数组
- 重点关注：决议结论、分歧意见、责任分配、时间节点`,
  },
  {
    id: 'sales',
    name: '销售通话',
    desc: '客户需求、异议、下一步行动，销售场景分析',
    instruction: `本次录音是销售/商务通话。请按销售分析风格总结：
- abstract 概括通话目的、客户画像和关键结论
- key_points 围绕：客户需求与痛点、产品/方案匹配点、客户异议与顾虑、价格/条款讨论
- todos 提取后续跟进事项（发送资料、安排演示、报价等）
- quotes 摘录客户的真实需求表达或关键异议原话
- qa_pairs 提取通话中销售与客户之间的真实问答`,
  },
  {
    id: 'lecture',
    name: '课堂笔记',
    desc: '知识层级、重点概念、复习要点',
    instruction: `本次录音是课堂/讲座/培训。请按课堂笔记风格总结：
- abstract 概括本节课的主题、核心知识点和学习目标
- key_points 按知识层级组织（大主题 → 子知识点），每个要点简明扼要
- 重点关注：核心概念定义、关键公式/方法、重要案例、易错点
- todos 提取课后作业、复习建议、延伸阅读等（没有则返回空数组）
- qa_pairs 提取课堂上师生之间的真实问答`,
  },
  {
    id: 'interview',
    name: '访谈记录',
    desc: '按问答主题组织，突出受访者观点',
    instruction: `本次录音是访谈/采访。请按访谈记录风格总结：
- abstract 概括访谈主题、受访者背景和访谈核心发现
- key_points 按访谈话题组织，每个话题下列出受访者的关键观点
- quotes 优先摘录受访者有洞察力、有信息量的原话
- qa_pairs 提取访谈中的真实问答（采访者提问、受访者回答）
- 重点关注：受访者的独特见解、个人经历、对行业的判断`,
  },
  {
    id: 'memo',
    name: '灵感口述',
    desc: '提取创意点子，梳理思路脉络',
    instruction: `本次录音是灵感口述/语音备忘。请按灵感笔记风格总结：
- abstract 概括这段口述的核心想法和思考方向
- key_points 提取所有有价值的创意点子、判断和思路分支
- todos 提取口述中提到的待办或验证事项（没有则返回空数组）
- quotes 摘录最有启发性或最生动的原话
- 语气保持口述者的个人风格，不要过度正式化`,
  },
];

const BY_ID = Object.fromEntries(TEMPLATES.map(t => [t.id, t]));

function getTemplate(id) {
  return BY_ID[id] || null;
}

function isValid(id) {
  return id === 'auto' || !!BY_ID[id];
}

module.exports = { TEMPLATES, getTemplate, isValid };
