// 极简 JSON 文件存储（Phase 0 用，Phase 1 换 PostgreSQL）
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.SOUNDMAP_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function load() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.recordings = db.recordings || [];
    db.users = db.users || [];
    db.sessions = db.sessions || [];
    db.oauthStates = db.oauthStates || [];
    db.downloadTokens = db.downloadTokens || [];
    return db;
  } catch {
    return { recordings: [], users: [], sessions: [], oauthStates: [], downloadTokens: [] };
  }
}

function save(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

module.exports = {
  list() {
    return load().recordings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  listForUser(userId) {
    return this.list().filter(r => r.userId === userId || (!r.userId && userId === 'local'));
  },
  get(id) {
    return load().recordings.find(r => r.id === id) || null;
  },
  getForUser(id, userId) {
    const rec = this.get(id);
    if (!rec) return null;
    return rec.userId === userId || (!rec.userId && userId === 'local') ? rec : null;
  },
  create(rec) {
    const db = load();
    db.recordings.push(rec);
    save(db);
    return rec;
  },
  update(id, patch) {
    const db = load();
    const rec = db.recordings.find(r => r.id === id);
    if (!rec) return null;
    Object.assign(rec, patch, { updatedAt: new Date().toISOString() });
    save(db);
    return rec;
  },
  // 全局键值（热词表、声纹库等设置）
  getMeta(key) {
    return (load().meta || {})[key];
  },
  setMeta(key, val) {
    const db = load();
    db.meta = db.meta || {};
    db.meta[key] = val;
    save(db);
  },
  findWechatUser({ appId, openid, unionid }) {
    return load().users.find(u =>
      u.provider === 'wechat' &&
      ((unionid && u.unionid === unionid) || (u.appId === appId && u.openid === openid))
    ) || null;
  },
  upsertWechatUser(profile) {
    const db = load();
    const now = new Date().toISOString();
    let user = db.users.find(u =>
      u.provider === 'wechat' &&
      ((profile.unionid && u.unionid === profile.unionid) ||
        (u.appId === profile.appId && u.openid === profile.openid))
    );
    if (!user) {
      user = { id: require('crypto').randomUUID(), provider: 'wechat', createdAt: now };
      db.users.push(user);
    }
    Object.assign(user, profile, { updatedAt: now });
    save(db);
    return user;
  },
  getOrCreateLocalUser() {
    const db = load();
    let user = db.users.find(u => u.id === 'local');
    if (!user) {
      const now = new Date().toISOString();
      user = { id: 'local', provider: 'dev', nickname: '本地体验账号', createdAt: now, updatedAt: now };
      db.users.push(user);
      save(db);
    }
    return user;
  },
  getUser(id) {
    return load().users.find(u => u.id === id) || null;
  },
  createSession(session) {
    const db = load();
    db.sessions = db.sessions.filter(s => new Date(s.expiresAt).getTime() > Date.now());
    db.sessions.push(session);
    save(db);
    return session;
  },
  findSession(tokenHash) {
    const db = load();
    return db.sessions.find(s => s.tokenHash === tokenHash && new Date(s.expiresAt).getTime() > Date.now()) || null;
  },
  deleteSession(tokenHash) {
    const db = load();
    const before = db.sessions.length;
    db.sessions = db.sessions.filter(s => s.tokenHash !== tokenHash);
    if (db.sessions.length !== before) save(db);
  },
  createOauthState(state) {
    const db = load();
    db.oauthStates = db.oauthStates.filter(s => new Date(s.expiresAt).getTime() > Date.now());
    db.oauthStates.push(state);
    save(db);
  },
  consumeOauthState(stateHash) {
    const db = load();
    const index = db.oauthStates.findIndex(s =>
      s.stateHash === stateHash && new Date(s.expiresAt).getTime() > Date.now()
    );
    if (index < 0) return false;
    db.oauthStates.splice(index, 1);
    save(db);
    return true;
  },
  createDownloadToken(grant) {
    const db = load();
    db.downloadTokens = db.downloadTokens.filter(t => new Date(t.expiresAt).getTime() > Date.now());
    db.downloadTokens.push(grant);
    save(db);
  },
  consumeDownloadToken(tokenHash) {
    const db = load();
    const index = db.downloadTokens.findIndex(t =>
      t.tokenHash === tokenHash && new Date(t.expiresAt).getTime() > Date.now()
    );
    if (index < 0) return null;
    const [grant] = db.downloadTokens.splice(index, 1);
    save(db);
    return grant;
  },
};
