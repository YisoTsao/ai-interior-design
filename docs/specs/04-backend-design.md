# 04 後端技術設計

## 1. 技術與結構
TypeScript + NestJS（或 Fastify，二選一並寫 ADR；預設 NestJS）｜PostgreSQL + Drizzle ORM（SQL-first 遷移）｜Redis + BullMQ｜S3 相容儲存（本機用 MinIO）｜OpenTelemetry。

```
services/api/src/
  modules/
    auth/ users/ orgs/ projects/ versions/ assets/ materials/
    uploads/ jobs/ renders/ plan-imports/ assistant/ billing/ shares/ audit/
  ai/                # AI Proxy：providers/ router/ prompts/ moderation/ cache/
  common/            # errors, idempotency, rate-limit, validation, logging
services/worker/     # BullMQ workers：render, plan-import, moderation, thumbnails, export
services/cv-service/ # Python FastAPI（見 06）
```
契約優先：`assets/openapi.skeleton.yaml` 為權威；由它產生前端 `ai-client` 型別與後端 DTO 驗證（openapi-typescript / zod）。

## 2. 認證與授權
- OIDC（Google/Apple/Email magic link，可用 Auth0/Keycloak/Supabase Auth 之一；預設本機以簡易 email+password 與 JWT 開發，介面抽象成 `AuthProvider`）。
- Access token（15 分）+ Refresh token（輪替、可撤銷、存 httpOnly cookie）。
- **RBAC**：組織角色 `owner / admin / editor / viewer`；資源所有權：專案屬於工作區(org) 或個人。所有查詢帶 `org_id` 條件；PostgreSQL 建議啟用 Row Level Security 作第二道防線。
- 分享連結：`shares.token`（隨機 ≥128 bit，雜湊儲存）、權限唯讀、可到期、可撤銷。

## 3. API 慣例
- 版本 `/v1`；JSON；錯誤格式 `{ code, message, details?, requestId }`。
- 分頁：cursor-based（`?cursor=&limit=`）；排序參數白名單。
- **Idempotency-Key** 標頭：所有會扣點/建立任務的 POST 必須支援，儲存於 `idempotency_keys` 24 小時。
- 樂觀鎖：專案儲存需帶 `baseVersionId`，不符回 409 並附最新版本資訊。
- 限流：每使用者/每 IP（Redis token bucket）；AI 相關端點另有每日上限（依方案）。
- 錯誤碼（節錄）：`AUTH_REQUIRED`、`FORBIDDEN`、`NOT_FOUND`、`VALIDATION_FAILED`、`VERSION_CONFLICT`、`INSUFFICIENT_CREDITS`、`RATE_LIMITED`、`UPLOAD_REJECTED`、`MODERATION_BLOCKED`、`JOB_FAILED`、`PROVIDER_UNAVAILABLE`、`SCHEMA_UNSUPPORTED`。

## 4. 主要端點（完整見 OpenAPI）
| 分類 | 端點 |
|---|---|
| Auth | `POST /auth/login|logout|refresh`、`GET /me` |
| Projects | `GET/POST /projects`、`GET/PATCH/DELETE /projects/{id}` |
| Versions | `GET /projects/{id}/versions`、`POST /projects/{id}/versions`（帶 baseVersionId）、`GET /versions/{vid}`、`POST /projects/{id}/restore/{vid}` |
| Uploads | `POST /uploads`（回預簽名 URL）、`POST /uploads/{id}/complete` |
| Plan import | `POST /plan-imports`（uploadId）、`GET /plan-imports/{id}`（狀態+Scene 草稿+信心度）|
| Assets | `GET /assets`（搜尋/篩選）、`GET /assets/{id}`、`POST /assets`（使用者上傳，進審核） |
| Renders | `POST /renders`（G-buffer uploadIds+設定，回 job）、`GET /renders/{id}`、`POST /renders/{id}/cancel`、`POST /renders/{id}/inpaint` |
| Jobs | `GET /jobs/{id}`、`GET /jobs/{id}/events`（SSE） |
| Assistant | `POST /assistant/chat`（回結構化指令，不改資料）|
| Billing | `GET /credits`、`GET /credits/ledger`、`POST /credits/checkout`、`POST /webhooks/payments` |
| Shares | `POST /projects/{id}/shares`、`DELETE /shares/{id}`、`GET /s/{token}` |
| Export | `POST /projects/{id}/exports`（格式）→ job |
| Privacy | `POST /me/export`、`DELETE /me`（含衍生資料）|

## 5. 任務（Job）狀態機
```
queued → running → (validating) → succeeded
                 ↘ failed（可重試？）→ queued（retryCount<2）
queued|running → canceled
```
- Job 欄位：`id, type, state, progress(0-100), input_ref, output_ref, cost_estimate, cost_actual, retry_count, error_code, error_message, provenance(jsonb), created_at, finished_at`。
- Worker 需具備：逾時、取消訊號、失敗退回點數、死信佇列、可水平擴充、冪等（同 job 重複執行不重複扣款）。
- 進度以 SSE 推送；SSE 斷線可用 `GET /jobs/{id}` 補。

## 6. 點數帳本（最易出錯，需完整測試）
- 表 `credit_ledger`（append-only）：`id, org_id, delta, reason(enum: purchase|reserve|settle|refund|grant|adjust), job_id?, idempotency_key?, balance_after, created_at`。
- **流程**：送出任務 → `reserve`（負數，餘額不足則 `INSUFFICIENT_CREDITS`，需交易與行鎖/序列化）→ 成功 `settle`（以實際成本調整差額）→ 失敗/取消 `refund`。
- 餘額 = 帳本加總（可快取於 `credit_balances`，但以帳本為準並有對帳工作）。
- 禁止直接 UPDATE 餘額；測試：併發送出、重複請求（同 Idempotency-Key）、失敗退款、對帳。

## 7. 儲存佈局（S3 Key）
```
uploads/{org}/{yyyy}/{mm}/{uploadId}/{filename}          # 原始上傳（平面圖/照片）
projects/{org}/{projectId}/versions/{versionId}/scene.json
projects/{org}/{projectId}/renders/{renderId}/{gbuf-*.png|out-*.png}
assets/{assetId}/{model.glb|thumb.webp|lod1.glb}
exports/{org}/{exportId}/{file}
```
- 預簽名 URL（GET 5 分鐘、PUT 10 分鐘）；儲存桶私有；生命週期規則（暫存 7 天、渲染依方案保留）；伺服端加密。

## 8. 稽核與可觀測
- `audit_log`：登入、匯出、分享、刪除、扣點、權限變更。
- 日誌結構化（JSON）+ `requestId/traceId`；OTel trace 涵蓋 API→Queue→Worker→Provider；Provider 呼叫記錄延遲、成本、錯誤碼（不記錄使用者圖片內容）。

## 9. 測試
單元（Vitest/Jest）、整合（Testcontainers：Postgres/Redis/MinIO）、契約（OpenAPI 與實作一致：schemathesis 或 dredd）、帳本併發測試、E2E（含 mock AI provider）。
