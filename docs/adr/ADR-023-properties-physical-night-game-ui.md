# ADR-023 物件屬性覆寫、物理夜間光線修正、遊戲 HUD 介面、3D 模型上傳
狀態：接受
日期：2026-09-30
背景：使用者要求（1）夜間 3D 更像遊戲畫面、光線符合物理，且「夜晚窗戶燈光太亮」；（2）任何物件都能改屬性（燈光角度、亮度等；每面牆與物件的細部屬性）；
（3）左右操作介面改為遊戲風格；（4）預設家具更多、可上傳 3D 模型。isometric-dollhouse-style skill 規定「不得改動資料模型」，
但（2）本質上需要新的持久欄位——以使用者的明確要求為準，採**全部選填、向下相容**的 schema 擴充。

決策：
1. **Scene Schema 1.1.0**（migration 1.0.0→1.1.0 只升版號）：
   - `appearance`（color、roughness、metalness、opacity、castShadow、hidden）用於牆（A 面；`appearanceB` 為 B 面）、門窗（opacity 作用在玻璃）、物件；
     房間有 `floorAppearance`／`ceilingAppearance`。只影響呈現，不影響幾何、碰撞、BOM。
   - 牆：`height`（個別牆高，≤ 樓層高且不低於牆上門窗）、`baseboard`（踢腳板高）。
   - 物件：`name`（自訂名稱）、`light`（on、lumens、kelvin、color、beamDeg、penumbra、tiltDeg、panDeg、castShadow、shadowSoftness、rangeMm）。
     優先序：`light` 覆寫 ＞ 物件參數 color/dimmer ＞ 目錄 light 規格。tilt 正值把光束往燈具正面轉。
   - 場景：`environment`（sky、exposureEv、ambient、sunAzimuthDeg、sunElevationDeg、sunIntensity）——屬於設計意圖，隨專案保存。
   - Zod 與 JSON Schema（packages/scene-schema、docs/specs）同步；api-client 型別重新產生。
   - Command：`updateWall/updateObject/updateOpening` 擴充、新增 `updateRoom`、`setEnvironment`；patch 中 `undefined` ＝ 恢復預設（刪除鍵，不留空物件）。
2. **夜間窗戶改為物理夜空**：ADR-021 把窗戶當 700 lm/m²、6500K 的面光源＋bloom 玻璃，等同白天的天光，夜間過亮。
   改為「看得到天空的開口」：面光源亮度＝天空亮度（輻射亮度沿視線不變）——無月 0.001、滿月 0.05、城市光害 0.5（預設）、藍調時刻 15 cd/m²。
   玻璃改為深色反光材質，自發光＝天空色 × 天空亮度 × 顯示比例（不再 bloom）。
3. **間接光由物理估計取代固定補光**：three.js 沒有 GI，原本以固定藍色半球光（0.22）補。改用積分球公式 E = Φρ̄ /(A(1−ρ̄))，
   Φ＝所有燈具（含未進光源池者）與窗的光通量；A、ρ̄ 以地板（ρ 0.2）、實際畫出的牆面（ρ 0.7，外牆只算室內側）計，
   開頂（無天花）與被剖掉的牆面以 ρ＝0 計（光逸散）。顏色＝光通量加權平均光色；半球光「天」側（朝上的面）在開頂時減弱、「地」側帶地板色。
4. **曝光**：夜間的 EV 補償作用在物理光源與自發光（photometricScale × 2^EV），舞台背景固定；日光作用在 toneMappingExposure。
5. **後處理（遊戲感）**：RenderPass（MSAA 4，HalfFloat）→ GTAO → OutlinePass（選取光暈）→ UnrealBloom（夜間）→ OutputPass → 調色＋暗角 ShaderPass。
   互動中只關 AO，其餘保留（畫面不跳動）。夜間窄光束（≤60°）聚光燈加假體積光束（加法混合圓錐，強度 ∝ 光通量）。
   **教訓**：HDR（HalfFloat）＋ bloom 會把單一 NaN 像素擴散成全黑畫面——自訂 shader 一律防 0 長度 normalize、負底數 pow，並夾住輸出。
6. **畫質設定**（使用者本機偏好 `graphics`，不進 Scene）：效能／平衡／極致（dpr、MSAA、各陰影貼圖尺寸、AO 解析度）、AO、光暈強度、體積光束、調色。畫質等級變更時重建 Canvas。
7. **遊戲 HUD 介面**：`.game-ui` 範圍覆寫設計 token（深色面板、金色主強調、青色次強調、斜切角），既有元件自動套用；
   2D 畫布改讀 `.game-ui` 的 token → 藍圖配色。左側：工具快捷列（hotkey 角標）、圖層 chip、物品欄式資產格（即時 3D 縮圖、分類色條、參考價）；
   右側：可收合分節（變換／參數／光源／外觀／材質），滑桿放開才提交 Command（一次拖曳＝一步 undo）；未選取時顯示環境、畫質、場景統計；
   3D 視埠左上浮動 HUD（視角、截圖、軟裝、風格、光線、視角預設、天花板）。所有既有 testid 與鍵盤／讀屏路徑保留。
8. **資產**：新增 35 種參數化類型、約 55 件品項（L 型沙發、鋼琴、壁爐〔含光源〕、洗衣機、爐台、水槽、吊櫃、淋浴間、上下舖、嬰兒床、掛畫、霓虹燈〔光源〕、蠟燭〔光源〕等）
   與 16 種材質（含 `metalness`）；目錄新增 `elevationMm`（壁掛物預設離地高），放置時由 `defaultElevation()` 決定 y。
9. **3D 模型上傳**：GLB／自含式 glTF，≤ 50 MB（〔假設〕）、面數 > 50 萬警告；解析後正規化（底部中心為原點），依使用者選的檔案單位換算尺寸（可手動改）。
   位元組與目錄項存本機 IndexedDB（`interiorai-assets`），啟動時加入目錄；viewer 以 model resolver 讀 `user-asset:<id>`。
   授權：使用者勾選聲明、`allowedUse: ['render']`、tag `user-upload`，不進公開資產庫（B5）。雲端同步待接 P3 Upload API。
10. **縮圖**：共用離屏 WebGLRenderer 以剖面模型風格即時渲染，閒置時分批產生並快取 dataURL（不預先產圖）。

後果／限制：
- 光度換算比例與 bloom 門檻仍為目視校正（ADR-021）；間接光是單一平均值，沒有空間分布（角落與遠處一樣亮）。
- GLB 物件不做 instancing，也不支援外觀換色（材質來自檔案）；大量重複放置會增加 draw call。
- 上傳模型只存在單一瀏覽器；清除網站資料即消失。
- 夜間效能：新增 MSAA 與 Outline pass；待基準機重測 FPS（`e2e/perf.spec.ts`）。
