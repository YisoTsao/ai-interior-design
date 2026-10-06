# ai-eval — AI 渲染評測 harness（05 §8）

## 內容

- `scenes/*.json`：30 個場景（10 客廳、10 臥室、5 廚房、5 衛浴），由 `scripts/make-scenes.mjs` 以固定種子、經 app-state Command 產生（保證通過 Scene 驗證）。
- `gbuffers/<id>/`：預先產生的 G-buffer（512×384；color/depth/edge/objectId＋`meta.json` 含 idMap、近遠平面、相機），由 `scripts/make-gbuffers.mjs` 用真實 web app 的 `viewer3d().gbuffer()` 產生（剖面模型、東南等角視角）。
- 5 種風格：`modern / scandinavian / japandi / industrial / luxury`（`services/api/src/ai/prompts/index.ts` 的 `STYLES`）。

## 執行

```bash
pnpm --filter @interiorai/api build
pnpm ai-eval run --provider mock --route A --mode ok                 # 結構保留（預期全數通過）
pnpm ai-eval run --provider mock --route A --mode break_structure    # 結構破壞（預期全數失敗）
OPENAI_API_KEY=... pnpm ai-eval run --provider openai --route A      # 真實供應商（需金鑰；未在 CI 執行）
BFL_API_KEY=... pnpm ai-eval run --provider flux --route B
```

輸出在 `ai-eval/results/<時間>-<provider>-<route>-<mode>/`：

- `results.csv`：scene, kind, style, score（結構 recall）, passed, latencyMs, costUsd, error
- `summary.json`：通過率、失敗率、分數 P10/中位數、平均耗時、總成本、依空間類型的通過率
- `report.html`：clay 與效果圖並排，人工評分（結構一致／真實感／風格符合，1–5）並可匯出 CSV

重新產生評測集：`pnpm --filter @interiorai/ai-eval scenes`、`pnpm --filter @interiorai/web build && pnpm --filter @interiorai/ai-eval gbuffers`。

## 現況（2026-09-30）

| 執行                             | 門檻 | 通過率  | recall P10 / 中位數 |
| -------------------------------- | ---- | ------- | ------------------- |
| mock ok（balanced）              | 0.80 | 150/150 | 0.987 / 0.999       |
| mock ok（strict）                | 0.90 | 150/150 | 0.987 / 0.999       |
| mock break_structure（balanced） | 0.80 | 0/150   | 0.389 / 0.441       |

**mock 結果只證明管線與驗證演算法可分辨「保留」與「破壞」，不代表門檻對真實模型有效**（`models.yaml` `calibrated: false`，ADR-012）。
真實供應商評測（含人工評分）需金鑰，尚未執行 → PROGRESS 阻礙表。
