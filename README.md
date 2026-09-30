# InteriorAI

InteriorAI 是以可編輯 Scene Graph 為核心的室內設計工具，提供 2D 平面編輯、3D 空間檢視與家具資產管理。專案採 pnpm workspace 與 Turborepo 管理；目前可直接使用本機 Web 編輯器，專案資料儲存在瀏覽器本機，雲端 API、平面圖辨識與 AI 渲染尚未進入開發階段。

> **目前進度：P2 已完成，P3 尚未開始。** 實作狀態以 [`docs/PROGRESS.md`](docs/PROGRESS.md) 和工作項目 [`docs/backlog.md`](docs/backlog.md) 為準。規格文件描述的是目標設計，不代表功能已經完成。

## 目錄

- [功能與現況](#功能與現況)
- [技術架構](#技術架構)
- [開發環境](#開發環境)
- [快速開始](#快速開始)
- [常用指令](#常用指令)
- [功能開發流程](#功能開發流程)
- [測試與品質檢查](#測試與品質檢查)
- [資料與本機服務](#資料與本機服務)
- [文件索引](#文件索引)
- [常見問題](#常見問題)

## 功能與現況

目前 Web 編輯器包含：

- 專案清單，可建立空白專案或載入兩房一廳範例。
- 2D 編輯：繪製牆與矩形房間、放置門窗、選取與移動物件、尺寸標註、圖層切換、吸附及 Undo/Redo。
- 3D 檢視：由場景資料產生牆、地板、天花與開口，可操作家具物件及材質。
- 家具、門窗及材質資產瀏覽與搜尋。
- 繁體中文／英文介面、長度與面積單位選擇。
- 本機自動儲存與離線專案清單。

尚未完成的主要範圍：

- P3：登入、雲端專案與版本、上傳、Job Queue、點數帳本及可用 API。
- P4：AI 渲染與結構驗證。
- P5：DXF／點陣平面圖匯入、辨識與校正。
- P6：AI 助理、BOM／估價及格式匯出。
- P7 之後：桌面端、營運與上線準備。

目前介面上的平面圖上傳與 AI 渲染按鈕會標示所屬 Phase，尚不能執行完整服務流程。

## 技術架構

```text
apps/web                 React 19、Vite 8、TypeScript、Tailwind CSS
packages/scene-schema    Scene Graph 型別、Zod 驗證、migration
packages/core-geometry   牆體／開口幾何、房間偵測、碰撞與面積
packages/app-state       Zustand、Command/Undo/Redo、本機儲存與自動儲存
packages/catalog         資產目錄、參數化物件與材質
packages/editor-2d       Konva 2D 編輯器
packages/viewer-3d       React Three Fiber / Three.js 3D 檢視器
packages/catalog-tools   資產目錄檢查與命令列工具
services/api             後端規格相關的初始檔案；P3 尚未實作
docs/                    產品規格、技術設計、ADR、進度與 backlog
e2e/                     Playwright 端對端測試
fixtures/                測試用場景資料
prompts/                 AI 與平面圖流程的提示詞草稿
```

Scene Graph 是場景資料的單一來源；2D 與 3D 檢視都從同一份場景狀態衍生。長度資料使用整數毫米，顯示單位轉換只在 UI 層處理。持久場景變更經由 app-state 的 Command 歷程管理；選取、工具模式及相機等 UI 狀態不屬於場景資料。

UI 套件 `editor-2d` 與 `viewer-3d` 以 workspace 原始碼匯出；其他核心套件先編譯到 `dist` 再供相依套件使用。因此第一次啟動 Web 前需先建置 Web 所依賴的 workspace 套件，見下方步驟。

## 開發環境

- macOS、Linux 或 Windows（建議使用 macOS／Linux shell 執行下列指令）。
- Node.js `>=22`。專案進度紀錄的基準版本為 Node `24.14`。
- pnpm `9.15.9`，由根目錄 `package.json` 的 `packageManager` 欄位指定。
- Git。
- 使用 3D 編輯器時，需支援 WebGL 的現代瀏覽器；開發與 E2E 基準使用 Chrome。

確認工具版本：

```sh
node --version
corepack pnpm --version
```

如需透過 Corepack 啟用專案指定版本的 pnpm：

```sh
corepack prepare pnpm@9.15.9 --activate
```

## 快速開始

在 repository 根目錄執行：

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter='@interiorai/web...'
pnpm --filter @interiorai/web dev
```

Vite 預設會在 <http://localhost:5173> 提供 Web app。若預設 port 已被占用，Vite 會改用下一個可用 port，請以啟動輸出中的 `Local` 網址為準。

開啟後可在專案清單建立空白專案，或選擇「從範例開始」進入編輯器。範例專案可切換 2D／3D 檢視，新增牆體或從左側資產庫操作家具。Web app 不需要先啟動 API、資料庫或雲端服務；目前專案儲存是本機功能，清除瀏覽器網站資料會一併移除本機專案。

停止開發伺服器可在執行中的終端機按 `Ctrl+C`。

## 常用指令

所有命令都從 repository 根目錄執行：

| 指令                                    | 用途                                                |
| --------------------------------------- | --------------------------------------------------- |
| `pnpm --filter @interiorai/web dev`     | 啟動 Vite 開發伺服器                                |
| `pnpm --filter @interiorai/web build`   | 型別檢查並建置 Web app；需先建置 workspace 相依套件 |
| `pnpm --filter @interiorai/web preview` | 在 `4173` 預覽已建置的 Web app                      |
| `pnpm lint`                             | 對 repository 執行 ESLint，警告視為錯誤             |
| `pnpm typecheck`                        | 透過 Turborepo 執行 workspace TypeScript 型別檢查   |
| `pnpm test`                             | 透過 Turborepo 執行 workspace 單元測試              |
| `pnpm build`                            | 建置 workspace 套件與 Web app                       |
| `pnpm coverage`                         | 執行 workspace 測試並產生覆蓋率報告                 |
| `pnpm test:e2e`                         | 執行根目錄 `e2e/` 的 Playwright 測試                |
| `pnpm licenses:check`                   | 檢查 npm 套件授權與資產目錄授權資料                 |
| `pnpm format`                           | 使用 Prettier 格式化 repository 檔案                |

執行單一 workspace 的測試或型別檢查，例如：

```sh
pnpm --filter @interiorai/core-geometry test
pnpm --filter @interiorai/app-state test
pnpm --filter @interiorai/web typecheck
```

`pnpm test:e2e` 會由 Playwright 設定先建置 Web app，再透過 Vite preview 啟動 `http://localhost:4173`。本機 E2E 使用已安裝的 Chrome；CI 使用 Playwright 的 Chromium。Apple Silicon 若 Node 執行於 Rosetta，E2E 設定會使用 `tools/chrome-arm64.sh` 啟動原生 arm64 Chrome。

## 功能開發流程

1. **確認階段與需求**：先讀 [`docs/PROGRESS.md`](docs/PROGRESS.md) 和 [`docs/backlog.md`](docs/backlog.md)，確認工作項目、依賴與目前 Phase。需求細節從 [`docs/specs/`](docs/specs/) 查找。
2. **確認資料與設計決策**：涉及 Scene Graph、尺寸單位、幾何、套件邊界或跨 Phase 契約時，先查閱相關 [`docs/adr/`](docs/adr/)；若改變既有決策，新增或更新 ADR，並同步更新相關規格。
3. **在正確套件實作**：場景 schema 放在 `scene-schema`；幾何純函式放在 `core-geometry`；場景狀態和可復原命令放在 `app-state`；畫布與互動分別放在 `editor-2d`、`viewer-3d`；頁面組合與瀏覽器互動放在 `apps/web`。避免在 UI 元件重複實作幾何或直接繞過場景狀態管理。
4. **同步在地化與素材授權**：面向使用者的文字同時更新 `apps/web/src/locales/zh-TW.json` 和 `apps/web/src/locales/en.json`。新增資產時依照 [`docs/licenses.md`](docs/licenses.md) 登記來源和授權。
5. **加入同層測試**：純資料／幾何／狀態邏輯放在對應 package 的 `test/`；元件測試放在 Web app 測試目錄；跨畫面操作放在根目錄 `e2e/`。測試需驗證可觀察行為，不只測試實作細節。
6. **由快到廣驗證**：先跑受影響 package 的測試或型別檢查，再跑 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`；變更使用者流程、畫布操作、無障礙或跨瀏覽器行為時，再跑 `pnpm test:e2e`。涉及授權或目錄資料時加跑 `pnpm licenses:check`。
7. **同步專案追蹤文件**：完成 backlog 工作後更新 `docs/backlog.md` 與 `docs/PROGRESS.md`，記錄 Gate 結果、量測環境、受阻事項和未達標指標。不要只因 mock 測試通過，就宣稱真實 AI／CV 品質或成本已校準。

Git pre-commit hook 會執行 `pnpm lint`，並檢查 `packages/`、`apps/` 下的 TypeScript、TSX 與 JSON 檔案格式。

## 測試與品質檢查

專案使用 Vitest 執行套件與 Web 單元測試、Testing Library 測試 React 元件，並以 Playwright 覆蓋主要編輯器流程。幾何核心也使用 `fast-check` 驗證性質；端對端測試包含 `@axe-core/playwright` 無障礙檢查與效能量測。

提交前的建議檢查：

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm licenses:check
```

完整 P2 Gate 及已量測項目請查看 [`docs/PROGRESS.md`](docs/PROGRESS.md)。效能數據必須連同硬體、瀏覽器與測試條件解讀；開發機的數值不等同正式基準機結果。

## 資料與本機服務

- 樣本場景位於 `fixtures/scenes/`；場景格式及 JSON Schema 位於 `packages/scene-schema/`。
- Web 專案資料目前使用瀏覽器 IndexedDB 本機儲存，不會同步到雲端。
- 根目錄 `docker-compose.yml` 描述規劃中的 PostgreSQL、Redis、MinIO 與 CV service 開發依賴；這些服務不是目前 Web 編輯器的啟動前置條件。
- 後端進度仍在 P3 之前；`services/api/` 尚未提供可供 Web app 使用的完整 API。CV service 也尚未建立，因此目前不要將 Docker Compose 視為可啟動的完整產品後端。
- AI provider、資料庫、上傳與帳務的正式設定方式，待相應 Phase 實作後再依服務文件補充；目前不需要 API 金鑰或 `.env` 才能開啟前端。

## 文件索引

| 文件                                                                         | 說明                                   |
| ---------------------------------------------------------------------------- | -------------------------------------- |
| [`docs/PROGRESS.md`](docs/PROGRESS.md)                                       | Phase 狀態、Gate、量測、阻礙與決策紀錄 |
| [`docs/backlog.md`](docs/backlog.md)                                         | Epic、Story 與需求覆蓋對照             |
| [`docs/specs/01-prd.md`](docs/specs/01-prd.md)                               | 產品目標、範圍與功能需求               |
| [`docs/specs/02-ux-spec.md`](docs/specs/02-ux-spec.md)                       | UX 流程與互動規格                      |
| [`docs/specs/03-frontend-design.md`](docs/specs/03-frontend-design.md)       | 前端套件、狀態、幾何與測試設計         |
| [`docs/specs/04-backend-design.md`](docs/specs/04-backend-design.md)         | 後端 API、認證、Job 與點數帳本設計     |
| [`docs/specs/08-devops-security-qa.md`](docs/specs/08-devops-security-qa.md) | DevOps、安全、測試及 Gate 規則         |
| [`docs/adr/`](docs/adr/)                                                     | 架構決策紀錄（ADR）                    |
| [`docs/specs/openapi.yaml`](docs/specs/openapi.yaml)                         | API 契約草稿；服務實作尚未完成         |

## 常見問題

### Vite 顯示無法解析 `@interiorai/*` 套件

初次啟動時，核心 workspace 套件可能還沒有 `dist` 輸出。先在 repository 根目錄建置 Web app 與其 workspace 相依套件，再啟動 Vite：

```sh
pnpm exec turbo run build --filter='@interiorai/web...'
pnpm --filter @interiorai/web dev
```

### 開發伺服器不是跑在 5173

若 5173 已被其他程序占用，Vite 會自動選擇下一個可用 port；使用終端機輸出的 `Local` URL。若要釋放原 port，可先停止仍在執行的 Vite 終端程序。

### 專案在哪裡保存？

目前儲存在該瀏覽器的 IndexedDB。這不是雲端備份；換瀏覽器或清除網站資料後，專案不會自動跟著移轉。
