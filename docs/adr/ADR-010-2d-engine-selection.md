# ADR-010 2D 引擎選型（Konva vs Pixi）
狀態：接受
日期：2026-09-30
背景：2D 平面圖編輯需在 500 圖元下順暢拖曳（B4：圖元 > 500 時啟用裁剪/批次），並與 viewer-3d（three.js WebGL）共存。

量測（`tools/bench-2d`；Chrome 154 headless、Apple M1 Pro、各 3 次 × 3 秒；500 圖元＝牆矩形/家具矩形/標註文字，持續拖曳其中一個）。
注意：headless 的 rAF 上限約 57/s，兩者都可能被這個上限卡住；數值僅供比較，非產品效能定案（B8 另測）。

| 指標 | Konva（預設：整層重畫＋hit graph） | Konva 最佳化（drag layer、perfectDrawEnabled:false） | Pixi v8（WebGL） |
|---|---|---|---|
| 拖曳 FPS | 4.9 / 5.1 / 4.8 | 47.2 / 47.1 / 39.3 | 49.1 / 49.3 / 49.0 |
| p95 單幀 | 865 / 579 / 853 ms | 40 / 22 / 73 ms | 20 / 22 / 25 ms |
| JS heap | ~22 MB | ~21 MB | ~22 MB |
（對照：同場景原生 canvas 2D 每幀 8.5 ms。）

決策：採用 **Konva（react-konva）**，並把以下最佳化列為 MUST：
1. 拖曳中的圖元移到獨立的 drag/preview layer，只重畫該層；靜態層 pointerup 後才重畫。
2. 所有靜態圖元 `perfectDrawEnabled: false`、`shadowForStrokeEnabled: false`；純裝飾圖層（格線、標註）`listening: false`。
3. 視窗外圖元不繪製（B4 視窗裁剪）。

選項與取捨：
- Pixi：p95 較穩定，但會在頁面上多一個 WebGL context（與 three.js 並存，GPU 記憶體與 context 上限風險）、文字需轉貼圖（尺寸標註在縮放時較糊）、hit testing/Transformer 需自建。
- Konva：未最佳化時不可接受（~5 FPS），最佳化後 FPS 與 Pixi 相近；內建事件/hit graph/Transformer，react-konva 成熟，文字清晰。
後果：
- 好：開發速度快，事件模型簡單；不搶 WebGL context。
- 壞/風險：圖元數大幅增加（>2000）時可能落後 Pixi；若 P7 效能量測不達標，以新 ADR 重新評估（引擎差異已封裝在 editor-2d 內）。
