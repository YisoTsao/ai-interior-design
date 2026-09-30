# cv-service（平面圖辨識，06）

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --port 8100      # POST /v1/parse（multipart: file, kind?, scaleMmPerPx?）
.venv/bin/python -m pytest -q                   # 單元＋回歸下限（DXF ≤1% 誤差 Gate）
.venv/bin/python -m eval.run --plans 20         # 評測報告（eval/reports/latest），與 eval/baseline.json 比較
.venv/bin/python -m eval.debug 1 filled out.png # 疊圖除錯（GT 綠、預測紅/藍/洋紅）
```
- 向量：DXF（ezdxf）。DWG/PDF 目前拒絕（授權/沙箱，06 §2）。
- 點陣：傳統 CV 分割（可替換為 ONNX 模型：`SEG_MODEL_PATH`，權重未提供）＋門窗符號偵測＋OCR 尺度。
- 合成資料：`synth/`（BSP 戶型、5 種繪圖風格、DXF 輸出）。評測只用合成資料，**真實圖面準確率未驗證**。
