# 08 DevOps、安全、測試、分析與營運

## 1. 環境
| 環境 | 用途 | 特點 |
|---|---|---|
| local | 開發 | `docker compose up`（Postgres/Redis/MinIO/cv-service/mock AI），無需任何金鑰即可跑完整流程 |
| ci | 測試 | 臨時容器；Testcontainers |
| staging | 驗收 | 與 prod 同架構、小規格、真實 AI 供應商但有額度上限 |
| prod | 正式 | 多可用區、備份、告警 |

## 2. CI/CD（GitHub Actions 範例見 `assets/ci/ci.yml`）
階段：install（pnpm，快取）→ lint/typecheck → unit → build → integration（Testcontainers）→ contract（OpenAPI）→ e2e（Playwright，mock AI）→ bundle 大小預算 → 授權掃描（套件+資產）→ 安全掃描（依賴/機密/容器）→ 產出 artifacts（Docker 映像、桌面安裝檔）→ 部署 staging（自動）→ prod（人工核准）。
分支：trunk-based；PR 需 1 位審查；Conventional Commits；語意化版本與 CHANGELOG 自動化。

## 3. IaC 與部署
Terraform 骨架：網路、資料庫（託管 Postgres）、Redis、物件儲存、容器服務（ECS/Cloud Run/K8s 擇一，寫 ADR）、CDN、Secret Manager、告警。CV/GPU worker 可獨立擴縮。**沒有雲端帳號時只產骨架與 README，不假裝已部署。**

## 4. 可觀測性與 SLO
- 前端：Sentry（錯誤/效能）、Web Vitals、自訂指標（FPS、G-buffer 時間）。
- 後端：OpenTelemetry（trace/metric/log）；儀表板：API 延遲/錯誤、佇列深度、任務成功率、每供應商延遲/成本/錯誤、點數對帳差異。
- SLO（〔假設〕）：API 成功率 99.5%；渲染草圖 P50 ≤ 30s、P95 ≤ 90s；任務失敗率 < 3%。
- 告警：佇列積壓、供應商錯誤率、成本異常（日成本 > 預算 120%）、帳本對帳不一致。

## 5. 備份與災難復原
Postgres PITR（保留 7–14 天）；物件儲存版本控制；每季還原演練；RPO ≤ 15 分鐘、RTO ≤ 4 小時（〔假設〕）。

## 6. 威脅模型（STRIDE 摘要）
| 資產 | 威脅 | 對策 |
|---|---|---|
| 使用者平面圖/照片 | 越權存取（I） | 租戶隔離+RLS、預簽名 URL 短效、私有桶 |
| 帳號/Token | 竊取/重放（S） | 短效 JWT、refresh 輪替、httpOnly、異常登入偵測 |
| 點數帳本 | 竄改/重複扣（T） | append-only、冪等鍵、交易與對帳 |
| AI 成本 | 濫用（D/E） | 限流、每日上限、預扣、審核 |
| 上傳檔案 | 惡意檔（T/E） | 型別白名單、沙箱解析、大小/資源限制、病毒掃描 |
| Prompt | 注入（T） | 使用者文字隔離、輸出不執行、工具輸出 Schema 驗證 |
| 分享連結 | 猜測/外流（I） | ≥128-bit token、雜湊儲存、可撤銷、到期 |
| 桌面端 | XSS→RCE（E） | contextIsolation、白名單 IPC、CSP、簽章更新 |
| 供應鏈 | 惡意依賴（T） | lockfile、掃描、最小權限 CI、簽章 |
| 第三方 AI | 資料外洩（I） | 資料最小化、合約/條款核對、可關閉 |

## 7. 隱私資料地圖與保留
| 資料 | 敏感度 | 儲存 | 保留 | 使用者控制 |
|---|---|---|---|---|
| 帳號資料 | 中 | DB | 帳號存續 | 匯出/刪除 |
| 平面圖/照片原檔 | 高 | S3（加密） | 專案存續或使用者刪除；暫存 7 天 | 刪除 |
| Scene/版本 | 中 | DB+S3 | 同專案 | 刪除 |
| 渲染輸出 | 中 | S3 | 依方案 | 刪除 |
| G-buffer | 中 | S3 | 30 天 | 自動清除 |
| 日誌 | 低-中 | 日誌系統 | 30–90 天，不含圖片內容 | — |
刪除帳號需連同衍生資料（版本、渲染、G-buffer）與第三方留存請求（若有）。台灣個資法要求與蒐集告知需法務確認。

## 8. 測試計畫（金字塔）
| 層級 | 工具 | 範圍 |
|---|---|---|
| 單元 | Vitest / pytest | core-geometry（含 property-based：fast-check）、schema、帳本、路由、驗證演算法 |
| 整合 | Testcontainers | API+DB+Queue+Storage、Worker 流程（mock provider） |
| 契約 | OpenAPI 驗證 | 前後端一致 |
| E2E | Playwright | 主流程：匯入→校正→編輯→渲染→匯出；登入；點數不足；離線（桌面） |
| 視覺回歸 | 截圖比對 | 主要畫面與 G-buffer |
| 效能 | 自訂 Playwright + tracing | FPS、載入、記憶體（規則書 B8） |
| 無障礙 | axe | 主要頁面 |
| AI 評測 | ai-eval / cv eval | 結構分數、辨識指標、助理正確率 |
| 安全 | 依賴/機密/容器掃描、基本滲透檢查清單 | 每次 CI + 每季 |
測試資料：`fixtures/scenes/*.json`（含極端幾何）、`fixtures/plans/*`（DXF、掃描、手繪）、`fixtures/gbuffers/*`。

## 9. 分析事件（Event Taxonomy）
命名 `object_action`（snake_case），共同屬性：`user_id(匿名化), org_id, project_id, app(web|desktop), version, ts`。
| 事件 | 額外屬性 |
|---|---|
| project_created | source(blank|plan|template) |
| plan_upload_started/finished | kind, duration_ms, pages |
| plan_review_completed | corrections_count, low_conf_count, duration_ms |
| scene_edited（節流） | command_type |
| asset_placed | asset_id, category |
| render_requested | route, strictness, resolution, est_credits |
| render_finished | state, validation_score, retries, cost_usd, latency_ms |
| render_regenerated / inpaint_used | — |
| assistant_message_sent / assistant_action_applied | tool |
| export_completed | format |
| credits_purchased / credits_insufficient | amount |
| share_created / share_viewed | — |
不記錄圖片內容與可識別住址；分析需遵守同意設定。

## 10. 營運 Runbook（需寫成 `docs/runbooks/*.md`）
供應商中斷（切備援/降級）、佇列積壓、帳本對帳不一致、成本暴增、資料外洩應變、使用者要求刪除資料、重大 Bug 回滾、模型/提示詞回滾。每份含：症狀、判斷、處置步驟、聯絡人、事後檢討模板。

## 11. 法務文件大綱（草稿，需法務審閱）
服務條款（AI 輸出權利歸屬、禁止用途、點數與退款）、隱私政策（蒐集目的、第三方 AI 處理、保留、使用者權利）、素材授權聲明、AI 生成內容標示政策、DMCA/侵權申訴流程。
