# 06 平面圖辨識（CV 服務）設計

## 1. 服務契約（Python FastAPI）
```
POST /v1/parse            { uploadUrl, kind: 'auto'|'vector'|'raster', hints?: { scaleMmPerPx?, unit? } }
                          → 202 { jobId }   （由 Node 端 Job 包裝，CV 服務本身可同步/非同步）
GET  /v1/parse/{jobId}    → { state, result?: PlanResult, error? }
GET  /healthz
```
`PlanResult`：符合 `scene.schema.json` 的 `levels[0]`（walls/openings/rooms）+ 每元素 `confidence(0–1)`、`source`（vector|raster）、`scale: { mmPerPx, method: 'dimension_ocr'|'user'|'dxf_units'|'unknown' }`、`warnings[]`。**scale 為 unknown 時不得回傳最終 Scene，只回草稿並要求校正**。

## 2. 向量檔路線（優先，最準）
- DXF：`ezdxf` 讀取；圖層名稱啟發式對應（`WALL|牆|A-WALL`、`DOOR|門`、`WINDOW|窗`）；無圖層規則時以線寬/顏色聚類；單位由 `$INSUNITS` 取得。
- DWG：以 LibreDWG 或 ODA 轉 DXF（**授權需確認**，ODA 需商業授權；預設要求使用者提供 DXF，或於桌面端轉檔）。
- 向量 PDF：PyMuPDF 抽取路徑；同 DXF 後續處理。
- 後處理：共線合併、端點吸附（容差 = 牆厚 × 0.5）、雙線牆→中心線+厚度。

## 3. 點陣路線
1. 前處理：EXIF 轉正、透視/旋轉校正（Hough/最大輪廓）、去噪、自適應二值化、裁切外框與圖框。
2. 語意分割：類別 `wall | door | window | room | stairs | text | background`。模型：U-Net/SegFormer 類（`segmentation_models_pytorch`），以 ONNX 匯出服務。
3. 向量化：
   - 牆：mask → 骨架化/輪廓 → Douglas-Peucker → Manhattan 吸附（主方向由 Hough 直方圖求得，容許非直角需保留）→ 合併共線 → 中心線+厚度（距離變換估計）。
   - 門窗：連通元件 → 與最近牆段匹配 → 產生 `offset/width`；開門方向由弧線偵測（可選）。
   - 房間：牆圖封閉區域（planar graph faces）→ 多邊形。
4. 尺度：OCR（PaddleOCR/Tesseract）抽取尺寸標註與坪數；以標註線兩端像素距離換算；多個估計取中位數，離散大則降信心；否則要求使用者兩點校正。
5. VLM 補語意：把圖與初步結果送 VisionProvider，讓它標房名（客廳/主臥/浴室…）、指出疑似遺漏；**VLM 只補語意標籤，不得改幾何**。Prompt 見 `assets/prompts/plan.vlm-label.md`。
6. 信心度：每元素 = 分割機率均值 × 幾何規則一致性（例如牆是否封閉、門窗是否落在牆上）。

## 4. 資料集與授權（Phase 5 前置）
- 公開資料：CubiCasa5K、ResPlan、R2V 等可用於**研究與預訓練評估**；**CubiCasa5K 模型/資料的非商用授權需在商用前處理**（取得授權或不使用）。所有資料集與模型登錄於 `docs/licenses.md`，並註明可否商用。
- 在地資料：蒐集台灣建照圖、預售屋 DM、手繪與掃描件（需有合法來源與同意）；標註規範：牆多邊形→房間→圖示（門窗）。
- **合成資料產生器**（`services/cv-service/synth/`）：從 Scene 產生戶型（隨機但合理）→ 以多種繪圖風格輸出（線寬、填色、字型、圖例、比例尺、指北針、雜訊、掃描歪斜、模糊、手繪抖動濾鏡）→ 自動得到標註。至少 5 種風格，1 萬張起。
- 訓練：先合成+公開資料預訓練 → 用在地資料微調；資料切分依「來源建案/繪圖者」避免洩漏。

## 5. 評測（`services/cv-service/eval/`）
指標：牆 IoU、門窗 precision/recall/F1、房間多邊形 IoU、尺度誤差 %、**平均校正次數（人工測）**。
報告：分風格/來源分層。回歸規則：新模型任一主要指標不得低於前一版（規則書 B6.5）。
〔假設〕MVP 目標：向量檔可用率 100%；點陣圖 牆 IoU ≥ 0.80、門窗 F1 ≥ 0.85。

## 6. 部署
- 容器化；CPU 版可服務向量與輕量點陣；GPU 版（可選）；ONNX Runtime；冷啟動時預載模型。
- 併發：Worker 端以佇列限流；單請求逾時 60s；影像大小上限（如 25MB、長邊 8000px）；PDF 頁數上限。
- 安全：檔案在沙箱/低權限容器解析；禁止解析中觸發外部網路；DWG/PDF 解析器有資源限制（記憶體/時間）。

## 7. 校正 UI 對接
`PlanResult` 中 `confidence < 0.6` 的元素在前端紅框高亮並列入「待確認」清單；使用者的每次修正以 Command 記錄，另**匿名化後**（需使用者同意）可回收為訓練資料。
