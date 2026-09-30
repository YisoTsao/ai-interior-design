-- InteriorAI 資料庫 Schema（PostgreSQL 15+；docker-compose 使用 16）。不啟用 PostGIS（ADR-015）。權威 DDL；以 SQL migrations 管理。
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE org_role AS ENUM ('owner','admin','editor','viewer');
CREATE TYPE job_state AS ENUM ('queued','running','validating','succeeded','failed','canceled');
CREATE TYPE job_type AS ENUM ('render','inpaint','plan_import','export','thumbnail','moderation');
CREATE TYPE ledger_reason AS ENUM ('purchase','reserve','settle','refund','grant','adjust');
CREATE TYPE asset_status AS ENUM ('draft','review','published','retired');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL,
  display_name text,
  locale text NOT NULL DEFAULT 'zh-TW',
  password_hash text,               -- 僅本機/簡易認證使用
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE TABLE orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  plan text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role org_role NOT NULL DEFAULT 'editor',
  PRIMARY KEY (org_id, user_id)
);
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  thumbnail_key text,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX projects_org_idx ON projects(org_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE project_versions (            -- 不可變
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_version_id uuid REFERENCES project_versions(id),
  schema_version text NOT NULL,
  content_hash text NOT NULL,
  scene_key text NOT NULL,                 -- S3 key of scene.json
  created_by uuid REFERENCES users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, content_hash)
);
ALTER TABLE projects ADD CONSTRAINT projects_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES project_versions(id);

CREATE TABLE uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('plan','photo','gbuffer','asset','other')),
  storage_key text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploaded','rejected')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name_zh text NOT NULL,
  name_en text,
  category text NOT NULL,
  subcategory text,
  tags text[] NOT NULL DEFAULT '{}',
  style_tags text[] NOT NULL DEFAULT '{}',
  brand text,
  dims_mm jsonb NOT NULL,                  -- {w,d,h}
  anchor text NOT NULL DEFAULT 'floor' CHECK (anchor IN ('floor','wall','ceiling')),
  model_key text, lod1_key text, thumb_key text,
  material_slots jsonb NOT NULL DEFAULT '[]',
  parametric jsonb,                        -- {type, params_schema}
  license jsonb NOT NULL,                  -- {type, source, allowed_use[], attribution}
  status asset_status NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'published' OR (license ? 'type' AND license ? 'source'))
);
CREATE INDEX assets_cat_idx ON catalog_assets(category, subcategory) WHERE status='published';
CREATE INDEX assets_name_trgm ON catalog_assets USING gin (name_zh gin_trgm_ops);

CREATE TABLE materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name_zh text NOT NULL,
  category text NOT NULL,
  maps jsonb NOT NULL,                     -- {baseColor,normal,roughness,ao} keys
  real_size_mm jsonb NOT NULL,             -- {w,h}
  license jsonb NOT NULL,
  status asset_status NOT NULL DEFAULT 'draft'
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  type job_type NOT NULL,
  state job_state NOT NULL DEFAULT 'queued',
  progress int NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  input jsonb NOT NULL,
  output jsonb,
  cost_estimate_credits int NOT NULL DEFAULT 0,
  cost_actual_credits int,
  retry_count int NOT NULL DEFAULT 0,
  error_code text, error_message text,
  provenance jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz, finished_at timestamptz
);
CREATE INDEX jobs_org_state_idx ON jobs(org_id, state, created_at DESC);

CREATE TABLE renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_id uuid REFERENCES project_versions(id),
  camera jsonb NOT NULL,
  settings jsonb NOT NULL,
  output_key text, width int, height int,
  validation_score real, validation_passed boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plan_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  upload_id uuid NOT NULL REFERENCES uploads(id),
  source text CHECK (source IN ('vector','raster')),
  scale jsonb,
  draft_scene jsonb,                       -- 含 confidence 的 Scene 草稿
  warnings jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credit_ledger (               -- append-only
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  delta int NOT NULL,
  reason ledger_reason NOT NULL,
  job_id uuid REFERENCES jobs(id),
  idempotency_key text,
  balance_after int NOT NULL CHECK (balance_after >= 0),
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, idempotency_key)
);
CREATE INDEX ledger_org_idx ON credit_ledger(org_id, id DESC);
-- ADR-014：每個 Job 的 reserve / settle / refund 各只能發生一次
CREATE UNIQUE INDEX ledger_job_reason_uniq ON credit_ledger(job_id, reason)
  WHERE job_id IS NOT NULL AND reason IN ('reserve','settle','refund');
-- 帳本冪等鍵慣例：'{jobId}:{reason}'（永久有效，不受 HTTP Idempotency-Key 24h TTL 影響）
-- 禁止 UPDATE/DELETE
CREATE OR REPLACE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'credit_ledger is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER credit_ledger_no_update BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

CREATE TABLE idempotency_keys (
  key text NOT NULL, org_id uuid NOT NULL,
  request_hash text NOT NULL, response jsonb, status int,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, key)
);

CREATE TABLE shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  version_id uuid REFERENCES project_versions(id),
  expires_at timestamptz, revoked_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  org_id uuid, user_id uuid,
  action text NOT NULL, target_type text, target_id text,
  ip inet, user_agent text, meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org_idx ON audit_log(org_id, created_at DESC);

-- Row Level Security（第二道防線）。
-- 連線池（transaction pooling）下 MUST 在每個交易內用 `SET LOCAL app.org_id = '<uuid>'`；
-- 使用 session 級 SET 會在連線被重用時外洩或誤判租戶。未設定時 current_setting(..., true) 為 NULL → 查無資料（安全失敗）。
-- 應用程式使用的資料庫角色 MUST NOT 是表擁有者或 superuser，否則 RLS 會被略過（或加 FORCE ROW LEVEL SECURITY）。
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
CREATE POLICY projects_org_isolation ON projects
  USING (org_id = current_setting('app.org_id', true)::uuid);
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY jobs_org_isolation ON jobs
  USING (org_id = current_setting('app.org_id', true)::uuid);
