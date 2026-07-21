const test = require('node:test');
const assert = require('node:assert/strict');
const customTemplates = require('./custom-templates');
const prompts = require('./prompts');

test('自定义模板支持用户隔离、创建、修改和删除', async () => {
  const userId = `custom-test-${Date.now()}-${Math.random()}`;
  const otherUserId = `${userId}-other`;
  const created = await customTemplates.create(userId, {
    name: '项目复盘',
    desc: '提炼决策和风险',
    instruction: '重点分析决策依据、风险和下一步行动。',
  });
  assert.match(created.id, /^custom_/);
  assert.equal((await customTemplates.list(otherUserId)).length, 0);
  assert.equal((await customTemplates.get(userId, created.id)).name, '项目复盘');

  const updated = await customTemplates.update(userId, created.id, { name: '季度复盘' });
  assert.equal(updated.name, '季度复盘');
  assert.equal(updated.instruction, created.instruction);
  assert.equal(await customTemplates.remove(otherUserId, created.id), false);
  assert.equal(await customTemplates.remove(userId, created.id), true);
  assert.equal(await customTemplates.get(userId, created.id), null);
});

test('自定义模板校验长度并注入总结 Prompt', async () => {
  await assert.rejects(
    customTemplates.create(`validation-${Date.now()}`, { name: '', instruction: 'x' }),
    /模板名称不能为空/,
  );
  const messages = prompts.summaryMessages(
    [{ speaker: '甲', text: '今天复盘项目。' }],
    '测试录音',
    'custom_demo',
    { instruction: '只关注决策依据和风险。' },
  );
  assert.match(messages[0].content, /只关注决策依据和风险/);
});

