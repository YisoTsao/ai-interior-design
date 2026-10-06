# ADR-017 3D 視圖「等角建築剖面模型」風格（viewStyle 開關）
狀態：接受
日期：2026-09-30
背景：P2 的 3D 視圖是平塗、純色背景、無陰影的簡易呈現。使用者要求在 P3 前，依 isometric-dollhouse-style 規範把 3D 改成
「擺在木桌上的精緻模型」：低矮剖面牆、暖色光、柔和陰影、AO、木紋地板、木桌底座。硬性條件：只改視覺、不動資料模型，且可切回原本的簡易模式。

決策：
1. **單一開關 `viewStyle: 'simple' | 'dollhouse'`**（`Viewer3D` prop；Web 端存在使用者偏好 localStorage，預設 dollhouse）。
   切換時以 key 重建 Canvas → 兩種模式不共用 renderer 狀態；simple 的程式路徑與 P2 相同（相機、燈光、材質、牆高）。
2. **剖面牆**：`classifyWalls` 以牆兩側取樣點是否落在房間內判斷內/外牆與朝外法線（與牆方向、繞序無關）；
   `fullHeightWalls` 依相機水平方向決定只有「背對相機的外牆」保持全高，其餘降為 350 mm（含遲滯避免沿牆方向時閃爍）。
   牆幾何 `buildWallGeometry(level, wall, height)` 多一個高度參數，高於牆頂的開口略過；（牆, 高度）快取，旋轉時不重建。
   剖面牆上的門窗扇不畫（只留開口）；全高牆的窗玻璃獨立 group，用半透明材質（淡藍、opacity 0.25）。
3. **燈光/渲染**：ACES、exposure 1.1、暖色主光（#fff1dc, 2.6）＋ PCF 軟陰影（2048、radius 5，陰影相機貼合房子）、
   半球補光、RoomEnvironment→PMREM（intensity 0.4）、暖灰漸層背景、外擴 1.5 m／厚 80 mm 的倒角木紋底板。
4. **AO 用 three 內建 `GTAOPass`**（EffectComposer → GTAO → OutputPass），不引入 N8AO/postprocessing 套件：
   零新依賴、授權掃描不變；品質足以強化牆角與家具接觸陰影。
5. **互動降級**：OrbitControls 旋轉時直接 `gl.render`（跳過 AO）且不重算陰影貼圖（燈光固定、物件未動）；
   拖曳物件時跳過 AO 但照常更新陰影；靜止後回到完整品質。兩種輸出的 shader 變體事先 `compileAsync`，避免第一次旋轉卡頓。
6. **家具**：沒有 GLB 資產（07 §3 自產參數化），依規範的替代方案——圓角方塊（RoundedBoxGeometry）＋分件
   （沙發＝底座＋靠背＋扶手＋坐墊＋靠墊＋抱枕；床加被子/床尾毯/枕頭；盆栽加陶盆與葉叢）。
   主色烘進頂點色並以 `mutedColor` 壓低飽和（S≤0.2、L≥0.55）→ 莫蘭迪色調；軟裝色固定為鼠尾草綠/霧藍/米/亞麻。
   仍為每變體一個 InstancedMesh。
7. **地板材質表**：Room 沒有類型欄位 → 由名稱推斷（`roomKind`）。使用者**明確換過**的地板材質優先；仍是系統預設時才套風格材質
   （客廳/餐廳/走道＝深棕木、臥室＝淺木、衛浴＝白磁磚、廚房＝淺磁磚）。風格材質只存在 viewer，不進資產庫或 Scene。
8. **軟裝自動點綴**是**編輯動作**，不是風格：`planDecor`（app-state，純函式）＋ `autoDecorate` Command（單一 undo 步驟），
   由使用者按「自動點綴軟裝」觸發；候選位置須在房間淨地板內、不擋門（1.1 m）、不與家具重疊。

偏離 skill 規範（及理由）：
- `PCFSoftShadowMap` 在 three r186 已移除（自動退回 PCFShadowMap）；改用 `PCFShadowMap`，它在此版本支援 `shadow.radius` 柔化。
- 貼圖為程序化 CanvasTexture（無 KTX2）：目前沒有點陣貼圖資產；KTX2 管線列在 P7（與 catalog-tools 的 toktx 一起）。
- 資產庫縮圖未改為 GLB 算圖：沒有 GLB 模型；待資產管線（P7）。

後果：
- 好：零新依賴；simple 模式行為與 FPS 不變；剖面牆、材質表、家具幾何都有單元測試；E2E 覆蓋切換、視角預設、軟裝與 undo。
- 量測（M2、headless Chrome 154、200 家具＋5 房間、相機持續旋轉 4 s）：dollhouse 60.1 FPS／63 draw calls／186k 三角形；
  simple 60.0 FPS／61／20k。
- 壞/風險：靜止幀多一次 GTAO（normal＋AO＋denoise 三個 pass），高 DPR 大螢幕上靜止幀成本較高（只在停止互動後渲染一次）。
  吊燈等天花板物件在剖面模型中看起來懸空（沒有天花板）。
