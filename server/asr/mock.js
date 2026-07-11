// Mock 转写：不调真实 API，返回示例转写稿，用于跑通全流程/前端开发/演示
const SAMPLE = [
  { speaker: '说话人1', text: '各位好，今天我们过一下三季度的产品规划，重点是录音转写和思维导图两个模块。' },
  { speaker: '说话人2', text: '好的。先说转写这块，目前供应商报价是每小时六毛钱，成本可控，但要做失败重试和降级。' },
  { speaker: '说话人1', text: '同意。另外客户反馈最强烈的是导出功能，希望支持思维导图直接导出成图片和 XMind。' },
  { speaker: '说话人3', text: '导出我这周可以做完。还有一个事，安卓通话录音的自动导入，小米的目录路径又变了，需要热更新路径配置。' },
  { speaker: '说话人2', text: '那这个作为本周最高优先级。会后我把任务拆到看板上，下周三之前完成联调。' },
  { speaker: '说话人1', text: '好，那今天的待办就三件：导出功能、路径热更新、转写降级方案。散会。' },
];

module.exports = {
  name: 'mock',
  async transcribe() {
    await new Promise(r => setTimeout(r, 1500)); // 模拟耗时
    let t = 0;
    const segments = SAMPLE.map(s => {
      const dur = 4 + Math.round(s.text.length / 8);
      const seg = { start: t, end: t + dur, speaker: s.speaker, text: s.text };
      t += dur + 1;
      return seg;
    });
    return { language: 'zh', segments };
  },
};
