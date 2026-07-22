// PostgreSQL 存储适配器
// 需要: DATABASE_URL 环境变量 + 已执行 migrations.sql

const { Pool, types } = require('pg');
const { logError } = require('../logger');

// 让 pg 自动解析 JSONB 为 JS 对象（而非字符串）
types.setTypeParser(3802, val => val ? JSON.parse(val) : null); // jsonb
types.setTypeParser(114, val => val ? JSON.parse(val) : null);  // json

// ---- 字段映射: JS camelCase ↔ DB snake_case ----
const FIELD_MAP = {
  id: 'id', userId: 'user_id', title: 'title', originalName: 'original_name',
  filename: 'filename', size: 'size', duration: 'duration', status: 'status',
  error: 'error', asrProvider: 'asr_provider', providers: 'providers',
  transcript: 'transcript', summary: 'summary', mindmap: 'mindmap',
  sprouts: 'sprouts', lastProofread: 'last_proofread', tags: 'tags',
  folder: 'folder', summaryTemplate: 'summary_template',
  createdAt: 'created_at', updatedAt: 'updated_at',
};

// 这些字段在 DB 中是 JSONB，写入时需要 JSON.stringify
const JSONB_COLUMNS = new Set(['providers', 'transcript', 'summary', 'sprouts', 'last_proofread']);

// DB snake_case → JS camelCase
const COLUMN_TO_FIELD = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([js, db]) => [db, js])
);

const USER_FIELD_MAP = {
  id: 'id', provider: 'provider', appId: 'app_id', openid: 'openid', unionid: 'unionid',
  nickname: 'nickname', avatarUrl: 'avatar', country: 'country', province: 'province', city: 'city',
  createdAt: 'created_at', updatedAt: 'updated_at',
};
const USER_COLUMN_TO_FIELD = Object.fromEntries(
  Object.entries(USER_FIELD_MAP).map(([js, db]) => [db, js])
);
function userRowToUser(row) {
  if (!row) return null;
  const user = {};
  for (const [dbCol, val] of Object.entries(row)) user[USER_COLUMN_TO_FIELD[dbCol] || dbCol] = val;
  return user;
}

function rowToRec(row) {
  if (!row) return null;
  const rec = {};
  for (const [dbCol, val] of Object.entries(row)) {
    const jsField = COLUMN_TO_FIELD[dbCol] || dbCol;
    rec[jsField] = val;
  }
  return rec;
}

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (err) => {
      logError('storage.postgresql_pool_error', err);
    });
  }
  return pool;
}

// 构建动态 UPDATE 语句
function buildUpdate(patch) {
  const sets = [];
  const values = [];
  let idx = 1;
  for (const [jsField, val] of Object.entries(patch)) {
    const col = FIELD_MAP[jsField];
    if (!col) continue; // 忽略未知字段
    if (JSONB_COLUMNS.has(col)) {
      sets.push(`${col} = $${idx}::jsonb`);
      values.push(val == null ? null : JSON.stringify(val));
    } else if (col === 'tags') {
      sets.push(`${col} = $${idx}`);
      values.push(val || []);
    } else {
      sets.push(`${col} = $${idx}`);
      values.push(val);
    }
    idx++;
  }
  if (sets.length === 0) return null;
  return { clause: sets.join(', '), values };
}

module.exports = {
  name: 'pg',

  async list() {
    const res = await getPool().query('SELECT * FROM recordings ORDER BY created_at DESC');
    return res.rows.map(rowToRec);
  },

  async listForUser(userId) {
    const res = await getPool().query(
      'SELECT * FROM recordings WHERE COALESCE(user_id, $1) = $1 ORDER BY created_at DESC',
      [userId]
    );
    return res.rows.map(rowToRec);
  },

  async get(id) {
    const res = await getPool().query('SELECT * FROM recordings WHERE id = $1', [id]);
    return rowToRec(res.rows[0]);
  },

  async getForUser(id, userId) {
    const res = await getPool().query(
      'SELECT * FROM recordings WHERE id = $1 AND COALESCE(user_id, $2) = $2', [id, userId]
    );
    return rowToRec(res.rows[0]);
  },

  async create(rec) {
    const cols = [];
    const placeholders = [];
    const values = [];
    let idx = 1;
    for (const [jsField, val] of Object.entries(rec)) {
      const col = FIELD_MAP[jsField];
      if (!col) continue;
      cols.push(col);
      if (JSONB_COLUMNS.has(col)) {
        placeholders.push(`$${idx}::jsonb`);
        values.push(val == null ? null : JSON.stringify(val));
      } else {
        placeholders.push(`$${idx}`);
        values.push(val);
      }
      idx++;
    }
    const res = await getPool().query(
      `INSERT INTO recordings (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      values
    );
    return rowToRec(res.rows[0]);
  },

  async update(id, patch) {
    const built = buildUpdate(patch);
    if (!built) {
      // 没有有效字段，直接返回当前记录
      return this.get(id);
    }
    const res = await getPool().query(
      `UPDATE recordings SET ${built.clause} WHERE id = $${built.values.length + 1} RETURNING *`,
      [...built.values, id]
    );
    return rowToRec(res.rows[0]);
  },

  async getMeta(key) {
    const res = await getPool().query('SELECT value FROM meta WHERE key = $1', [key]);
    return res.rows[0]?.value || null;
  },

  async setMeta(key, val) {
    await getPool().query(
      `INSERT INTO meta (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb`,
      [key, JSON.stringify(val)]
    );
  },

  async findWechatUser({ appId, openid, unionid }) {
    if (unionid) {
      const res = await getPool().query(
        `SELECT * FROM users WHERE provider = 'wechat' AND unionid = $1`, [unionid]
      );
      if (res.rows[0]) return userRowToUser(res.rows[0]);
    }
    if (appId && openid) {
      const res = await getPool().query(
        `SELECT * FROM users WHERE provider = 'wechat' AND app_id = $1 AND openid = $2`, [appId, openid]
      );
      if (res.rows[0]) return userRowToUser(res.rows[0]);
    }
    return null;
  },

  async upsertWechatUser(profile) {
    let user = await this.findWechatUser(profile);
    if (user) {
      const sets = [];
      const values = [];
      let idx = 1;
      for (const [jsField, val] of Object.entries(profile)) {
        const col = USER_FIELD_MAP[jsField];
        if (!col || ['id', 'createdAt', 'updatedAt'].includes(jsField)) continue;
        sets.push(`${col} = $${idx}`);
        values.push(val);
        idx++;
      }
      sets.push('updated_at = now()');
      values.push(user.id);
      const res = await getPool().query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, values
      );
      return userRowToUser(res.rows[0]);
    }
    const id = require('crypto').randomUUID();
    const now = new Date().toISOString();
    const cols = ['id', 'provider', 'created_at', 'updated_at'];
    const values = [id, 'wechat', now, now];
    for (const [jsField, val] of Object.entries(profile)) {
      const col = USER_FIELD_MAP[jsField];
      if (!col || ['id', 'createdAt', 'updatedAt'].includes(jsField)) continue;
      cols.push(col);
      values.push(val);
    }
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const res = await getPool().query(
      `INSERT INTO users (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return userRowToUser(res.rows[0]);
  },

  async getOrCreateLocalUser() {
    const existing = await this.getUser('local');
    if (existing) return existing;
    const now = new Date().toISOString();
    const res = await getPool().query(
      `INSERT INTO users (id, provider, nickname, created_at, updated_at)
       VALUES ('local', 'dev', '本地体验账号', $1, $1) RETURNING *`, [now]
    );
    return userRowToUser(res.rows[0]);
  },

  async getUser(id) {
    const res = await getPool().query('SELECT * FROM users WHERE id = $1', [id]);
    return userRowToUser(res.rows[0]);
  },

  async createSession(session) {
    // 清理过期会话
    await getPool().query('DELETE FROM sessions WHERE expires_at < now()');
    const res = await getPool().query(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [session.tokenHash, session.userId, session.createdAt, session.expiresAt]
    );
    return rowToRec(res.rows[0]);
  },

  async findSession(tokenHash) {
    const res = await getPool().query(
      'SELECT * FROM sessions WHERE token_hash = $1 AND expires_at > now()', [tokenHash]
    );
    return rowToRec(res.rows[0]);
  },

  async deleteSession(tokenHash) {
    await getPool().query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  },

  async createOauthState(state) {
    await getPool().query('DELETE FROM oauth_states WHERE expires_at < now()');
    await getPool().query(
      'INSERT INTO oauth_states (state_hash, expires_at) VALUES ($1, $2)',
      [state.stateHash, state.expiresAt]
    );
  },

  async consumeOauthState(stateHash) {
    const res = await getPool().query(
      'DELETE FROM oauth_states WHERE state_hash = $1 AND expires_at > now() RETURNING state_hash',
      [stateHash]
    );
    return res.rows.length > 0;
  },

  async createDownloadToken(grant) {
    await getPool().query('DELETE FROM download_tokens WHERE expires_at < now()');
    await getPool().query(
      `INSERT INTO download_tokens (token_hash, recording_id, user_id, format, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [grant.tokenHash, grant.recordingId, grant.userId, grant.format, grant.expiresAt]
    );
  },

  async consumeDownloadToken(tokenHash) {
    const res = await getPool().query(
      `DELETE FROM download_tokens WHERE token_hash = $1 AND expires_at > now()
       RETURNING recording_id, user_id, format`,
      [tokenHash]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return { tokenHash, recordingId: r.recording_id, userId: r.user_id, format: r.format };
  },

  async checkReady() {
    await getPool().query('SELECT 1');
  },

  async close() {
    if (pool) await pool.end();
  },
};
