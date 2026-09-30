# InteriorAI

InteriorAI 是以可編輯 Scene Graph 為核心的 AI 室內設計平台：2D 平面編輯、3D 等角剖面模型（日光／夜間物理光線）、家具資產庫與 3D 模型上傳、AI 渲染、平面圖辨識。專案採 pnpm workspace＋Turborepo。

> **目前進度：P0–P5 完成，P6（AI 助理＋BOM＋匯出）進行中。** 狀態以 [`docs/PROGRESS.md`](docs/PROGRESS.md)、[`docs/backlog.md`](docs/backlog.md) 為準；前台還缺什麼見 [`docs/specs/11-frontend-requirements.md`](docs/specs/11-frontend-requirements.md)。

## 目錄

1. [五分鐘跑起來（只跑前端）](#1-五分鐘跑起來只跑前端)
2. [完整後端一起跑（登入、雲端儲存、AI 渲染、平面圖辨識）](#2-完整後端一起跑)
3. [專案結構](#3-專案結構)
4. [常用指令](#4-常用指令)
5. [如何 Debug](#5-如何-debug)
6. [功能速覽與操作](#6-功能速覽與操作)
7. [測試與品質檢查](#7-測試與品質檢查)
8. [常見問題](#8-常見問題)
9. [文件索引](#9-文件索引)

---

## 1. 五分鐘跑起來（只跑前端）

前端編輯器**不需要**資料庫、API 或任何金鑰：專案存在瀏覽器 IndexedDB，AI 渲染與登入按鈕在沒有後端時會提示無法連線，其他功能都能用。

### 需求

| 工具 | 版本 | 確認指令 |
|---|---|---|
| Node.js | ≥ 22（開發基準 24.14） | `node --version` |
| pnpm | 9.15.9（由 `packageManager` 鎖定） | `corepack pnpm --version` |
| 瀏覽器 | 支援 WebGL2 的 Chrome／Edge／Safari 17+ | — |

第一次使用 pnpm：`corepack enable && corepack prepare pnpm@9.15.9 --activate`

> **Apple Silicon 注意**：若 `node -p process.arch` 顯示 `x64`，代表 Node 跑在 Rosetta，建置、測試與 E2E 會慢 2–15 倍。建議改裝 arm64 版 Node（見[常見問題](#8-常見問題)）。

### 步驟

```sh
pnpm install --frozen-lockfile
# 核心套件（scene-schema、core-geometry、app-state、catalog…）要先編譯出 dist
pnpm exec turbo run build --filter='@interiorai/web^...'
pnpm --filter @interiorai/web dev
```

打開終端機顯示的 `Local` 網址（預設 <http://localhost:5173>），點「從範例開始」→ 右上 `3D` 切換到立體檢視。

> 改了 `packages/scene-schema`、`core-geometry`、`app-state`、`catalog`、`image-ops`、`api-client`、`assistant` 的程式碼後，要重新 `pnpm --filter <套件> build`（或 `pnpm --filter <套件> exec tsc -p tsconfig.build.json --watch` 開 watch）Vite 才會看到。`editor-2d`、`viewer-3d` 是原始碼套件，存檔即熱更新。

---

## 2. 完整後端一起跑

需要 Docker（Postgres 16、Redis 7、MinIO）。AI 供應商預設是 **mock**，不需要任何雲端金鑰。

```sh
# 1) 基礎服務
docker compose up -d postgres redis minio

# 2) API（NestJS，http://localhost:3000/v1）
pnpm --filter @interiorai/api build
MIGRATION_DATABASE_URL=postgres://app:app@localhost:5432/interiorai pnpm --filter @interiorai/api migrate
pnpm --filter @interiorai/api seed          # 把 packages/catalog 的種子資產寫進資料庫
pnpm --filter @interiorai/api start

# 3) Worker（BullMQ：渲染、平面圖匯入 Job）— 另開終端機
pnpm --filter @interiorai/worker build && pnpm --filter @interiorai/worker start

# 4)（選用）平面圖辨識 cv-service（Python 3.11+）
cd services/cv-service
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --port 8100 --reload
#   或：docker compose --profile cv up -d cv-service

# 5) 前端指向本機 API（預設就是 http://localhost:3000/v1）
pnpm --filter @interiorai/web dev
```

| 服務 | 位址 | 帳密／備註 |
|---|---|---|
| Web（Vite） | http://localhost:5173 | — |
| API | http://localhost:3000/v1 | 健康檢查 `GET /v1/healthz` |
| Postgres | localhost:5432 | 遷移擁有者 `app/app`；API 以 `interiorai_app_login` 連線（migrate 會建立） |
| MinIO Console | http://localhost:9001 | `minio / minio12345` |
| cv-service | http://localhost:8100 | `POST /v1/parse` |

### 環境變數

開發模式下 API 所有連線都有預設值（見 `services/api/src/config.ts`），**不需要 `.env`**；API 不會自動讀 `.env` 檔，要覆寫請在指令前加變數或用 `export`。`NODE_ENV=production` 時所有值都必須明確提供。

| 變數 | 用途 | 開發預設 |
|---|---|---|
| `VITE_API_URL` | 前端 build 時注入的 API 位址 | `http://localhost:3000/v1` |
| `PORT` | API 埠 | `3000` |
| `DATABASE_URL` / `SYSTEM_DATABASE_URL` | 應用（受 RLS）／維運（BYPASSRLS）連線 | 見 config.ts |
| `REDIS_URL` | BullMQ | `redis://localhost:6379` |
| `S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY` | 物件儲存 | MinIO 預設 |
| `AI_PROVIDER` | `mock`／`openai`／`flux` | `mock` |
| `OPENAI_API_KEY`、`BFL_API_KEY` | 只在真實供應商驗證時使用，**不可提交、不可進前端 bundle** | — |
| `CV_SERVICE_URL` | 平面圖辨識服務 | `http://localhost:8100` |

`.env.example` 列出上述變數，可複製成 `.env` 後用 `set -a; source .env; set +a` 載入目前的 shell。

---

## 3. 專案結構

```text
apps/web                 React 19 + Vite 8 + Tailwind 4：頁面、面板（遊戲 HUD 風格）、i18n
packages/scene-schema    Scene Graph 型別（Zod）＋ JSON Schema ＋ migration（目前 v1.1.0）
packages/core-geometry   牆體／開口幾何、房間偵測、碰撞、面積、BOM（純函式，禁止依賴 three/DOM）
packages/app-state       Zustand store、Command（可 Undo/Redo）、IndexedDB 自動儲存、自動點綴
packages/catalog         資產目錄（~100 件參數化家具／燈具）、材質、光源規格、授權檢查
packages/editor-2d       Konva 2D 平面編輯器
packages/viewer-3d       React Three Fiber 3D 檢視器：剖面模型、物理燈光、後處理、GLB 載入、縮圖、G-buffer
packages/api-client      由 OpenAPI 產生的前端型別與 client
packages/assistant       AI 助理工具定義與 mock（P6）
packages/image-ops       影像處理（渲染驗證用）
services/api             NestJS API（Auth、專案版本、上傳、Job、點數帳本、渲染、平面圖匯入）
services/worker          BullMQ worker
services/cv-service      Python 平面圖辨識（DXF／點陣）
e2e/                     Playwright 端對端測試（需要 Docker：會自動起測試用後端）
docs/                    PRD、規格、ADR、進度、backlog
```

資料流：**Scene Graph 是唯一事實來源**。所有持久變更都經由 `app-state` 的 Command（`store.exec(cmd)`），2D、3D、屬性面板都只是 Scene 的投影；選取、工具、相機、畫質等 UI 狀態不進 Scene。長度一律整數 mm。

---

## 4. 常用指令

都在 repository 根目錄執行。

| 指令 | 用途 |
|---|---|
| `pnpm --filter @interiorai/web dev` | 前端開發伺服器（HMR） |
| `pnpm --filter @interiorai/web build && pnpm --filter @interiorai/web preview` | 建置後在 :4173 預覽（最接近正式環境） |
| `pnpm lint` | ESLint（警告視為錯誤；含 i18n 字串檢查） |
| `pnpm typecheck` / `pnpm test` / `pnpm build` | 全 workspace 型別檢查／單元測試／建置 |
| `pnpm --filter @interiorai/viewer-3d test` | 只跑單一套件測試 |
| `pnpm test:integration`、`pnpm test:contract` | API 整合／契約測試（需要 Docker） |
| `pnpm test:e2e` | Playwright E2E（需要 Docker） |
| `pnpm licenses:check` | 套件與資產授權檢查 |
| `pnpm catalog check` | 資產目錄 schema／授權檢查 |
| `pnpm format` | Prettier |

---

## 5. 如何 Debug

### 5.1 VS Code 一鍵除錯

`.vscode/launch.json` 已提供下列設定（`執行與偵錯` 面板選擇即可）：

| 設定 | 做什麼 |
|---|---|
| **Web: Chrome（Vite dev）** | 先自己跑 `pnpm --filter @interiorai/web dev`，再用這個開 Chrome；可在 `.tsx`／`packages/*/src` 直接下中斷點 |
| **API: 啟動並除錯** | 以 `--inspect` 跑已建置的 API（先 `pnpm --filter @interiorai/api build`），中斷點下在 `services/api/src` |
| **API: 附加到 9229** | 附加到自行以 `node --inspect dist/main.js` 啟動的 API／worker |
| **Vitest: 目前檔案** | 對正在編輯的測試檔跑 vitest 並可停在中斷點 |
| **Playwright: 目前檔案（除錯模式）** | 以 `PWDEBUG=1` 開啟 Playwright Inspector 逐步執行 |

### 5.2 瀏覽器端

- **測試鉤子 `window.__editor`**（進入編輯器後可在 DevTools Console 使用）：

  ```js
  const ed = window.__editor;
  ed.store.getState().scene                 // 目前的 Scene Graph（JSON）
  ed.store.getState().selection             // 選取中的 id
  ed.store.getState().history.past.map(h => h.label)   // 復原歷史
  ed.viewer3d().info()                      // draw calls、三角形、GPU 資源數
  ed.viewer3d().lights()                    // 夜間光源池、陰影數、窗戶亮度、間接光強度
  await ed.viewer3d().bench(4000)           // 旋轉 4 秒量 FPS
  ed.viewer3d().viewPreset('iso-nw')        // 切視角
  ed.viewer3d().screenshot()                // 目前畫面（含後處理）的 PNG dataURL
  ed.viewer3d().gbuffer({ width: 512, height: 384, clay: true })  // AI 渲染用的 G-buffer
  ed.plan2d().worldToClient([1000, 2000])   // 2D 世界座標 → 螢幕座標
  await ed.flush()                          // 立即存檔
  ```

- **React DevTools**：看元件 props／狀態；Zustand store 以 `__editor.store` 直接讀最快。
- **3D 場景**：安裝 Chrome 擴充「Three.js DevTools」或在 Console 用 `ed.viewer3d().info()`；畫面全黑或閃爍時，先把畫質切到「效能」、關掉光暈／體積光束（右側面板未選取任何物件時的「畫質」分節）縮小範圍。HDR 後處理中任何 NaN 會被光暈擴散到整個畫面——新增 shader 時務必避開 0 長度 normalize 與負底數 `pow`。
- **本機資料**：DevTools → Application → IndexedDB：`interiorai`／`projects`（專案）、`interiorai-assets`（上傳的 3D 模型）；`localStorage` 存偏好（`viewStyle`、`lighting`、`graphics`、`lang`、單位）。清掉即重置。
- **Vite**：`pnpm --filter @interiorai/web dev -- --debug` 顯示模組解析細節；「無法解析 `@interiorai/*`」通常是核心套件沒 build（見第 1 節）。

### 5.3 後端

- API 結構化日誌輸出在 stdout（`log.info('api.listening', …)`）；開發模式會以 OpenAPI 驗證**回應**，不符契約直接回 500，看日誌裡的 `path` 找欄位。
- `node --inspect=9229 services/api/dist/main.js` 後用 VS Code「API: 附加到 9229」或 Chrome `chrome://inspect`。
- Job 卡住：`docker compose exec redis redis-cli KEYS 'bull:*'`；資料：`docker compose exec postgres psql -U app interiorai`。
- 上傳的檔案：MinIO Console <http://localhost:9001>。

### 5.4 cv-service（Python）

```sh
cd services/cv-service
.venv/bin/python -m pytest -q -k dxf            # 只跑某類測試
.venv/bin/python -m eval.debug 1 filled out.png # 把辨識結果疊到圖上（GT 綠、預測紅/藍/洋紅）
.venv/bin/python -m debugpy --listen 5678 -m uvicorn app.main:app --port 8100   # 再用 VS Code 附加
```

### 5.5 測試除錯

```sh
pnpm --filter @interiorai/app-state exec vitest --ui            # Vitest UI
pnpm --filter @interiorai/viewer-3d exec vitest run -t "間接光"   # 以名稱篩選
pnpm exec playwright test e2e/lighting.spec.ts --headed         # 看得到瀏覽器
pnpm exec playwright test --ui                                  # Playwright UI 模式
pnpm exec playwright show-trace test-results/**/trace.zip       # 失敗時自動保留 trace
```

E2E 截圖存在 `e2e/results/*.png`（剖面模型、夜間光線的對照圖）。

---

## 6. 功能速覽與操作

**編輯器版面**（遊戲 HUD 風格）：左＝建造面板（工具快捷列、圖層、資產庫／物件清單），中＝2D 藍圖或 3D 視埠（左上浮動 HUD：視角、截圖、軟裝、風格、光線），右＝屬性面板，底＝狀態列。

| 功能 | 操作 |
|---|---|
| 畫牆／房間／門窗 | 左側工具列（V 選取、W 畫牆、D 門、N 窗、空白鍵平移） |
| 放家具 | 資產庫點選後在 2D 點擊，或拖進 2D 畫布；卡片縮圖為即時 3D 渲染 |
| 3D 移動／旋轉／縮放 | 選取後 G／R／S，或屬性面板輸入數值 |
| **任何物件的細部屬性** | 選取後右側面板：變換、參數、外觀（顏色、粗糙度、金屬度、不透明度、陰影、隱藏）、材質 |
| **燈光** | 選燈具 →「光源」分節：開關、光通量（lm）、色溫（K）、RGB 光色、光束角、邊緣柔化、俯仰／水平角、陰影與柔和度、衰減距離；即時顯示 cd、2 m 照度、估計耗電；3D 中顯示光束示意 |
| **牆** | 長度、厚度、個別牆高、踢腳板、A/B 面顏色、粗糙度、陰影、隱藏、材質 |
| **門窗／房間** | 門片／窗框顏色、玻璃不透明度；地板與天花染色、粗糙度 |
| **環境與曝光** | 不選任何物件時右側面板：夜空亮度（無月／滿月／城市／藍調時刻）、曝光 EV、間接光倍率、太陽方位／仰角／強度 |
| **畫質** | 同上：效能／平衡／極致、AO、光暈、體積光束、調色暗角（存在本機偏好） |
| **上傳 3D 模型** | 資產庫搜尋框旁的上傳鈕：GLB／自含式 glTF，選單位、分類、放置方式 → 加入「我的上傳」 |
| 隱藏／鎖定 | 物件清單每列的眼睛／鎖頭；H 隱藏選取物件 |
| 截圖 | 3D HUD 相機鈕（含後處理的 PNG） |
| 快捷鍵 | Tab 2D/3D、F 全景、Ctrl/Cmd+Z/Y 復原重做、Ctrl/Cmd+D 複製、Delete 刪除、Esc 取消 |

夜間光線的物理模型見 [ADR-021](docs/adr/ADR-021-night-lighting-fixtures.md)、[ADR-023](docs/adr/ADR-023-properties-physical-night-game-ui.md)：燈具以 lm→cd 換算為真實光源；窗戶在夜間是「看得到夜空的開口」（亮度＝天空亮度，城市光害約 0.5 cd/m²），不再是發光板；間接光依全部燈具光通量以積分球公式估算。

---

## 7. 測試與品質檢查

提交前建議依序：

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e           # 需要 Docker
pnpm licenses:check
```

Git pre-commit hook 會跑 `pnpm lint` 與 Prettier 檢查。新增面向使用者的文字要同時加到 `apps/web/src/locales/zh-TW.json` 與 `en.json`（有測試檢查鍵一致）。開發流程細節（階段、ADR、測試層級）見 [`docs/rules.md`](docs/rules.md) 與 [`docs/PROGRESS.md`](docs/PROGRESS.md)。

---

## 8. 常見問題

**Vite 顯示無法解析 `@interiorai/*`**：核心套件還沒有 `dist`。執行 `pnpm exec turbo run build --filter='@interiorai/web^...'`。

**改了 schema／幾何程式碼但畫面沒變**：這些套件要重新 build（或開 `tsc --watch`），見第 1 節。

**3D 很慢、E2E 首次載入 30 秒以上（Apple Silicon）**：Node 是 x86_64 版、終端機跑在 Rosetta。`node -p process.arch` 應為 `arm64`。以 nvm 重新安裝 arm64 版 Node，並關閉終端機 App 的「使用 Rosetta 開啟」。E2E 設定在 Rosetta 下會改用 `tools/chrome-arm64.sh` 啟動原生 Chrome 作為暫時解法。

**3D 畫面全黑**：先確認 WebGL2（<https://get.webgl.org/webgl2/>）。再把畫質切到「效能」並關閉光暈／體積光束；若因此恢復，是後處理管線中有無效數值，見 5.2。

**開發伺服器不是 5173**：port 被占用時 Vite 會換下一個，以終端機的 `Local` 網址為準。

**專案存在哪裡？**：未登入時存在該瀏覽器的 IndexedDB；登入並連上 API 後渲染前會自動存雲端版本。上傳的 3D 模型目前只存在本機瀏覽器。

**`pnpm test:e2e` 失敗在 webServer**：E2E 會用 Testcontainers 起真實後端，需要 Docker 在執行中，**也需要 cv-service 的 Python venv**（`services/cv-service/.venv`，建立方式見第 2 節步驟 4）；缺少時會出現 `spawn …/.venv/bin/uvicorn ENOENT`。只想跑前端相關 spec 時，可暫時用只啟動 Web 的設定：

```ts
// playwright.web-only.config.ts（不要提交）
import base from './playwright.config';
export default { ...base, webServer: [(base.webServer as any[])[1]] };
```

```sh
pnpm exec playwright test -c playwright.web-only.config.ts e2e/editor.spec.ts e2e/lighting.spec.ts e2e/properties.spec.ts
```

---

## 9. 文件索引

| 文件 | 說明 |
|---|---|
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | Phase 狀態、Gate、量測、阻礙與決策 |
| [`docs/backlog.md`](docs/backlog.md) | Epic／Story 與需求對照 |
| [`docs/specs/11-frontend-requirements.md`](docs/specs/11-frontend-requirements.md) | **前台需求規格書 v2：對標市面平台的功能缺口與驗收** |
| [`docs/specs/01-prd.md`](docs/specs/01-prd.md) | 產品目標與功能需求 |
| [`docs/specs/02-ux-spec.md`](docs/specs/02-ux-spec.md) | UX 流程與互動 |
| [`docs/specs/03-frontend-design.md`](docs/specs/03-frontend-design.md) | 前端架構、狀態、幾何、測試 |
| [`docs/specs/04-backend-design.md`](docs/specs/04-backend-design.md) | 後端 API、Job、點數帳本 |
| [`docs/specs/openapi.yaml`](docs/specs/openapi.yaml) | API 契約 |
| [`docs/adr/`](docs/adr/) | 架構決策紀錄 |
| [`services/api/README.md`](services/api/README.md)、[`services/cv-service/README.md`](services/cv-service/README.md) | 服務細節 |
