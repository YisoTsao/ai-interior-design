# ADR-018 P3 後端基礎的實作決策與偏離
狀態：接受
日期：2026-09-30
背景：P3 依 04-backend-design 實作 Auth/專案/上傳/Job/點數。以下是規格未定或與規格不同之處。

決策：
1. **契約驅動驗證**：API 啟動時載入 `docs/specs/openapi.yaml`（＋`scene.schema.json`），以 ajv 編譯每個 operation。
   請求本文/查詢參數/Idempotency-Key 直接依契約驗證；公開端點由 `security: []` 決定；需要 Idempotency-Key 的端點由契約參數決定。
   開發/測試時回應也依契約驗證（不符 → 500）。每個 operation 加 `x-phase`，契約測試要求「x-phase ≤ 目前 Phase 的全部已實作、沒有契約外路由、每個 operation 至少被呼叫一次且回應合約」。
   以此取代 schemathesis/dredd（不需 Python 執行環境、錯誤訊息直接指到 operation）。
2. **新增兩張表**（migration 0002，`db/schema.sql` 同步）：`refresh_tokens`（只存雜湊、family 輪替與竊用偵測）、`credit_balances`（餘額快取＋`frozen`，ADR-014 對帳凍結用）。
   新增錯誤碼 `CONFLICT`（409，一般衝突）、`CREDITS_FROZEN`（423）、`INTERNAL`（500）。
3. **資料庫角色**：`interiorai_app`（NOLOGIN，受 RLS）與 `interiorai_system`（NOLOGIN、BYPASSRLS，只給僵屍回收與對帳）。部署時建 LOGIN 角色加入群組。
   帳本在權限層也 REVOKE UPDATE/DELETE（trigger 為第二道防線）。整合測試驗證應用角色非 superuser、非擁有者、無 BYPASSRLS。
4. **Job 狀態機偏離 04 §5**：`failed` 為終態，不再 `failed → queued`。結構驗證層重試改為 `validating → running`（retry_count+1）。
   理由：failed 時已退款，若復活會出現同一 Job 第二次 reserve（違反 `(job_id, reason)` 唯一索引）。BullMQ attempts（3 次）只處理基礎設施失敗，業務失敗（`JobFailure`）不重試。
5. **入列在交易提交之後**：入列失敗時 Job 停在 queued，由僵屍回收（2× 逾時）標 failed 並退款。未做 outbox（v1 可接受；如需更快復原再加）。
6. **SSE 存取檢查放在 Guard**：Nest 不等待 `@Sse()` handler 就送出 200，handler 內的 404 只會變成串流事件；因此以 `JobAccessGuard` 在送出標頭前檢查。
7. **版本相同內容**：與任何既有版本內容雜湊相同時不新增版本（`UNIQUE(project_id, content_hash)`），把 current 指回該版本並回 200。
8. **套件版本**：NestJS 11（非 12，避免未驗證的大版本變更）；BullMQ 5＋ioredis 5（BullMQ 6 改為可插拔後端，API 不同）；全部 DI 以顯式 `@Inject` token，不依賴 `emitDecoratorMetadata`（Vitest 的轉譯器不輸出型別中繼資料）。
9. **MinIO 映像**：`minio/minio` 與 `quay.io/minio/minio` 已無法匿名拉取；開發與測試改用凍結的 `bitnamilegacy/minio`。正式環境用雲端 S3，不受影響；若映像消失，改用 SeaweedFS/RustFS（已確認可拉取）。
10. **密碼雜湊**：Node 內建 scrypt（N=2^15），不引入原生 argon2 依賴。

未完成／未驗證（列入 PROGRESS）：
- OIDC 供應商（只有 `AuthProvider` 介面＋本機實作）。真實金流（只有 mock checkout＋HMAC webhook）。
- 上傳病毒掃描（只有型別白名單、大小、magic bytes）→ P7。S3 伺服端加密與生命週期規則 → P7 IaC。
- OpenTelemetry trace（只有結構化 JSON 日誌＋requestId）→ P7。
- Web 端尚未接 API（登入、雲端版本）：P4 的渲染 UI 需要，屆時一起接。
