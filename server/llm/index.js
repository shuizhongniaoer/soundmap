// LLM 供应商抽象层
// summarize(segments, title) -> { title, abstract, key_points, todos, quotes }
// mindmap(segments, title)   -> Markdown 大纲字符串
const prompts = require('./prompts');
const { normalizeSprouts } = require('./sprouts');

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
  async sprouts(segments, title) {
    const out = await chat(prompts.sproutMessages(segments, title), { json: true });
    return normalizeSprouts(JSON.parse(stripFence(out)), segments);
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
  async sprouts(segments) {
    await new Promise(r => setTimeout(r, 400));
    if (!segments.length) return { items: [] };
    return normalizeSprouts({ sprouts: [{
      segment_index: 0,
      type: '方法',
      title: '地图之外，才是疆域',
      seed_summary: '一句看似普通的产品规划，其实在做一件古老的事：先给尚未抵达的未来画出轮廓，再决定今天把脚落在哪里。',
      reference: '郑和航海与《坤舆万国全图》',
      echo: '人类每一次走向未知，都先需要一张并不完美的地图。郑和的船队依靠星象、针路与前人海图穿过季风；后来的世界地图又不断被新航程改写。地图从来不是疆域本身，却让分散的勇气有了共同方向。',
      expansion: '产品规划也是这样。转写、导图、导出这些模块只是纸面上的海岸线，真正的疆域要在用户的使用、抱怨和意外发现中显现。规划的价值，不是预言未来，而是让团队在不确定中拥有一套可以共同修正的坐标。',
      aha: '好的规划不替未来作答，它只是让一群人能够朝同一片未知出发。',
      score: 0.82,
    }] }, segments);
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
  sprouts(segments, title) { return resolveProvider().sprouts(segments, title); },
  proofread(segments, hotwords) { return resolveProvider().proofread(segments, hotwords); },
};
