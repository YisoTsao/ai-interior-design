# 07 資產管線與目錄

## 1. 目錄 Schema（`catalog_assets`，見 schema.sql）
`id, slug, name_zh, name_en, category, subcategory, tags[], style_tags[], brand?, dims_mm{w,d,h}, anchor(floor|wall|ceiling), model_url, lod1_url?, thumb_url, material_slots[{name,mesh,swappable}], parametric?{type,params_schema}, license{type,source,allowed_use[],attribution?}, status(draft|review|published|retired), created_by, created_at`

## 2. 匯入管線（CLI：`pnpm catalog ingest <path>`）
```
來源檔(.glb/.gltf/.fbx/.obj)
 → 轉 glTF（若非 glb）
 → gltf-validator（有 error 即拒）
 → 尺度/原點檢查（單位 m、原點底部中心、正面 +Z；bbox 與 dims 誤差 ≤ 2%）
 → 最佳化：去重頂點、合併材質、Draco 或 Meshopt、貼圖縮到 ≤2048 → KTX2（ETC1S/UASTC）
 → 產生 LOD1（≤5k 三角形）與縮圖（正面等角 512×512 webp，統一光照/背景）
 → 授權欄位檢查（缺則 status=draft，不得 published）
 → 寫入 catalog + 上傳 S3
```
工具：`@gltf-transform/cli`、`gltf-validator`、`meshoptimizer`、`toktx`（KTX-Software）。

## 3. 參數化模組（減少單品依賴，優先做）
| 模組 | 參數 | 實作 |
|---|---|---|
| 門 | 寬/高/厚/開向/門框 | 程式生成 geometry（core-geometry 或 viewer-3d） |
| 窗 | 寬/高/窗台高/分割 | 同上 |
| 系統櫃/衣櫃 | 寬/深/高/門片數/層板 | 由規則生成盒體+把手 |
| 廚具（一字/L型） | 段數/寬/檯面材質 | 模組拼接 |
| 踢腳板/天花線板 | 長度/斷面 | 擠出 |
參數 Schema 存 `parametric.params_schema`（JSON Schema），UI 自動生成表單；BOM 以參數計價。

## 4. 種子資產清單（MVP ≥ 300 件，含參數化模組）
客廳（沙發/茶几/電視櫃/單椅/邊几/地毯/書櫃）、餐廳（餐桌/餐椅/餐邊櫃）、臥室（雙人床/單人床/床頭櫃/衣櫃/梳妝台）、廚房（廚具模組/冰箱/餐桌島台）、衛浴（馬桶/洗手台/淋浴間/浴缸/鏡櫃）、辦公（辦公桌/椅/書架）、玄關（鞋櫃/穿鏡）、燈具（吊燈/立燈/嵌燈/壁燈）、裝飾（植物/畫/窗簾/抱枕）、門窗牆面材質（地板/磁磚/塗料/壁紙）。
**來源優先序**：自產參數化 > CC0 授權素材（逐件記錄來源與授權）> 與廠商合作授權 > 使用者上傳（審核）。**未確認可商用者不得 published。**

## 5. 材質庫
PBR 貼圖組（baseColor/normal/roughness/AO），附真實尺寸（cm）與重複策略；分類：地板（木/磚/石/水泥/塑膠）、牆面（漆/壁紙/磚/石）、天花、布料、金屬、玻璃。色彩以 sRGB，法線 OpenGL 約定統一。

## 6. 品質檢查表（DoD）
- gltf-validator 0 error；尺寸誤差 ≤ 2%；原點/朝向正確；面數/貼圖在預算；縮圖一致；授權完整；命名符合規則；在 3D 檢視器與 G-buffer 輸出中渲染無破面/翻轉法線。
- 自動化：`pnpm catalog check` 掃描所有資產並輸出報告，CI 阻擋不合格資產。
