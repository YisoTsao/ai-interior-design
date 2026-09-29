# 05 AI 設計規格

## 1. Provider 抽象（後端 `services/api/src/ai/`）
```ts
export interface RenderInput {
  gbuffer: { colorUrl: string; depthUrl: string; edgeUrl: string; objectIdUrl: string; normalUrl?: string };
  size: { w: number; h: number };
  style: { templateId: string; extra?: string };
  materials: string[];              // 由 Scene Graph 轉成的文字描述
  strictness: 'free' | 'balanced' | 'strict';
  references?: string[];            // 風格/材質參考圖 URL
  seed?: number;
}
export interface InpaintInput { baseUrl: string; maskUrl: string; instruction: string; references?: string[]; }
export interface ProviderResult { imageUrl: string; model: string; costUsd: number; latencyMs: number; raw?: unknown }

export interface ImageProvider {
  id: string;                                   // 'openai' | 'flux' | 'gemini' | 'mock'
  capabilities: { edit: boolean; mask: boolean; depthControl: boolean; maxRefs: number; maxSize: number };
  render(i: RenderInput, ctx: JobCtx): Promise<ProviderResult>;
  inpaint(i: InpaintInput, ctx: JobCtx): Promise<ProviderResult>;
  estimateCost(i: RenderInput | InpaintInput): number;
}
export interface ChatProvider { chat(msgs, tools, ctx): Promise<{ toolCalls: ToolCall[]; text?: string }>; }
export interface VisionProvider { describe(imageUrls: string[], prompt: string): Promise<string>; }
```
**模型名稱/價格不得寫死在程式**：放 `services/api/models.yaml`（bootstrap 由 `assets/models.yaml` 複製；部署以 `MODELS_CONFIG` 覆寫；`tools/check_models.py` 檢查 `verified_at`），實作前用官方文件核對（模型與價格會變動）。

## 2. 路由策略
| 使用者嚴格度 | 首選 | 備援（驗證失敗時） |
|---|---|---|
| free | GPT Image edits（clay 為主圖，參考圖引導） | 平衡 → 嚴格 |
| balanced（預設） | GPT Image edits（clay + 邊緣圖作輔助參考） | 深度/邊緣控制模型 |
| strict | 深度/邊緣控制（FLUX Depth/Canny 或 SDXL ControlNet） | 無（失敗即報錯） |
| inpaint | GPT Image mask edit 或 FLUX Fill | 另一者 |
路由還考慮：供應商健康狀態（熔斷）、預估成本上限、解析度能力。所有選擇寫入 `provenance`。
**降級只換路線（供應商/控制方式），不提高驗證門檻**；門檻固定為使用者選擇的嚴格度（ADR-012）。

## 3. 渲染流程（Worker 內）
1. 下載 G-buffer → 校驗尺寸一致。
2. 依路由取 provider → 組 prompt（見 §4）→ 呼叫（逾時 120s）。
3. 局部重繪：`遮罩 = objectId 圖中所選物件顏色 → 二值 → 擴張 2–4px → 轉 PNG alpha`（透明處＝要改，符合 GPT Image 規則；PNG < 4MB、與原圖同尺寸）→ 呼叫 → **遮罩外像素還原合成**（用原圖覆蓋遮罩外）。
4. **結構驗證**（§5）。
5. 通過→存檔、加標示、結算點數；不通過→依 §6 重試/降級。
6. 寫 `provenance`：`{provider, model, route, promptTemplateVersion, promptHash, sceneHash, gbufferHash, seed, params, costUsd, latencyMs, validation:{score,passed}}`。

## 4. Prompt 規格（模板在 `assets/prompts/`）
- 系統固定指令（保留結構）+ 空間類型 + 風格模板 + 材質清單（自動生成）+ 光線 + 使用者額外要求（清理、限長 300 字、置於獨立段落）+ 限制。
- 中文輸入 → 由 ChatProvider 標準化為英文設計語彙（同時保存原文）。
- 每個模板有版本；變更需跑評測集（§8）並附結果。
- **防 prompt injection**：使用者文字不得放在系統指令段；輸出後不從模型輸出解析任何可執行指令。

## 5. 結構驗證演算法
目的：偵測 AI 把牆、門窗、家具輪廓畫歪或增減。
1. 取輸出圖 `O`，縮放到 G-buffer 尺寸。
2. 計算 `O` 的邊緣圖 `E_o`（Canny，門檻固定）；取 G-buffer 邊緣圖 `E_g`（含 objectId 邊界與深度邊界）。
3. 只比較「結構性邊緣」：對 `E_g` 做膨脹（容許誤差 τ px，預設 τ = 短邊 1.2%），計算
   - `recall = E_g 被 E_o(膨脹後) 覆蓋的比例`（結構是否被保留）
   - `precision_struct` 僅在 objectId 邊界附近評估（避免被紋理邊緣懲罰）
4. `score = recall`；門檻（〔假設〕，**未校準**）：balanced ≥ 0.80、strict ≥ 0.90、free ≥ 0.65。**門檻以使用者選擇的嚴格度為準，整個 Job 期間固定**（降級不加嚴，ADR-012）。mock provider 通過不代表門檻有效。
5. 額外檢查：深度圖與輸出圖的單目深度估計相關係數（可選，若有深度模型）。
門檻需用評測集校準並定案。

## 6. 重試與降級
- **兩層重試（ADR-012）**：供應商呼叫層（5xx/逾時，指數退避）最多 2 次，不計入 `retry_count`，之後換備援供應商；結構驗證層最多 2 次（第 1 次提高嚴格度提示並換 seed；第 2 次降級到 strict **路線**，門檻不變），計入 `retry_count`。
- **成本硬上限**：累計 `costUsd` 超過 `max_usd_per_job` 立即中止並退款。
- 全部失敗：Job=failed，`refund`，回 `JOB_FAILED` 並附一張 1K、可見浮水印、不可下載的「未通過驗證」預覽。使用者選「仍要使用」→ 以 `adjust` 帳本項目（冪等鍵 `{jobId}:accept-unvalidated`）扣回實際成本後才提供無浮水印下載。
- 供應商回傳尺寸與請求不符、被審核拒絕：視為該次呼叫失敗（不進入驗證）；`seed` 不被支援時 provenance 記 `seedSupported:false`，「可重現」＝可用相同輸入重跑，不保證位元相同。

## 7. 助理工具 Schema（ChatProvider function calling）
```json
[
 {"name":"move_object","parameters":{"id":"string","to":{"position":"[x,z] mm","or_relative":{"anchor":"wall|window|object","ref_id":"string","side":"left|right|front|back","gap_mm":"number"}}}},
 {"name":"resize_wall","parameters":{"wall_id":"string","new_length_mm":"number","keep":"start|end|center"}},
 {"name":"add_object","parameters":{"catalog_id":"string","room_id":"string","anchor":"string?"}},
 {"name":"set_material","parameters":{"target_id":"string","material_id":"string"}},
 {"name":"list_objects","parameters":{"room_id":"string?"}},
 {"name":"suggest_layout","parameters":{"room_id":"string","constraints":"object"}},
 {"name":"check_clearance","parameters":{"room_id":"string"}},
 {"name":"estimate_budget","parameters":{"scope":"room|project"}}
]
```
規則：輸出必須通過 JSON Schema；查詢型工具（list/check/estimate）由程式執行後把結果回餵 LLM；變更型工具只回「提案」，前端顯示差異、使用者確認後才以 Command 套用。傳給 LLM 的只有場景**摘要**（去除個資），不含原圖。

## 8. 評測 Harness（`ai-eval/`）
- 測試集：30 場景（10 客廳/10 臥室/10 廚衛）× 5 風格，存 `ai-eval/scenes/*.json` + 預先產生的 G-buffer。
- 指令：`pnpm ai-eval run --provider <id> --route <A|B|C>` → 輸出 CSV：`結構分數、耗時、成本、失敗率`，並產出 HTML 對照頁供人工評分（結構一致/真實感/風格符合，1–5 分）。
- Mock provider：回傳 clay 圖加上噪點濾鏡（確定性），使 CI 不需金鑰即可測全流程。`break_structure` 模式的確定性定義：邊緣整體平移 `3τ` px（τ＝短邊×1.2%）並把最大的 objectId 區塊填成周圍平均色，使 recall 必低於所有門檻。另有 `slow`、`fail` 模式。mock 結果一律標「未校準」。
- 助理評測：100 句指令 → 期望工具呼叫 JSON，計算正確率；另含 20 句惡意/越權指令（應拒絕或只提案）。

## 9. 成本模型
`單圖成本 = provider 成本 × (1 + 重試期望次數) + 儲存/傳輸 + GPU（若自建）`；點數售價需使 **成本 ≤ 40% 售價**（〔假設〕）。點數定價依 (解析度, 路線) 查表（在 `billing/pricing.ts`，初始值取自 `models.yaml` 的 `pricing_credits`，皆〔假設〕待商業定價），估價在送出前顯示並 reserve（reserve ＝ 最大成本，ADR-014）。

## 10. 內容與隱私
- 上傳圖與提示詞先過審核（供應商 moderation 端點或自建規則）；違規 → `MODERATION_BLOCKED`。
- 傳給第三方前檢查資料最小化；不使用者資料訓練；記錄各供應商資料保留條款於 `docs/licenses.md`。
- 輸出加 AI 生成標示（中繼資料；免費方案加可見浮水印）。
