# PROGRESS（跨 session 續作用；Claude Code 每完成一個 Story 就更新並 commit）
> 規則：開工前先讀本檔；只更新狀態，不刪歷史。狀態：☐ 未開始｜◐ 進行中｜☑ 完成｜⚠ 受阻。
> 「阻礙」表每一列須以 `| P<n> |` 開頭並含 ⚠，check_gates.py 才會計入。
> Gate 判定見 docs/adr/ADR-011：指令全綠＋產出齊全＋量測已記錄；軟性指標未達標→寫入「未達標清單」，不得調低門檻。

## 專案設定（預設值可改；改動請同步記錄理由）
- 產品名：InteriorAI｜語言：zh-TW/en｜後端框架：NestJS｜2D 引擎：Konva（ADR-010）｜AI：mock（無金鑰）
- 硬體基準（效能量測用）：Apple M1 Pro（整合 GPU）｜RAM 16 GB｜Chrome 154.0.8037.58（Playwright 驅動）｜macOS（Darwin 24.4）
  - 注意：此為開發機，不是 B8 所說的「中階筆電」；量測值只能看趨勢，定案需在基準機重測。
- P2 種子資產目標件數：30（實際 36 件 published，自產參數化）｜v1 上線目標：300（ADR-015）
- 單 Job 成本上限：見 services/api/models.yaml `budgets`
- 結構驗證門檻狀態：**未校準**（mock 通過不代表有效，ADR-012）；ai-eval mock 結果見下方 P4 量測
- 工具鏈：Node 24.14、pnpm 9.15.9（corepack）、TypeScript 6.0.3
- 最後更新：2026-09-30｜目前 Phase：P5（進行中，WIP）

## Phase 狀態
| Phase | 內容 | 狀態 | Gate 是否通過 | 備註 |
|---|---|---|---|---|
| P0 | 文件與決策 | ☑ | ☑ | check_gates P0 通過；backlog 27 個 FR 全數對應 Story |
| P1 | 骨架 + scene-schema + core-geometry | ☑ | ☑ | lint/typecheck/test/build 全綠；core-geometry 分支覆蓋 94.59%（硬性 ≥90%）；60 測試（含 fast-check） |
| P2 | 編輯器 (2D/3D/Command/資產庫) | ☑ | ☑ | `check_gates P2 --run` 全綠（lint/typecheck/test/build/test:e2e/licenses:check）；E2E 7/7；axe 無 serious/critical；107 個單元測試 |
| P3 | 後端基礎 (Auth/專案/上傳/Job/點數) | ☑ | ☑ | lint/typecheck/test/build/test:integration(39)/test:contract(4)/test:e2e(9)/licenses 全綠；帳本併發/冪等/退款/對帳測試通過；ADR-018 |
| P4 | AI 渲染 (G-buffer/Provider/Router/驗證) | ☑ | ☑ | 全部 Gate 指令綠（integration 49、contract 4、e2e 11 含真實後端 UI）；break_structure→重試→降級→退款＋JOB_FAILED、遮罩外逐位元不變皆有測試；ADR-019/020 |
| P5 | 平面圖辨識 (DXF/點陣/校正/合成資料) | ◐ | ☐ | WIP：cv-service 核心（DXF、點陣、合成、指標）已寫；尚缺 FastAPI、pytest、評測 CLI、Node plan-import、校正 UI、E2E |
| P6 | 助理 + BOM + 匯出 | ☐ | ☐ | |
| P7 | 桌面端 + 硬化 + 上線準備 | ☐ | ☐ | |
| P8 | 最終驗證與交付 | ☐ | ☐ | |

## Backlog 勾選
以 `docs/backlog.md` 為準（已勾：E1 全部、E2 S2.1–S2.12、E3 S3.1–S3.5、E4 S4.1–S4.8、E5 S5.1–S5.10、S9.1）。

## 決策與偏離（ADR 索引 / 對 skill 預設的偏離）
- ADR-001~015 由 bootstrap 建立；ADR-010 於 P2 定案（Konva，附量測）；ADR-016 新增（牆開口改解析式，取代 ADR-003 的 CSG 部分）。
- P1：ADR-013 修訂——捨入由「0.5 遠離零」改為 Math.round（0.5 往 +∞）；fast-check 發現前者對整數平移不具不變性（奇數牆厚時房間平移後面積改變）。
- P1：TypeScript 用 6.0.x（非 7.x）：typescript-eslint 8.71 只支援 TS < 6.1。
- P1：Git hook 用 simple-git-hooks，pre-commit 直接跑 eslint + prettier --check。未用 lint-staged：本機 /usr/local/bin/git 為 2.13.1（lint-staged 需 ≥ 2.32）；Apple git 2.39.5 在 /usr/bin 但被遮蔽。
- P1：detectRooms 回傳 `{ rooms, unclosedWallIds, warnings }`（03 §1 原寫 Room[]），以符合 ADR-013 的未封閉/天井回報。
- P1：moveWallVertex / resizeWall 回傳 `EditResult { level, changedWallIds, violations }`；有 violation 時 level 不變（B3.3 阻止）。
- P1：docs/specs 重新同步自 skill（先前為首次失敗 bootstrap 的舊版副本，確認未被修改過）。
- P2：UI 套件（editor-2d、viewer-3d）採 Turborepo「原始碼套件」模式（exports 指向 src，build＝typecheck）；核心套件仍輸出 dist。
- P2：碰撞判定把高度 ≤ 30 mm 的物件（地毯）視為地面覆蓋物，不參與重疊警示。
- P2：資產庫只有 36 件，未做虛擬化列表（02 / platform skill 建議虛擬化）；件數接近 300 時需加。
- P2：TanStack Query 尚未使用（P2 沒有伺服器狀態）；P3 接 API 時導入。
- P2：CommandRejected 的訊息在 app-state 為繁中後備字串，UI 以 `error.<code>` 走 i18n。
- P2：**本機環境發現**：Node（nvm 安裝）是 x86_64 版、終端機跑在 Rosetta（`uname -m` = x86_64）。Playwright 因此以 x86_64 啟動 universal 版 Chrome，JIT 程式碼經 Rosetta 轉譯，3D 首次載入 36 s（原生 arm64 為 2.2 s）、熱迴圈慢 13 倍。
  - 處置：`tools/chrome-arm64.sh` 強制以 arm64 啟動 Chrome；playwright.config 與 bench-2d 會自動偵測並使用。
  - 影響：ADR-010 初版數據與 ADR-016 初版理由都是在 Rosetta 下得出，已更正（見兩份 ADR 的「更正紀錄」）。
  - 建議（需使用者決定）：改裝 arm64 版 Node，並把 iTerm 的「以 Rosetta 開啟」關閉；否則 Node 端測試/建置也慢 2–4 倍。
- P2：ADR-016 — 牆開口改解析式幾何（移除 three-bvh-csg / three-mesh-bvh），並更新 ADR-003 狀態。
- P2：參數化門/窗在資產庫中選取時切換為門/窗工具（以開口實體表示，不是物件）；門窗細部參數（寬高）用屬性面板修改。
- P2：catalog-tools 的 ingest 只做檢查段（validator、尺寸 ±2%、原點、面數、授權→draft/review）；轉檔、Draco/Meshopt、KTX2、LOD1、縮圖需原生工具（toktx 等），尚未實作，列 P7。
- P2：自動儲存只到 IndexedDB（本機）；雲端版本在 P3 接上。
- P2：WebGL context lost → 以 key 重建 Canvas；未做實機測試（無法在 CI 可靠觸發）。
- P3：ADR-018——OpenAPI 契約驅動驗證（請求/回應/冪等/公開端點皆由契約決定，`x-phase` 標階段）；新增 `refresh_tokens`、`credit_balances`（migration 0002）；
  DB 角色 interiorai_app（RLS）/interiorai_system（BYPASSRLS）；Job `failed` 為終態（偏離 04 §5，驗證重試走 validating→running）；
  NestJS 11、BullMQ 5；MinIO 改用 `bitnamilegacy/minio`（官方映像已無法匿名拉取）；前端型別由 OpenAPI 產生（packages/api-client，測試確保同步）。
- P3：Web 端尚未接 API（登入/雲端版本）→ P4 渲染 UI 一起接。上傳病毒掃描、S3 SSE/生命週期、OTel → P7。
- P4：ADR-020——image-ops 共用影像套件；G-buffer 深度 8-bit；供應商以 PNG 位元組傳遞；mock 模式保留路線代號；重新投遞時沿用 retry_count；
  前端登入（記憶體 token＋refresh cookie）、渲染前自動存雲端版本快照；`pnpm test:e2e` 需要 Docker（真實後端）。
- P4：ADR-019——ai-eval 發現「結構完全保留」的 mock 在 balanced 只有 96.7% 通過（不可見的 objectId 邊界被計入）→ 參考邊緣改為 clay 可見的結構邊緣。
- P4.5（使用者要求，P5 前）：ADR-021 夜間氛圍光線（對照 images1）——燈具為物理光源（lm→cd/nit，固定光源池＋陰影預算）、自發光＋bloom、
  光滑深色木地板、依外框的圓角底座＋黃色底部光暈、灰色舞台；新增 11 種燈具＋窗簾；光線模式偏好預設 night；夜間旋轉 60 FPS。
- P4：中文額外要求→英文標準化（ChatProvider）未做，移到 P6；目前原文送出並保存。免費方案成品可見浮水印未做（只有中繼資料標示＋未通過預覽浮水印）。
- P2.5（使用者要求，P3 前）：3D 改為「等角建築剖面模型」風格（isometric-dollhouse-style），ADR-017。
  `viewStyle` 開關（預設 dollhouse，可切回 simple；simple 行為與 FPS 不變）。AO 用 three 內建 GTAOPass（無新依賴）；
  PCFSoftShadowMap 在 r186 已移除，改 PCFShadowMap＋radius；無 GLB 資產 → 圓角分件家具；「自動點綴軟裝」為可 undo 的 Command。
  E2E 新增 e2e/style.spec.ts（截圖存 e2e/results/style-*.png）；perf.spec 兩種風格都量。

## P5 續作筆記（下個 session 從這裡開始）
- 已完成：`services/cv-service`（venv：`python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`）
  - `app/model.py` PlanResult 契約＋後處理；`app/vector/dxf.py` DXF 解析——6 個合成戶型牆長誤差 0.0%、門窗全數找到
  - `app/raster/pipeline.py` 點陣管線（可替換 Segmenter、OCR 尺度、房間）；`synth/`（BSP 戶型、5 種繪圖風格、DXF 輸出）；`eval/metrics.py`、`eval/quick.py`、`eval/debug.py`
  - 點陣現況（4 戶型×5 風格，`python -m eval.quick 4`）：牆 IoU 0.615、門窗 F1 0.640、房間 IoU 0.512；OCR 尺度有讀到時誤差多 <0.3%
    （〔假設〕目標 牆 IoU ≥0.80、門窗 F1 ≥0.85 **未達標**；scan 與 cad 風格最弱）
- 待做：`app/main.py`（FastAPI /v1/parse、/healthz、上限）、pytest（DXF ≤1% 誤差 Gate）、`eval/run.py`（分風格報告＋baseline 回歸）、
  Dockerfile、Node `plan_import` job＋`/plan-imports` API＋VLM 標註（mock）、`apps/web/src/features/plan-review` 校正 UI、E2E 上傳→校正→3D；之後 P6。

## 阻礙與待人決策（⚠ 項須寫「解除條件」）
| Phase | 項目 | 已用什麼替代 | 解除條件 |
|---|---|---|---|
| P3 | OIDC 供應商整合（未驗證） | AuthProvider 介面＋本機 email/密碼 JWT | 選定 IdP（Auth0/Keycloak/Supabase）並提供測試租戶 |
| P3 | 真實金流（未驗證） | mock checkout＋HMAC 驗簽 webhook（冪等入帳） | 選定金流商（綠界/Stripe）並提供沙箱金鑰 |
| P4 | ⚠ 真實 AI 供應商呼叫與評測（未驗證） | mock provider；OpenAI/FLUX 卡片以 HTTP mock 測試；OpenAI 端點/參數已依官方文件核對（2026-09-30） | 提供 OPENAI_API_KEY / BFL_API_KEY，跑 `pnpm ai-eval run --provider openai|flux` 並完成人工評分 |
| P4 | ⚠ 結構驗證門檻校準 | 〔假設〕0.65/0.80/0.90，`calibrated: false` | 真實供應商評測集結果（見上）＋人工評分後定案 |

## 未達標清單（軟性指標未達假設目標時填寫；P8 逐項處理）
| 項目 | 假設目標 | 實測 | 改善 Task | 狀態 |
|---|---|---|---|---|
| （目前無）| | | | |

## P2 量測紀錄（e2e/perf.spec.ts；原生 arm64 Chrome 154、M1 Pro、headless；場景 5 房間 + 200 家具）
| 指標 | B8 預算〔假設〕 | 實測 | 備註 |
|---|---|---|---|
| 3D 編輯 FPS（相機持續旋轉 4 秒） | ≥ 50 | 59.9（p95 單幀 17.2 ms） | 受 60Hz 上限限制；開發機非基準機 |
| Draw calls | ≤ 300 | 61 | 家具以 InstancedMesh 每變體 1 次 |
| 三角形 | — | 20,370 | |
| 2D 拖曳（ADR-010，5000 圖元） | — | 60 FPS（Konva＋drag layer） | |
| 首次切到 3D（範例 2 房 1 廳） | — | 2.2 s | Rosetta 下為 36 s |
| 首次載入可互動、存檔時間、記憶體 | ≤3 s / ≤1 s / ≤1.5 GB | 未量測 | P7 效能硬化時補 |
| 3D 編輯 FPS — 剖面模型（ADR-017，M2） | ≥ 50（skill：60） | 60.1（p95 18.2 ms）／63 draw calls／186k 三角形 | 旋轉中跳過 AO、不重算陰影 |
| 3D 編輯 FPS — 簡易模式（ADR-017，M2） | ≥ 50 | 60.0（p95 18.4 ms）／61／20k | 與 P2 一致 |

## P3 量測紀錄
| 指標 | 實測 | 備註 |
|---|---|---|
| 併發預扣（餘額 20、30 個各扣 1） | 恰好 20 成功、10 個 INSUFFICIENT_CREDITS、餘額 0 | credit_balances 行鎖序列化 |
| 同時 4 個儲存（同 base） | 1 個 201、3 個 409 | 專案行鎖＋樂觀鎖 |
| 整合測試總時間（含 3 個容器啟動） | 約 20 s | M2、Docker 20.10 |

## P4 量測紀錄
| 指標 | 實測 | 備註 |
|---|---|---|
| ai-eval mock ok（balanced 0.80，150 次） | 通過 100%；recall P10 0.987、中位數 0.999 | ADR-019 修正前 96.7% |
| ai-eval mock ok（strict 0.90，150 次） | 通過 100% | |
| ai-eval mock break_structure（balanced，150 次） | 通過 0%；recall P10 0.389、中位數 0.441 | 與保留結構的差距 > 0.5 |
| 3D 編輯 FPS（剖面模型／簡易） | 60.1 ／ 60.2；draw calls 63／61 | P4 後重測，未退步 |
| mock 渲染端到端（1K，含上傳/驗證/存檔） | UI E2E 約 1–2 s | 真實供應商延遲未量測 |

## 假設數值定案紀錄（規則書「〔假設〕」→ 實測值）
| 項目 | 假設 | 實測 | 日期 |
|---|---|---|---|
| core-geometry 分支覆蓋 | ≥90% | 94.14% | 2026-09-30 |
（FPS/draw calls 在開發機量到，未在基準機定案，暫不改規則書數字）
