// LLM 供应商抽象层
// summarize(segments, title) -> { title, abstract, key_points, todos, quotes }
// mindmap(segments, title)   -> Markdown 大纲字符串
const prompts = require('./prompts');

const HOST = (process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com').replace(/\/$/, '');
const OPENAI_COMPAT_URL = `${HOST}/compatible-mode/v1/chat/completions`;

async function chat(messages, { json = false } = {}) {
  const res = await fetch(OPENAI_COMPAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || 'qwen-plus',
      messages,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`LLM 返回了非 JSON 响应 (HTTP ${res.status}): ${text.slice(0, 300) || '(空响应)'} —— 请检查 DASHSCOPE_BASE_URL 是否正确`);
  }
  if (!res.ok) throw new Error(`LLM ${res.status}: ${JSON.stringify(body)}`);
  return body.choices[0].message.content;
}

function stripFence(s) {
  return s.replace(/^```(?:json|markdown|md)?\s*/i, '').replace(/```\s*$/, '').trim();
}

const dashscope = {
  name: 'dashscope',
  async summarize(segments, title) {
    const out = await chat(prompts.summaryMessages(segments, title), { json: true });
    return JSON.parse(stripFence(out));
  },
  async mindmap(segments, title) {
    return stripFence(await chat(prompts.mindmapMessages(segments, title)));
  },
  async proofread(segments, hotwords) {
    const out = await chat(prompts.proofreadMessages(segments, hotwords), { json: true });
    const parsed = JSON.parse(stripFence(out));
    return Array.isArray(parsed.corrections) ? parsed.corrections : [];
  },
};

const mock = {
  name: 'mock',
  async summarize(segments, title) {
    await new Promise(r => setTimeout(r, 800));
    return {
      title: title || '三季度产品规划会',
      abstract: '会议围绕三季度产品规划展开，确认转写成本可控但需降级方案，明确导出功能与安卓通话录音路径热更新为本周高优先级，共产出三项待办。',
      key_points: [
        '转写供应商成本约 0.6 元/小时，需要失败重试与降级通道',
        '用户最强烈的需求是思维导图导出为图片和 XMind',
        '小米通话录音目录路径变更，需支持云端热更新路径配置',
      ],
      todos: [
        { task: '完成思维导图导出功能（图片/XMind）', owner: '说话人3' },
        { task: '通话录音路径配置热更新，下周三前联调完成', owner: '说话人2' },
        { task: '设计转写失败重试与供应商降级方案', owner: null },
      ],
      quotes: ['那这个作为本周最高优先级。'],
    };
  },
  async proofread() {
    return []; // mock 不做校对
  },
  async mindmap() {
    await new Promise(r => setTimeout(r, 500));
    return [
      '# 三季度产品规划会',
      '## 转写模块',
      '- 成本 0.6 元/小时',
      '- 失败重试',
      '- 供应商降级通道',
      '## 用户反馈',
      '### 导出功能',
      '- 导图导出图片',
      '- 导出 XMind',
      '## 安卓通话录音',
      '- 小米路径变更',
      '- 路径配置热更新',
      '## 本周待办',
      '- 导出功能',
      '- 路径热更新',
      '- 转写降级方案',
    ].join('\n');
  },
};

function resolveProvider() {
  const want = (process.env.LLM_PROVIDER || 'mock').toLowerCase();
  if (want === 'dashscope') {
    if (!process.env.DASHSCOPE_API_KEY) {
      console.warn('[llm] LLM_PROVIDER=dashscope 但未配置 DASHSCOPE_API_KEY，降级为 mock');
      return mock;
    }
    return dashscope;
  }
  return mock;
}

module.exports = {
  get name() { return resolveProvider().name; },
  summarize(segments, title) { return resolveProvider().summarize(segments, title); },
  mindmap(segments, title) { return resolveProvider().mindmap(segments, title); },
  proofread(segments, hotwords) { return resolveProvider().proofread(segments, hotwords); },
};
