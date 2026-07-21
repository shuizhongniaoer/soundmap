// 用户自定义总结模板：复用 meta 存储，兼容 JSON 与 PostgreSQL 两种后端。
// 模板内容属于用户数据，所有读写都必须带 userId，避免跨账号泄露或误用。
const crypto = require('crypto');
const store = require('../store');

const MAX_TEMPLATES = 20;
const MAX_NAME_LENGTH = 40;
const MAX_DESC_LENGTH = 120;
const MAX_INSTRUCTION_LENGTH = 4000;

function metaKey(userId) {
  return `customTemplates:${String(userId || 'local')}`;
}

function text(value, field, max, required = false) {
  const result = String(value == null ? '' : value).trim();
  if (required && !result) throw new Error(`${field}不能为空`);
  if (result.length > max) throw new Error(`${field}不能超过${max}字`);
  return result;
}

function normalizeInput(input, { partial = false } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const out = {};
  if (!partial || Object.prototype.hasOwnProperty.call(source, 'name')) {
    out.name = text(source.name, '模板名称', MAX_NAME_LENGTH, true);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(source, 'desc')) {
    out.desc = text(source.desc, '模板描述', MAX_DESC_LENGTH);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(source, 'instruction')) {
    out.instruction = text(source.instruction, '模板指令', MAX_INSTRUCTION_LENGTH, true);
  }
  return out;
}

async function list(userId) {
  const value = await store.getMeta(metaKey(userId));
  return Array.isArray(value) ? value : [];
}

async function get(userId, id) {
  return (await list(userId)).find(template => template.id === id) || null;
}

async function create(userId, input) {
  const templates = await list(userId);
  if (templates.length >= MAX_TEMPLATES) throw new Error(`自定义模板最多${MAX_TEMPLATES}个`);
  const fields = normalizeInput(input);
  const now = new Date().toISOString();
  const template = {
    id: `custom_${crypto.randomUUID()}`,
    ...fields,
    custom: true,
    createdAt: now,
    updatedAt: now,
  };
  await store.setMeta(metaKey(userId), [...templates, template]);
  return template;
}

async function update(userId, id, input) {
  const templates = await list(userId);
  const index = templates.findIndex(template => template.id === id);
  if (index < 0) return null;
  const patch = normalizeInput(input, { partial: true });
  const updated = { ...templates[index], ...patch, updatedAt: new Date().toISOString() };
  templates[index] = updated;
  await store.setMeta(metaKey(userId), templates);
  return updated;
}

async function remove(userId, id) {
  const templates = await list(userId);
  const next = templates.filter(template => template.id !== id);
  if (next.length === templates.length) return false;
  await store.setMeta(metaKey(userId), next);
  return true;
}

module.exports = {
  MAX_TEMPLATES,
  MAX_NAME_LENGTH,
  MAX_DESC_LENGTH,
  MAX_INSTRUCTION_LENGTH,
  list,
  get,
  create,
  update,
  remove,
};
