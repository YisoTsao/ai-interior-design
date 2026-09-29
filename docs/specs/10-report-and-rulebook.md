# AI 室內設計平台：市場分析報告 × 開發規則書

版本 v1.0｜2026-09-29｜範圍：Web + Desktop｜語言：繁體中文

> **閱讀方式**：第一部分是分析報告（市場、AI 結合方式、架構、功能規格、路線圖、風險）。第二部分是規則書（開發團隊必須遵守的規則，可直接當 Code Review 與 PR 的依據）。
> 標註「〔假設〕」的數字是我提出的建議值，需要以你們的實測資料驗證；標註「〔來源〕」的是搜尋到的資料。

---

# 第一部分：分析報告

## A0. 結論先行（Executive Summary）

1. **你的原始規劃方向正確，但有 4 處已過時或需修正**（見 A1）。最重要的一項：OpenAI 現在的圖像模型（gpt-image 系列）已經支援多張參考圖與遮罩編輯，「OpenAI 不適合圖生圖」這個前提不再成立；但它仍無法保證幾何結構 100% 不變，所以仍需要「結構控制」的備援路線。
2. **市場上已有三類產品**：(a) 2D/3D 規劃器（Planner 5D、Coohom、Homestyler、Foyr Neo、Floorplanner、RoomSketcher）；(b) 照片重新設計/虛擬佈置（Interior AI、REimagine Home、Spacely 等）；(c) 平面圖直接生成或轉 3D 的 AI 工具（Maket.ai、Floor Plan AI、Getfloorplan、Vizcraft）。
3. **明確的市場缺口**：**「可編輯的 3D 場景 → 結構一致的 AI 渲染」**。規劃器的渲染偏傳統（模型庫大但風格生硬），照片類 AI 工具則無法編輯幾何。你的產品應定位在兩者之間：**3D 場景是唯一事實來源（Source of Truth），AI 只是渲染與建議層**。
4. **AI 的正確用法**：不要讓 AI「猜」空間，而是讓 Three.js 輸出「乾淨的結構訊號」（clay render、深度圖、法線圖、物件 ID 遮罩、邊緣圖）餵給 AI，再用結構比對檢查 AI 有沒有把牆/門窗畫歪。
5. **最大的兩個工程風險**：(1) 平面圖辨識的準確率（尤其是台灣的建照圖、預售屋 DM、手繪圖）；(2) 家具/材質資產庫（競品的護城河是模型數量，見 A2）。
6. **建議路線**：先做「手動 2D 編輯 + 參數化 3D + 一鍵 AI 渲染」的 MVP，平面圖辨識採「AI 自動辨識 + 使用者校正」的半自動模式，而不是追求全自動。

---

## A1. 對原始規劃的修正清單

| # | 原始內容 | 問題 | 建議修正 |
|---|---|---|---|
| 1 | 「DALL-E 對 Image-to-Image 支援度較低」 | 已過時。OpenAI 官方圖像編輯端點（`/v1/images/edits`）現支援 GPT Image 系列，可傳多張參考圖與遮罩〔來源：OpenAI API 文件〕 | 改用 gpt-image-2 系列（或文件列出的更新變體，實作前以官方模型頁為準）作為「主要渲染路線」；ControlNet/FLUX 深度控制作為「嚴格結構」備援 |
| 2 | 「Inpainting 由使用者圈選沙發區域，AI 替換」 | 遮罩在 GPT Image 是「提示引導」，官方並不保證逐像素遵守邊界〔來源：API易文件轉述官方說法〕；遮罩僅套用在第一張圖，PNG < 4MB、尺寸須與原圖相同 | 遮罩從 3D 場景的**物件 ID 圖**自動產生（不靠使用者手畫），遮罩略微擴張；輸出後用原圖做「遮罩外還原」合成，確保遮罩外像素不變 |
| 3 | 「用 renderer.domElement.toDataURL() 截圖」 | 只有一張彩色圖，結構訊號不足；且需 `preserveDrawingBuffer` 或在同一 frame 內擷取，否則可能是黑圖 | 建立「離屏多通道輸出」（color / depth / normal / objectId / edge），見 A4.3 |
| 4 | 牆體只用 ExtrudeGeometry | 牆角接合、門窗開口會出問題 | 先在 2D 用多邊形偏移（Clipper2）算出牆體輪廓再擠出；開口用 CSG（three-bvh-csg）或牆段 Shape + hole |
| 5 | 後端同時寫 Fastify/Next.js 與 FastAPI | 架構圖與文字不一致 | 定案：**TypeScript 後端（NestJS 或 Fastify）負責業務/AI 代理；Python FastAPI 只做 CV 微服務**（見 A5） |
| 6 | 2D 編輯器與 3D 互相同步 JSON | 雙向同步容易產生分歧 | 單向資料流：**Scene Graph（JSON）為唯一來源**，2D 與 3D 都只是它的兩個「檢視+編輯器」，透過 Command 修改 |
| 7 | 用 YOLOv8 / CubiCasa 之類模型 | CubiCasa5K 整合在第三方專案的授權標註為 CC BY-NC（非商用），商用需向 CubiCasa 取得授權〔來源：GitHub FloorPlanAnalyzer README〕 | **商用前必須做授權盤點**；建議自建資料 + 合成資料（A4.2） |

---

## A2. 市場分析

### A2.1 競品地圖

| 類別 | 代表產品 | 已確認的 AI/核心能力 | 價格參考（各來源不一，僅供方向） |
|---|---|---|---|
| **規劃器＋渲染（專業/半專業）** | **Coohom** | 上傳 JPG/PNG/PDF/DWG/DXF 自動轉可編輯平面圖；AI 智慧佈局；AI Home Design（聊天式）；4K 渲染；雲端渲染；模型庫據稱數萬至數十萬件（各頁面數字不一致，以官方為準）。免費版限制專案數、含浮水印 | 免費；付費約 $10～$60/月（各評測不一） |
| | **Homestyler** | 雲端一體化：平面、3D、渲染、簡報；AI 輔助平面圖轉 3D；免費版有 1K 渲染 | 免費～付費（不同來源差異大） |
| | **Foyr Neo** | 瀏覽器端、平面/3D/佈置/渲染；AI 自動化、Smart Drawing；可上傳自訂貼圖 | 約 $29/月 |
| | **AiHouse** | 面向設計師/零售/櫃體廠：可編輯 3D + 產業專用 AI + 「可生產」的輸出（櫃體製造） | 洽詢 |
| **規劃器（消費者導向）** | **Planner 5D** | AI 平面圖辨識（圖片→可編輯 2D/3D）、Design Generator（依風格/情緒生成變化）、自動佈置；行動 App 強 | 免費；付費約 $7～$20/月 |
| | **Floorplanner / RoomSketcher / Cedreo** | 拖拉式 2D 編輯、即時 3D；RoomSketcher 偏 2D 平面輸出（免費版有浮水印） | RoomSketcher $49+/年 |
| **照片重設計 / 虛擬佈置** | **Interior AI、REimagine Home、Spacely AI、GenRoom、Remodel AI** | 上傳房間照片 → 換風格/佈置；不可編輯幾何 | 約 $14～$49/月 |
| **平面圖 AI 生成/轉換** | **Maket.ai**（用限制條件生成平面圖）、**Floor Plan AI**（圖→DXF、文字→平面圖、動畫）、**Getfloorplan**（AI 製作 + 人工複核，B2B 房地產）、**Vizcraft**（平面圖→等角 3D 約 10 秒） | 前端辨識/生成強，但多半「不可深度編輯」；評測指出若需要含尺寸與明細的可編輯模型仍應用 CAD/BIM | 各異 |
| **量測/掃描** | **magicplan**、Polycam/RoomPlan 類 | AR 掃描房間量尺寸 | 各異 |
| **通用建模** | **SketchUp**（業界常見）、Archicad、Live Home 3D | 建模彈性大，內建 AI 有限 | SketchUp Shop 約 $119/年 |

**可信度說明**：上述多數比較文章由廠商或聯盟行銷網站撰寫（例如某些「第一名」文章的第一名恰為其自家產品），價格與數字互相矛盾，**只能作為方向，不能作為決策依據**。正式決策前，請你的團隊實際註冊試用前 5 名，並依 A2.3 的評估表打分。

### A2.2 共通模式（值得學）與共通弱點（值得打）

**共通模式**
- 「上傳平面圖 → 可編輯 2D → 一鍵 3D」已成為標配，使用者預期 10 分鐘內看到成果。
- Freemium：免費版限制專案數、渲染解析度（1K）、浮水印；4K 與高階資產要付費。
- 商品資料庫連結：Coohom 強調真實品牌商品；MeltFlex 這類新進者強調「平面圖→3D→購買」流程。

**共通弱點（你的機會）**
1. **AI 渲染與可編輯 3D 脫節**：照片類 AI 工具生成漂亮但不能改；規劃器能改但渲染風格傳統。
2. **平面圖辨識對非標準圖失敗率高**：第三方實測專案指出多種方法（傳統 CV、YOLOv8、CubiCasa5K）都沒有做到在各種平面圖風格下穩定可靠〔來源：FloorPlanAnalyzer README〕。→ 校正 UX 是勝負關鍵。
3. **在地化不足**：坪數、台灣常見的隔間/櫃體/系統家具、繁體中文提示詞與台灣品牌規格，幾乎沒有一個國際產品做得深。
4. **資產庫成本高**：Coohom 等以大量授權模型建立門檻；新進者需要策略（見 A9）。

### A2.3 競品實測評估表（建議你們實測後填寫）

| 維度 | 權重 | Coohom | Planner 5D | Homestyler | Foyr Neo | 你的目標 |
|---|---|---|---|---|---|---|
| 平面圖辨識正確率（用 10 張台灣平面圖測） | 20% | | | | | |
| 上傳到 3D 完成的時間 | 10% | | | | | ≤ 3 分鐘 |
| 3D 編輯手感（拖曳/縮放/對齊） | 15% | | | | | |
| AI 渲染結構一致性（牆/窗有沒有跑掉） | 20% | | | | | |
| 渲染風格真實感 | 10% | | | | | |
| 資產庫覆蓋（台灣常見品項） | 10% | | | | | |
| 每張圖成本/速度 | 10% | | | | | |
| 匯出（DXF/PDF/glTF） | 5% | | | | | |

---

## A3. 產品定位與差異化

**一句話定位**：*「在可編輯的 3D 場景上，用 AI 生成與原空間結構一致的高清效果圖，並理解台灣的裝修習慣。」*

**三個差異化支柱**
1. **結構一致的 AI 渲染**（核心賣點）：3D 場景輸出深度/邊緣/ID，AI 生成後自動檢查結構偏移，不合格就重試或降級到嚴格模式。
2. **校正優先的平面圖辨識**：辨識結果附信心度；低信心區域高亮，讓使用者 3 次點擊內修好，而不是重畫。
3. **用對話操作場景**：「把沙發靠窗、電視牆改成 4 公尺」→ LLM 產生**結構化指令**（非直接改畫面），預覽後套用（見 A4.5）。

**目標客群（建議優先序）**
1. 室內設計師/工作室（提案速度、客戶溝通）→ 付費意願最高
2. 屋主/自助裝修者、預售屋/新成屋客變 → 流量大、需要簡單
3. 房仲/建案銷售（虛擬佈置、樣品屋圖）→ 可做 B2B 方案

---

## A4. AI 結合策略（核心章節）

### A4.1 五個 AI 落點

| # | 落點 | 輸入 | 輸出 | 建議技術 |
|---|---|---|---|---|
| 1 | 平面圖辨識 | 圖片/PDF/DWG | 牆/門/窗/房間 JSON + 信心度 | 分割模型 + VLM（讀文字/房名/尺寸）+ 規則式向量化 |
| 2 | AI 渲染 | 3D 場景多通道圖 + 風格描述 | 高清效果圖 | 見 A4.3 |
| 3 | 局部重繪 | 效果圖 + 物件 ID 遮罩 + 指令 | 換沙發/換地板 | GPT Image edit（遮罩）/ FLUX Fill |
| 4 | 對話式操作與設計建議 | 自然語言 + 場景摘要 + 截圖 | 結構化指令（function calling）/ 文字建議 | LLM + 工具呼叫 + Vision |
| 5 | 估價/清單生成 | Scene Graph | BOM、材料量、預算 | 純程式計算 + LLM 說明（不要讓 LLM 算數） |

### A4.2 平面圖辨識管線

```
上傳(JPG/PNG/PDF/DWG/DXF)
   │
   ├─ 向量檔(DWG/DXF/向量PDF) → 直接解析線條/圖層（最準，優先走這條）
   │
   └─ 點陣圖
        1. 前處理：轉正、去雜訊、二值化、裁切外框
        2. 語意分割：牆 / 門 / 窗 / 房間 / 樓梯 / 文字區
        3. 向量化：輪廓→折線→Douglas-Peucker 簡化→直角/平行吸附(Manhattan snap)
        4. 尺度校正：OCR 尺寸標註 / 坪數 / 讓使用者在圖上點兩點輸入實際長度
        5. VLM 補語意：房間名稱（客廳/主臥）、開門方向、陽台
        6. 輸出 Scene Graph 草稿 + 每個元素 confidence
        7. 【校正模式】低信心元素高亮 → 使用者確認/拖曳修正
```

**關鍵策略**
- **向量檔優先**：DWG/DXF 不需要 AI，準確率遠高於點陣圖；Coohom 也支援 DWG/DXF 上傳〔來源：Coohom 官網〕，這是市場預期。
- **模型選擇**：學術界已有 CubiCasa5K、ResPlan（約 17,000 筆向量圖資料集）、FloorplanVLM 等研究成果〔來源：Hugging Face Papers / arXiv〕。但**授權與地區差異**要先盤點：CubiCasa5K 為芬蘭地區資料且商用有限制；有研究採「先用公開資料預訓練、再用少量在地資料微調」的做法（例如以 500 張在地平面圖做遷移學習）〔來源：arXiv 2512.02413〕。**建議照此做法，用台灣平面圖微調。**
- **合成資料（強烈建議）**：你的編輯器本身就能產生「已知答案」的平面圖。用 Scene Graph 隨機生成戶型 → 以不同線寬、圖例、字型、掃描噪點、手繪風濾鏡輸出 → 免費得到標註。可大量擴充訓練與測試資料。
- **評估指標**：牆體 IoU、門窗 precision/recall/F1、房間多邊形重疊率（可參考開源 floorplan-eval 的指標定義）。〔假設〕MVP 目標：向量檔 100% 可用；點陣圖牆體 IoU ≥ 0.80、門窗 F1 ≥ 0.85，並以「校正次數 ≤ 5」作為體驗指標。

### A4.3 AI 渲染管線（最關鍵）

**核心原則**：3D 場景輸出**結構訊號**，AI 只負責「材質、光影、氛圍」，不負責「幾何」。

```
Three.js 場景（Scene Graph 驅動）
   │  離屏渲染（同一相機、同一解析度）
   ├─ ① Clay/Color 圖    （簡單光照的白模或帶基本材質）
   ├─ ② Depth 深度圖      （ControlNet / FLUX Depth 用）
   ├─ ③ Normal 法線圖      （可選）
   ├─ ④ Edge 邊緣圖        （由 ② 或 ObjectID 邊界計算，Canny 用）
   └─ ⑤ ObjectID 圖        （每個物件唯一顏色 → 自動產生遮罩）
        │
        ▼
   Render Router（依使用者選的「結構嚴格度」與成本決定）
        │
        ├─ 路線 A【平衡/預設】GPT Image edits
        │     image[0] = ① Clay 圖（要被轉化的主圖）
        │     image[1..] = 風格參考圖 / 材質樣本 / 家具參考
        │     prompt = 結構化模板（見 B6.3）：保留牆/門窗/家具位置，只改材質光影
        │
        ├─ 路線 B【嚴格結構】深度/邊緣控制模型（FLUX Depth/Canny、SDXL ControlNet）
        │     輸入 ② 或 ④ + prompt → 幾何幾乎不會跑掉，但風格自由度較低
        │
        └─ 路線 C【局部修改】遮罩編輯（GPT Image mask / FLUX Fill）
              遮罩 = ⑤ 依選取物件產生；輸出後做「遮罩外像素還原」合成
        │
        ▼
   後處理：超解析/放大(可選) → 結構驗證 → 存檔/浮水印
        │
        ▼
   結構驗證：把輸出圖轉邊緣圖 vs ④ 比對（如 SSIM/Chamfer 距離）
        ├─ 通過 → 交付
        └─ 不通過 → 自動重試(最多 2 次，提高嚴格度) → 仍失敗則降級路線 B
```

**為什麼要多路線**
- GPT Image 系列的優點：指令遵循、可讀多張參考圖（文件載明最多 16 張）、真實感佳。缺點：遮罩是「提示引導」不保證逐像素；不是為 CAD 級結構保持設計。
- FLUX 系列有官方的 Depth / Canny / Fill 工具與 Kontext 編輯模型；FLUX.2 系列支援多參考圖（列為最多 10 張）〔來源：Black Forest Labs 相關頁面、Replicate、第三方彙整〕。價格約每張 $0.04（Kontext Pro）或每百萬像素 $0.03～$0.045（FLUX.2 Pro）〔來源：invideo 彙整，2026-08；以官方定價為準〕。
- 也可評估 Google Gemini 圖像編輯模型、Qwen Image Edit 等（第三方 API 聚合平台已列出）；**建議在 AI Proxy 層做「模型抽象」，避免綁死單一供應商**。

**模型選型測試（上線前必做）**：準備 30 個場景（10 客廳、10 臥室、10 廚房/浴室）× 5 種風格，四種路線各跑一次，人工評分「結構一致性 / 真實感 / 風格符合度」，並記錄成本與延遲，再決定預設路線。

### A4.4 提示詞（Prompt）架構

- **由系統組合，不讓使用者直接寫**：`[空間類型] + [風格模板] + [材質指定(來自 Scene Graph)] + [光線] + [結構保留指令] + [負面限制]`
- 材質來源：Scene Graph 中每個物件都有 `material_id`，自動轉成文字（例如「北歐風淺色橡木地板、米白布沙發」），避免 AI 自由發揮造成與清單不符。
- 使用者自由文字放在「額外要求」欄位，與系統模板分開處理，避免 prompt injection 影響結構保留指令。
- 所有模板放版本庫（`prompts/`），每次生成記錄模板版本與模型版本（見規則書 B6）。

### A4.5 對話式助理（LLM + 工具呼叫）

LLM **不直接改場景**，只輸出**結構化指令**，由前端驗證後以 Command 執行（可 Undo）。

| 工具（Function） | 參數示例 | 說明 |
|---|---|---|
| `move_object` | id, position/相對位置(靠窗) | 移動 |
| `resize_wall` | wallId, newLength | 改牆長；連動牆體與地板 |
| `add_object` | catalogId, roomId, anchor | 新增家具 |
| `set_material` | targetId, materialId | 換材質 |
| `list_objects` / `get_room_info` | roomId | 查詢（回傳給 LLM 上下文） |
| `suggest_layout` | roomId, constraints | 產生 2～3 個佈局方案（預覽） |
| `check_clearance` | roomId | 動線/間距檢查（程式計算） |
| `estimate_budget` | scope | 呼叫報價引擎（程式計算） |

**規則**：任何數量、面積、金額都由程式計算，LLM 只負責解釋。

### A4.6 成本與延遲控制

| 項目 | 策略 |
|---|---|
| 生成延遲 | 一律**非同步任務**（Job Queue）＋進度串流；預覽先出 1K 草圖，確認後再出 4K |
| 成本 | 點數制（Credit）；免費版 1K + 浮水印；快取相同（場景雜湊+設定）結果；先跑低成本模型做草稿 |
| 失敗重試 | 最多 2 次；重試也計入成本上限 |
| 濫用防護 | 速率限制、每日上限、內容審核（見 B9） |

---

## A5. 系統架構

```
┌────────────────────────── Client（Web / Desktop 共用核心）───────────────────────────┐
│  packages/scene-schema   (Zod/JSON Schema, 版本化)                                   │
│  packages/core-geometry  (牆體輪廓、開口、吸附、面積計算，純 TS，可單元測試)          │
│  packages/editor-2d      (Konva/Pixi：牆繪製、標註、家具 2D、選取/吸附)               │
│  packages/viewer-3d      (React Three Fiber + drei TransformControls + CSG)          │
│  packages/ai-client      (呼叫後端 AI 任務，處理進度/取消)                             │
│  apps/web (Vite/Next)    apps/desktop (Electron 或 Tauri)                             │
└──────────────────────────────────┬───────────────────────────────────────────────────┘
                                   │ HTTPS + WebSocket/SSE（任務進度）
┌──────────────────────────────────▼───────────────────────────────────────────────────┐
│  Backend (TypeScript：NestJS/Fastify)                                                │
│   Auth｜Project API｜Asset Catalog API｜Billing/Credits｜Job Orchestrator            │
│   AI Proxy：模型抽象層(OpenAI / FLUX / Gemini…)｜Prompt Templates｜Moderation｜Cache │
├──────────────────────┬────────────────────────┬──────────────────────────────────────┤
│  PostgreSQL          │  Redis + BullMQ        │  Object Storage (S3/R2)              │
│  專案/版本/點數      │  任務佇列/限流         │  平面圖原檔、glTF、渲染輸出、G-buffer │
└──────────────────────┴───────────┬────────────┴──────────────────────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ CV Service (Python FastAPI)  │  ONNX Runtime / PyTorch
                    │ 平面圖辨識、向量化、OCR      │  可獨立擴充 GPU
                    └──────────────────────────────┘
```

**技術選型定案**

| 項目 | 建議 | 理由 |
|---|---|---|
| 前端 | React + TypeScript(strict) + Zustand + Immer | Immer patches 可直接做 Undo/Redo |
| 2D | Konva 或 Pixi.js（擇一） | 兩者皆可；Fabric.js 偏設計工具，物件多時效能與精細控制較差〔判斷〕 |
| 3D | Three.js + React Three Fiber + drei + three-bvh-csg | 官方 TransformControls、CSG 開口 |
| 幾何計算 | Clipper2（多邊形偏移/布林） | 牆角接合與房間輪廓 |
| 後端 | NestJS 或 Fastify（TS） | 與前端共用 Schema 型別 |
| CV | Python FastAPI + ONNX Runtime | 模型部署與推論優化 |
| 3D 資產格式 | glTF 2.0 (.glb) + Draco/Meshopt + KTX2 貼圖 | Web 載入體積與速度 |
| 桌面端 | 先以 **Web 為主，桌面用 Electron 包裝**；若安裝檔體積為優先再評估 Tauri | Electron 內建 Chromium，各作業系統 WebGL 行為一致；Tauri 使用系統 WebView，需額外測試各平台 WebGL 差異〔判斷〕 |
| 專案檔案 | `.idp`（zip：`scene.json` + assets + thumbnails） | 桌面離線開啟、可匯出備份 |

**Web vs Desktop 策略**：兩端**共用 100% 的核心套件**（schema/geometry/editor/viewer），差異只在 (1) 檔案存取（本機資料夾 vs 雲端）、(2) 離線快取、(3) 較大專案的記憶體上限、(4) 自動更新。**不要做兩份程式碼。** 桌面端的獨有賣點：離線編輯、本機大檔案匯入（DWG）、批次渲染佇列。

---

## A6. 功能規格（含驗收標準）

### F1. 平面圖導入
| 項目 | 規格 |
|---|---|
| 輸入 | JPG/PNG/WebP/PDF；DWG/DXF（優先） |
| 流程 | 上傳 → 辨識 → 校正模式 → 確認建立 3D |
| 校正 | 高亮低信心牆/門窗；拖曳端點；一鍵「全部吸附直角」；尺度校正 |
| 驗收 | 10 張標準圖，80% 以上「校正操作 ≤ 5 次」即完成；DXF 匯入 100% 成功且尺寸誤差 ≤ 1% |

### F2. 2D 編輯器
- 牆繪製（連續/矩形房間）、牆厚與類型、吸附（格線/端點/角度 15°、直角）、尺寸標註（可直接輸入數值）、門窗拖放、家具 2D 符號、圖層（結構/家具/標註）、多樓層（Phase 3）。
- 驗收：1,000 個圖元下拖曳維持 ≥ 50 FPS〔假設，中階筆電〕。

### F3. 3D 生成與編輯
- 牆體由 Scene Graph 參數化生成；拖動牆時連動相鄰牆頂點、地板面積、貼圖重複率。
- TransformControls：位移/旋轉/縮放；家具預設**鎖定比例縮放**；地面吸附；碰撞/穿牆提示；對齊參考線。
- 材質面板：地板、牆面（每面可獨立）、天花板；貼圖尺度以真實尺寸（cm）指定。
- 驗收：200 個家具、Draw Call 控制在預算內（見 B8），可持續操作。

### F4. 資產庫
- 分類、搜尋、標籤（風格/材質/品牌）、尺寸資訊、授權資訊；使用者上傳 glb（審核與轉檔）。
- 台灣在地化：常見品牌與規格、系統櫃/廚具/衛浴模組（可參數化寬高深）。
- 驗收：MVP 至少 300 件精選模型，涵蓋客廳、臥室、廚房、衛浴、辦公的 90% 常用品項〔假設〕。

### F5. AI 渲染
- 使用者選：視角（從 3D 相機）、風格（模板+自訂）、結構嚴格度（滑桿：自由 / 平衡 / 嚴格）、解析度（1K/2K/4K）。
- 流程：草圖 1K（快）→ 確認 → 高清。輸出附中繼資料（模型、模板版本、種子/參數）。
- 局部重繪：點選物件 → 自動遮罩 → 輸入指令 → 產生 3 個候選。
- 驗收：結構驗證通過率 ≥ 90%（平衡模式，以測試集計）〔假設〕；P50 草圖 ≤ 30 秒〔假設，依供應商〕。

### F6. AI 助理
- 對話面板 + 快速動作；所有變更先預覽（Diff）再套用；可 Undo。
- 驗收：測試集 100 句指令，正確轉為結構化指令 ≥ 90%；且 0 次未經確認直接修改場景。

### F7. 專案與協作
- 自動儲存、版本歷史、分享唯讀連結、評論標註（Phase 3）、即時協作（Phase 4，CRDT）。

### F8. 匯出
- PNG/JPG（效果圖）、PDF（平面圖含比例尺）、DXF（牆/門窗）、glTF（3D）、BOM（CSV/XLSX）。

---

## A7. 開發路線圖（〔假設〕團隊 4～6 人）

| 階段 | 時程 | 交付 | 出口條件 |
|---|---|---|---|
| **Phase 0 驗證** | 2～3 週 | 競品實測（A2.3）、AI 渲染路線 A/B/C 的 30 場景測試、平面圖辨識可行性（用 10 張台灣圖）、授權盤點 | 決定預設渲染路線；確認辨識策略；資產來源確認 |
| **Phase 1 MVP** | 8～10 週 | Scene Graph、2D 編輯器、參數化 3D、TransformControls、300 件資產、AI 渲染（路線 A + 嚴格度）、點數制、Web 版 | 內測 20 位設計師；完成一個完整案例的時間 ≤ 30 分鐘 |
| **Phase 2 智慧化** | 8～10 週 | 平面圖辨識（向量檔+點陣圖+校正模式）、局部重繪、AI 助理、BOM/估價 | 辨識指標達標（A4.2）；助理測試集達標 |
| **Phase 3 桌面與擴充** | 6～8 週 | Electron 桌面版、離線、DXF/PDF 匯出、多樓層、分享連結 | 桌面版與 Web 功能對等 |
| **Phase 4 進階** | 持續 | 即時協作、行動端 AR 掃描（參考 magicplan 類產品）、B2B（房仲/建案）、廠商商品串接 | 依商業數據 |

---

## A8. 商業模式

| 方案 | 內容 |
|---|---|
| Free | 3 個專案、1K 渲染 + 浮水印、基礎資產 |
| Pro（設計師） | 無限專案、2K/4K、局部重繪、匯出 DXF/PDF、點數包 |
| Team | 協作、品牌化報價/簡報、共享資產庫 |
| Enterprise / B2B | 私有資產庫、API、房仲/建案白標 |

**成本原則**：每張圖的雲端成本（AI API + GPU + 儲存）必須 < 該圖對應點數售價的 40%〔假設〕；點數依解析度與路線定價，而非統一價。

---

## A9. 風險與對策

| 風險 | 影響 | 對策 |
|---|---|---|
| 平面圖辨識不準 | 使用者放棄 | 向量檔優先、校正模式為一等公民、合成資料、指標監控 |
| AI 渲染結構跑掉 | 客戶投訴、信任崩壞 | 多通道輸入、結構驗證與自動重試、嚴格路線備援 |
| 資產庫太小 | 無法與 Coohom 等競爭 | 策略：精選在地高頻品項；與廠商合作獲得授權模型；支援使用者上傳；先做「參數化通用模組」（櫃體/門窗/牆面）降低單品依賴 |
| AI 供應商漲價/下架/政策變動 | 成本與可用性 | AI Proxy 抽象層、多供應商、成本告警與熔斷 |
| 授權（資料集、模型、素材） | 法律風險 | Phase 0 授權盤點清單；所有資產記錄授權與來源 |
| 效能（WebGL 在低階裝置） | 卡頓 | 效能預算（B8）、LOD、實例化、可調品質 |
| 個資與隱私 | 法遵風險 | 見 B9；平面圖與住家資料視為個資敏感資料 |
| 範圍蔓延 | 延期 | 嚴格依 Phase 出口條件；新功能需走規則書 B12 的變更流程 |

---

## A10. 資料來源與說明

- 競品綜述：parametric-architecture.com「Top 10 Software Tools… 2026」；meltflexai.com 兩篇評測（2026-09，廠商自家文章，需留意偏誤）；genroom.io、vizcraft.ai、remodelai.io、foyr.com、plansnapper.com、aitoolsbakery.com、villaviz.com、Capterra 比較頁。
- 競品官方頁：coohom.com（繁中頁：平面圖上傳格式、AI 平面圖生成器）、aihouse.com、floor-plan.ai、getfloorplan.com。
- OpenAI 圖像 API：developers.openai.com 的 Create image edit 與 Image generation 文件（模型列表、遮罩規則）；docs.apiyi.com（第三方中繼商對 gpt-image-2 的整理，含 16 張參考圖與遮罩行為說明）；fal.ai 的 gpt-image-2 編輯端點頁。**實作前請以 OpenAI 官方文件與定價頁為準，模型名稱與價格會變動。**
- FLUX：invideo.io（2026-08 彙整）、replicate.com/collections/flux、Wikipedia（Flux）。
- 平面圖辨識：CubiCasa5K（arXiv/GitHub）、arXiv 2408.01526、arXiv 2512.02413、Hugging Face Papers（ResPlan、FloorplanVLM、MuraNet）、GitHub FloorPlanAnalyzer、PyPI floorplan-eval。
- 標示「〔判斷〕」為我的技術判斷、「〔假設〕」為建議目標值，均非來源資料。

---
---

# 第二部分：開發規則書 v1.0

> 規則等級：**MUST**＝必須、**SHOULD**＝建議（例外需在 PR 說明）、**MUST NOT**＝禁止。

## B1. 產品原則

1. **P1 單一事實來源**：Scene Graph 是唯一事實來源。2D、3D、AI 渲染皆為其衍生。
2. **P2 AI 不擅自改動**：AI MUST NOT 未經使用者確認就修改場景。
3. **P3 渲染是呈現層**：AI 生成圖 MUST NOT 反向成為幾何來源（不從圖片回推修改 Scene Graph，除平面圖匯入流程外）。
4. **P4 校正優先於全自動**：辨識結果必須可視化、可校正、可追溯信心度。
5. **P5 真實尺寸**：所有物件以真實世界尺寸表示，不得以「畫面像素」當資料。
6. **P6 可還原**：所有使用者操作 MUST 可 Undo/Redo。

## B2. 座標、單位與資料規則

| 規則 | 內容 |
|---|---|
| 內部單位 | **公釐（mm）整數**存放長度；面積用 mm²，UI 顯示可轉換為 m²/坪（1 坪 ≈ 3.3058 m²） |
| 座標系 | Three.js 右手系、**Y 軸向上**；2D 平面圖使用 (x, z) 平面，原點為專案原點 |
| 角度 | 內部使用弧度；UI 顯示度數 |
| ID | 所有實體使用 ULID/UUID；MUST NOT 使用陣列索引當 ID |
| Schema 版本 | `scene.json` 必含 `schemaVersion`；變更必須附 migration 並有測試 |
| 驗證 | 讀入與寫出都必須通過 Zod/JSON Schema 驗證 |
| 時間 | 一律 UTC ISO-8601 |

**Scene Graph 最小結構（示意）**
```json
{
  "schemaVersion": "1.0.0",
  "units": "mm",
  "levels": [{
    "id": "lvl_01", "elevation": 0, "height": 2800,
    "walls": [{ "id":"w_01","a":[0,0],"b":[4000,0],"thickness":100,"type":"partition","materialId":"mat_paint_white" }],
    "openings": [{ "id":"o_01","wallId":"w_01","type":"door","offset":800,"width":900,"height":2100,"sill":0 }],
    "rooms": [{ "id":"r_01","label":"客廳","wallIds":["w_01","..."],"floorMaterialId":"mat_oak_light" }],
    "objects": [{ "id":"obj_01","catalogId":"sofa_3seat_a","position":[1500,0,2000],"rotationY":0,"scale":[1,1,1],"locked":false }]
  },
  "meta": { "createdBy":"...", "source":"manual|import-vector|import-raster", "confidence": null }
}
```

## B3. 幾何與編輯規則

1. 牆體以**牆中心線 + 厚度**表示；牆體 3D 輪廓由 core-geometry 計算（多邊形偏移），MUST NOT 在 viewer 層自行拼接。
2. 牆角接合必須處理 L/T/X 型；共線牆自動合併。
3. 門窗開口必須依附於牆（`wallId + offset`）；牆被移動/縮短時，開口跟隨；超出範圍時提示並阻止。
4. 拖動牆頂點：相鄰牆端點同步更新 → 重算房間多邊形與地板面積 → 重算貼圖重複率（依真實尺寸）。
5. 吸附優先序：端點 > 牆線 > 格線；角度吸附預設 15°，按住修飾鍵可暫時關閉。
6. 家具預設**等比縮放**；非等比縮放需使用者明確啟用，並記錄於物件屬性。
7. 家具放置：預設貼地（y=0 或指定高度）；穿牆/重疊時顯示警示（不強制阻止，除非設定為嚴格模式）。
8. 預設參數（可由使用者/地區設定覆寫，〔假設〕需與設計師確認）：天花高 2800 mm；隔間牆厚 100 mm；外牆/結構牆厚 200 mm；門寬 900 mm、高 2100 mm。
9. 所有幾何函式 MUST 為純函式並有單元測試；含邊界案例（極短牆、共線、近乎平行、自交）。

## B4. 2D 編輯器規則

- 所有編輯動作經由 **Command**（`execute / undo`），MUST NOT 直接 mutate 狀態。
- 拖曳過程使用暫態預覽，`pointerup` 才提交 Command。
- 圖元 > 500 時啟用視窗裁剪/批次繪製；縮放範圍限制以避免浮點誤差。
- 標註數字可直接輸入，輸入後觸發約束求解（至少支援：改單面牆長度並保持相鄰牆角度不變）。

## B5. 3D 檢視與資產規則

**資產（glb）交付檢查表**
| 項目 | 規則 |
|---|---|
| 格式 | glTF 2.0 (.glb)，MUST 通過 gltf-validator |
| 尺度 | 1 單位 = 1 m（載入時轉 mm）；尺寸必須與真實商品一致（誤差 ≤ 2%） |
| 原點 | 底部中心；正面朝 +Z |
| 面數 | 單品 ≤ 20k 三角形（〔假設〕），另提供 LOD1（≤ 5k） |
| 貼圖 | 預設 ≤ 2048px；PBR（baseColor/normal/ORM）；KTX2 壓縮 |
| 壓縮 | Draco 或 Meshopt |
| 命名 | `category_subcategory_brand-or-generic_variant`（小寫、底線） |
| 授權 | 必須有 `license`、`source`、`allowedUse`（商用/渲染/再散布）欄位；無授權資料 MUST NOT 上架 |
| 中繼資料 | 尺寸、材質槽、可換材質的 mesh、風格標籤 |

**3D 場景規則**
- 重複家具使用 InstancedMesh 或共用 geometry/material；
- 材質以 `material_id` 引用，不得在物件上內嵌不可追蹤的貼圖；
- 離開頁面/切換專案必須 `dispose()` geometry、material、texture、render target；
- TransformControls 操作期間停用 OrbitControls；操作結束提交 Command。

## B6. AI 規則

### B6.1 通用
1. 所有 AI 呼叫 MUST 經後端 **AI Proxy**；前端 MUST NOT 持有任何供應商 API Key。
2. AI Proxy MUST 提供模型抽象介面（`generateRender / editRegion / describeScene / chat`），供應商可替換。
3. 所有 AI 任務為非同步 Job，含：`jobId、state(queued/running/succeeded/failed/canceled)、progress、costEstimate、costActual、retryCount`。
4. 每個任務 MUST 支援取消與逾時；重試上限 2 次；失敗必須給使用者可理解訊息。
5. 每個生成結果 MUST 記錄「出處」：模型名稱與版本、路線（A/B/C）、模板版本、輸入場景雜湊、參數、時間、成本。

### B6.2 渲染
1. 送出前必須產生 G-buffer（color/depth/edge/objectId），並存檔以便重現。
2. 遮罩 MUST 由 objectId 自動產生，可略微擴張（預設 2～4 px）；GPT Image 遮罩需為 PNG、與原圖同尺寸、檔案 < 4MB，且**遮罩只作用於第一張輸入圖**（依官方文件）。
3. 局部重繪完成後，MUST 執行「遮罩外像素還原」合成，避免遮罩外被改動。
4. 結構驗證 MUST 在交付前執行；失敗自動重試（提高嚴格度），仍失敗則降級到嚴格路線並標註。
5. 預設先產生 1K 草圖；4K 需使用者確認。
6. 輸出圖 SHOULD 附 AI 生成標示（中繼資料與可見浮水印依方案而定）。

### B6.3 提示詞模板
- 模板放 `prompts/*.md`，具版本號；變更需 PR 審查並附測試集比對結果。
- 結構：
  ```
  [SYSTEM 固定] 保留輸入圖的牆、門窗、家具位置與比例，不新增/刪除結構元素；只改變材質、光影與氛圍。
  [空間] {roomType}
  [風格] {styleTemplate}
  [材質清單] {由 Scene Graph 產生}
  [光線] {timeOfDay, lightSource}
  [額外要求] {使用者輸入，經清理}
  [限制] 不要文字/浮水印/人物（除非指定）
  ```
- 「額外要求」MUST 與系統指令分離，並限制長度；不得讓使用者輸入覆寫「保留結構」指令。
- 使用者提示詞若為中文，可先由 LLM 標準化為英文設計語彙（同時保存原文與標準化結果）。

### B6.4 對話助理
1. LLM 輸出 MUST 為經 JSON Schema 驗證的工具呼叫；不合法輸出 MUST 丟棄並重試/詢問使用者。
2. 數值計算（面積、預算、材料量、動線距離）MUST 由程式計算，LLM 不得自行算數。
3. 所有場景變更先顯示預覽/差異，經使用者確認才套用；套用後可 Undo。
4. 傳給 LLM 的場景資料 MUST 為摘要（不含使用者個資、不含原始平面圖），只送完成任務所需的最小資訊。

### B6.5 平面圖辨識
1. 向量檔（DXF/DWG/向量 PDF）優先走解析路線，不經 AI 分割。
2. 辨識輸出每個元素必含 `confidence`；低於門檻（〔假設〕0.6）者在校正模式高亮。
3. 尺度未知時 MUST 要求使用者校正（兩點+實際長度），不得靜默猜測。
4. 模型/資料集使用前必須完成授權盤點並登錄於 `docs/licenses.md`；非商用授權 MUST NOT 進入商用版本。
5. 每次模型更新須通過回歸測試集（含台灣建照圖、預售屋 DM、手繪、掃描歪斜、低解析）：牆 IoU、門窗 F1、房間重疊率不得低於上一版。

## B7. 後端與 API 規則

- API 版本化（`/v1`）；錯誤格式統一：`{ code, message, details?, requestId }`。
- 會產生費用的端點 MUST 支援 **Idempotency-Key**。
- 點數扣款採「預扣 → 成功結算 → 失敗退回」，全部記錄於帳本表，禁止直接改餘額。
- 所有長任務使用 Queue；Worker 必須可水平擴充並有死信佇列。
- 檔案上傳：型別白名單、大小上限、病毒/格式檢查；DWG/PDF 在沙箱中解析。
- 專案版本：每次儲存產生不可變版本（內容雜湊），支援還原。

## B8. 效能預算（〔假設〕，以中階筆電/Chrome 為準，首版定案後以實測調整）

| 指標 | 預算 |
|---|---|
| 編輯 FPS | ≥ 50（200 家具、5 房間場景） |
| Draw Calls | ≤ 300（可視範圍） |
| 首次載入（快取後）可互動 | ≤ 3 秒；含專案 ≤ 6 秒 |
| 專案存檔 | ≤ 1 秒（增量） |
| 記憶體 | Web 端 ≤ 1.5 GB；超過時降級材質解析度 |
| 貼圖 | 預設 ≤ 2K；離屏渲染時才用高解析 |

超出預算的 PR MUST 附說明與優化計畫。

## B9. 安全、隱私與內容規則

1. 使用者上傳的平面圖、住家照片視為**敏感個資**：加密儲存、最小保留期限、可使用者刪除（含衍生資料）。
2. 送往第三方 AI 的資料需在隱私權政策與使用條款明列；使用者資料 MUST NOT 用於訓練，除非使用者明確同意（Opt-in）；同時確認各供應商的資料保留與訓練條款。
3. 上傳與提示詞需經內容審核；違規內容拒絕並記錄。
4. 遵循台灣《個人資料保護法》及目標市場法規；正式上線前請由法務審閱〔本文件不構成法律意見〕。
5. Secret 只存於 Secret Manager；CI 不得輸出金鑰。
6. 分享連結預設唯讀、可撤銷、可設定到期。
7. 稽核記錄：登入、匯出、分享、刪除、大額點數扣款。

## B10. 程式碼與工程規範

**Monorepo 結構**
```
/apps      web, desktop, admin
/packages  scene-schema, core-geometry, editor-2d, viewer-3d, ai-client, ui, catalog-tools
/services  api (TS), cv-service (Python), worker
/prompts   *.md（版本化）
/docs      architecture, licenses.md, adr/, rules.md
```
- TypeScript `strict: true`；禁止 `any`（需註解例外）。
- 套件邊界：`core-geometry` 與 `scene-schema` MUST NOT 依賴 React/Three.js/DOM。
- 測試：core-geometry 100% 分支覆蓋為目標；Scene 讀寫/migration 有 Golden File 測試；AI 管線使用固定測試集 + 快照比對；E2E（Playwright）涵蓋「匯入→編輯→渲染→匯出」主流程。
- Git：Trunk-based + 短分支；Conventional Commits；PR 至少 1 人審查；重大決策寫 ADR。
- CI 閘門：Lint、Type-check、單元/整合測試、Bundle 大小預算、效能煙霧測試、授權掃描（依賴與資產）。
- 可觀測性：前端錯誤（Sentry 類）、後端追蹤（OpenTelemetry）、AI 任務成本與成功率儀表板。

## B11. 品質閘門與完成定義（DoD）

一個功能算「完成」必須滿足：
1. 有規格與驗收標準（A6）且全部通過；
2. 有 Undo/Redo；
3. 通過效能預算（B8）；
4. 有自動化測試與（如涉及 AI）測試集結果；
5. 有隱私與授權檢查；
6. 有埋點與錯誤監控；
7. 文件更新（使用者說明或內部 ADR）。

**AI 相關 KPI（上線後持續追蹤）**：平面圖辨識平均校正次數、渲染結構驗證通過率、重試率、每張圖平均成本、使用者「滿意/重生成」比率、助理指令成功率。

## B12. 規則變更流程

1. 任何人可提出變更（PR 修改本文件並附理由與影響範圍）。
2. 技術負責人 + 產品負責人審核；影響 Schema 的變更需附 migration 計畫。
3. 每個 Phase 結束時回顧規則，刪除過時、新增必要條目；版本號遵循語意化版本。
4. 「〔假設〕」標記的數字，需在 Phase 0/1 用實測資料改為「定案」值並註記日期。

---

**附錄：Phase 0 建議待辦（兩週內）**
1. 註冊實測 Coohom、Planner 5D、Homestyler、Foyr Neo，填寫 A2.3 評估表。
2. 準備 10 張台灣平面圖（含向量檔、掃描檔、手繪）作為辨識測試集。
3. 建立 30 個測試場景，跑路線 A/B/C，評分並定案預設路線。
4. 完成授權盤點（資料集、模型、素材、字型、第三方庫）。
5. 決定首批 300 件資產的來源與授權方式。
6. 建立 Monorepo 骨架與 Scene Schema v1.0，並用它產生第一批合成平面圖。
