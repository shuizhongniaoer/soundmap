-- 声图 SoundMap — PostgreSQL 迁移脚本
-- 用法: psql $DATABASE_URL -f server/storage/migrations.sql

-- 录音主表（替代 db.json 的 recordings 数组）
CREATE TABLE IF NOT EXISTS recordings (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL DEFAULT 'local',
  title         TEXT,
  original_name TEXT,
  filename      TEXT NOT NULL,          -- 对象存储 key
  size          BIGINT,
  duration      INTEGER,                -- 秒
  status        TEXT NOT NULL DEFAULT 'uploaded',  -- uploaded|transcribing|summarizing|done|error
  error         TEXT,
  asr_provider  TEXT,
  providers     JSONB DEFAULT '{}',     -- { asr: 'dashscope', llm: 'mock' }
  transcript    JSONB,                  -- { segments: [{ start, end, speaker, text }] }
  summary       JSONB,                  -- { title, abstract, key_points, todos, quotes, qa_pairs }
  mindmap       TEXT,
  sprouts       JSONB,                  -- { items: [...], generatedAt }
  last_proofread JSONB,
  tags          TEXT[] DEFAULT '{}',
  folder        TEXT,
  summary_template TEXT DEFAULT 'auto',    -- 场景模板: auto|meeting|sales|lecture|interview|memo
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recordings_user     ON recordings (user_id);
CREATE INDEX IF NOT EXISTS idx_recordings_created  ON recordings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_status   ON recordings (status);
CREATE INDEX IF NOT EXISTS idx_recordings_tags     ON recordings USING GIN (tags);

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,            -- wechat | dev
  app_id      TEXT,
  openid      TEXT,
  unionid     TEXT,
  nickname    TEXT,
  avatar      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_wechat_openid ON users (app_id, openid) WHERE provider = 'wechat';
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_wechat_unionid ON users (unionid) WHERE provider = 'wechat' AND unionid IS NOT NULL;

-- 会话表（30 天过期）
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- OAuth state（微信登录 state，10 分钟过期）
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash  TEXT PRIMARY KEY,
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states (expires_at);

-- 下载令牌（一次性，2 分钟过期）
CREATE TABLE IF NOT EXISTS download_tokens (
  token_hash   TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  format       TEXT NOT NULL,           -- docx|txt|srt|sprouts|view
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_download_tokens_expires ON download_tokens (expires_at);

-- 全局键值存储（热词表、声纹库等用户级配置）
CREATE TABLE IF NOT EXISTS meta (
  key    TEXT PRIMARY KEY,
  value  JSONB
);

-- updated_at 自动更新触发器
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_recordings_touch ON recordings;
CREATE TRIGGER tr_recordings_touch BEFORE UPDATE ON recordings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS tr_users_touch ON users;
CREATE TRIGGER tr_users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
