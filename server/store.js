// 极简 JSON 文件存储（Phase 0 用，Phase 1 换 PostgreSQL）
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { recordings: [] };
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
  get(id) {
    return load().recordings.find(r => r.id === id) || null;
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
};
