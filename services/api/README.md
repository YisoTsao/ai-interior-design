# @interiorai/api（NestJS）＋ @interiorai/worker

## 本機啟動
```bash
docker compose up -d postgres redis minio
pnpm --filter @interiorai/api build
MIGRATION_DATABASE_URL=postgres://app:app@localhost:5432/interiorai pnpm --filter @interiorai/api migrate  # 建表＋開發用登入角色
pnpm --filter @interiorai/api seed    # 以 packages/catalog 種子填資產庫
pnpm --filter @interiorai/api start   # http://localhost:3000/v1
pnpm --filter @interiorai/worker build && pnpm --filter @interiorai/worker start
```
開發預設值見 `src/config.ts`；`NODE_ENV=production` 時所有連線與密鑰都必須由環境提供。

## 資料庫角色（ADR-018）
| 角色 | 用途 | RLS |
|---|---|---|
| 遷移擁有者（例：`app`） | 只跑 migration | 表擁有者 |
| `interiorai_app` 成員（`DATABASE_URL`） | API 與 worker | 受 RLS；每個交易 `SET LOCAL app.org_id` |
| `interiorai_system` 成員（`SYSTEM_DATABASE_URL`） | 僵屍預扣回收、對帳 | BYPASSRLS |

## 測試
- `pnpm test`：單元（無外部依賴）
- `pnpm test:integration`：Testcontainers 起 Postgres/Redis/MinIO（需要 Docker）
- `pnpm test:contract`：OpenAPI ↔ 實作（契約外路由、未實作 operation、回應不符契約都會失敗）
