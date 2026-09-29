# 03 前端技術設計（含桌面端）

## 1. 套件職責與公開 API
| 套件 | 職責 | 依賴限制 |
|---|---|---|
| `scene-schema` | Zod schema、型別、migration、JSON Schema 產出、驗證 | 無 DOM/React/three |
| `core-geometry` | 牆輪廓、接合、開口、房間偵測、面積、吸附、BOM | 只依賴 scene-schema、clipper2 |
| `editor-2d` | Konva/Pixi 畫布、工具、選取、標註 | React、core-geometry |
| `viewer-3d` | R3F 場景、TransformControls、CSG、G-buffer | React、three、core-geometry |
| `ai-client` | 任務提交/輪詢/SSE/取消；型別來自 OpenAPI | 無 UI |
| `ui` | 設計系統元件 | React、Radix |
| `app-state` | Zustand store、Command 系統、Undo/Redo、autosave | scene-schema |

**核心介面（示意，需照此實作）**
```ts
// app-state
export interface Command { id: string; label: string; do(s: Draft<Scene>): void; }
export interface History { exec(c: Command): void; undo(): void; redo(): void; canUndo: boolean; canRedo: boolean; }
// 內部以 Immer produceWithPatches 取得 patches/inversePatches 實作 undo/redo。

// core-geometry
export function wallOutline(level: Level): Polygon[];                 // 牆體 2D 輪廓（含接合）
export function detectRooms(level: Level): Room[];                    // 由牆圖偵測封閉房間
export function snap(pt: Vec2, ctx: SnapContext): SnapResult;
export function moveWallVertex(level: Level, wallEnd: EndRef, to: Vec2): Level; // 連動
export function computeBOM(scene: Scene, catalog: Catalog): BOM;

// viewer-3d
export function exportGBuffer(opts: { scene: THREE.Scene; camera: THREE.Camera; size: [number, number] }):
  Promise<{ color: Blob; depth: Blob; normal?: Blob; edge: Blob; objectId: Blob; idMap: Record<string, string> }>;
```

## 2. 狀態架構
- **Scene（持久）**：Zustand + Immer，僅由 Command 改寫；序列化即 `scene.json`。
- **UI 狀態（暫態）**：選取、工具、相機、面板、預覽（不進歷史、不進儲存）。
- **伺服器狀態**：TanStack Query（專案、資產、任務）。
- 拖曳期間用暫態預覽（不 commit），`pointerup` 才 `history.exec`。
- 自動儲存：Scene 變更 debounce 1.5s → 本機 IndexedDB（先）→ 雲端版本（後，增量 patch）。

## 3. 渲染迴圈與效能
- R3F `frameloop="demand"`；相機/場景變動時 `invalidate()`；操作期間才連續渲染。
- 重複家具：`InstancedMesh` 或共用 geometry/material；glb 以 drei `useGLTF` + Draco/Meshopt/KTX2 loader；LOD 依螢幕占比切換。
- 資源生命週期：切換專案/卸載必須 dispose geometry/material/texture/render target（有測試以 `renderer.info` 驗證無累積）。
- 大型牆體重算使用 Web Worker（core-geometry 為純函式，可搬）。

## 4. 牆體與開口幾何演算法（必須照此）
1. 由 `walls`（中心線+厚度）用 Clipper2 對每段牆做偏移形成矩形，**聯集**得牆體 2D 輪廓（自動處理 L/T/X 接合）。
2. 輪廓（含洞）→ `THREE.Shape` + holes → `ExtrudeGeometry(height)`。
3. 開口：在牆段局部座標建立矩形切除體，用 `three-bvh-csg` 減法；若開口多，先合併切除體再一次運算；結果快取（依牆段+開口雜湊）。
4. 地板：房間多邊形 → `ShapeGeometry`；UV 依真實尺寸（mm→m）設定，貼圖 `repeat = size / textureRealSize`。
5. 天花：同地板，位於 `level.height`。
6. 移動牆頂點 → `moveWallVertex`（連動相鄰牆端點）→ 重算 `detectRooms` → 更新受影響的房間 mesh（只重建變動者）。
測試：極短牆、共線、近平行、自交、T 型接點、含 3 個以上開口的長牆。

## 5. TransformControls 整合
- 使用 drei `<TransformControls>`；`dragging-changed` 時停用 OrbitControls。
- 操作中只更新 three 物件；結束時以差異建立 `TransformObjectCommand`。
- 縮放預設等比（`scaleSnap`/鎖比例）；地面吸附：y 依 catalog `anchor`（floor/wall/ceiling）。

## 6. G-buffer 輸出（AI 渲染前置）
於離屏 `WebGLRenderTarget`，同一相機、同一尺寸依序渲染：
1. **color/clay**：場景原材質 + 簡單三點光，或全白 clay 材質（設定可選）。
2. **depth**：`scene.overrideMaterial = MeshDepthMaterial`（`RGBADepthPacking`）→ 解包並依近/遠平面正規化為 8/16-bit 灰階。
3. **normal**：`MeshNormalMaterial`。
4. **objectId**：每個物件指定唯一純色（無光照、無抗鋸齒、`NearestFilter`），輸出 `idMap`（顏色→objectId）。
5. **edge**：對 depth 與 objectId 邊界做邊緣偵測（Sobel/Canny，於 Worker 或 fragment shader）。
輸出為 PNG；注意 `preserveDrawingBuffer` 或在同一 frame 內 `readRenderTargetPixels`，避免黑圖。尺寸維持與最終渲染同比例。**測試**：固定場景/相機的 G-buffer 做快照比對（容許小誤差）。

## 7. 專案檔 `.idp`
zip：`scene.json`、`assets/`（用到的 glb/貼圖，可選內嵌）、`thumbnails/`、`manifest.json`（schemaVersion、appVersion、hash）。讀取時先驗證 schema 與 hash，再 migration。

## 8. 錯誤處理
- React Error Boundary：畫布崩潰不影響側欄，並提供「復原到上次儲存」。
- WebGL context lost：監聽 `webglcontextlost/restored`，自動重建。
- 所有非同步呼叫有逾時/取消（AbortController）。

## 9. 測試
- Vitest（純函式與 store）、Testing Library（元件）、Playwright（E2E，含畫布操作以 data-testid 與 `window.__editor` 測試鉤子輔助）、視覺回歸（截圖對比，容許門檻）、`@axe-core/playwright`（無障礙）。

## 10. 桌面端（Electron）
| 主題 | 規格 |
|---|---|
| 架構 | 主程序（main）+ preload（contextBridge 白名單）+ renderer（與 Web 同一份 app） |
| 安全 | `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、嚴格 CSP、`webSecurity` 不關、禁止任意 `shell.openExternal`（白名單網域） |
| IPC 契約 | `file:open` / `file:save` / `file:saveAs` / `file:recent` / `app:version` / `update:check|download|install` / `render:queueLocal`；所有 IPC 以 zod 驗證輸入 |
| 檔案 | 註冊 `.idp` 關聯；雙擊開啟；最近檔案；自動備份到 userData |
| 離線 | 專案本機優先；連線後與雲端以「版本雜湊」比對，衝突時顯示「保留本機/保留雲端/另存」三選項，不做靜默合併 |
| 更新 | electron-updater；簽章與公證（macOS notarization、Windows code signing）；灰度頻道 stable/beta |
| 差異化 | 本機大檔匯入（DXF）、批次渲染佇列、離線編輯 |
| 打包 | electron-builder；CI 產出 Win/macOS 安裝檔；煙霧測試啟動與開檔 |
註：Web 與桌面共用 100% 核心套件，只在 `apps/desktop` 放平台差異。
