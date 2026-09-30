-- 0002（P3，ADR-018）：refresh token 輪替、點數餘額快取（ADR-014 對帳）、資料庫角色（RLS 需非擁有者角色）

-- Refresh token：只存雜湊；同一登入串為一個 family，重用已輪替的 token → 撤銷整個 family
CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by uuid REFERENCES refresh_tokens(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens(family_id);

-- 餘額快取：只在寫帳本的同一交易內更新；以帳本為準，對帳工作比對（容差 0），不一致 → frozen
CREATE TABLE credit_balances (
  org_id uuid PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  balance int NOT NULL DEFAULT 0 CHECK (balance >= 0),
  frozen boolean NOT NULL DEFAULT false,
  frozen_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 角色：應用程式連線用 interiorai_app（受 RLS 約束）；維運工作（僵屍回收、對帳）用 interiorai_system（BYPASSRLS）。
-- 兩者皆 NOLOGIN；部署時另建 LOGIN 角色並 GRANT 成員資格（見 services/api/README.md）。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'interiorai_app') THEN
    CREATE ROLE interiorai_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'interiorai_system') THEN
    CREATE ROLE interiorai_system NOLOGIN BYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO interiorai_app, interiorai_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO interiorai_app, interiorai_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO interiorai_app, interiorai_system;
-- 之後的遷移建立的表也自動授權（遷移由同一擁有者角色執行）
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO interiorai_app, interiorai_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO interiorai_app, interiorai_system;
-- 遷移紀錄表不屬於應用程式
DO $$ BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    REVOKE ALL ON schema_migrations FROM interiorai_app, interiorai_system;
  END IF;
END $$;
-- 帳本 append-only：權限層也拿掉 UPDATE/DELETE（trigger 為第二道防線）
REVOKE UPDATE, DELETE ON credit_ledger FROM interiorai_app, interiorai_system;
