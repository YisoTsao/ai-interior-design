# ADR-010 2D 引擎選型（Konva vs Pixi）
狀態：接受
日期：2026-09-30
背景：2D 平面圖編輯需在 500 圖元下順暢拖曳（B4：圖元 > 500 時啟用裁剪/批次），並與 viewer-3d（three.js WebGL）共存。

量測（`tools/bench-2d`；Chrome 154 **原生 arm64**、Apple M1 Pro、headless、各 3 次 × 3 秒；圖元＝牆矩形/家具矩形/標註文字，持續拖曳其中一個）。
rAF 上限 60/s，500 圖元時三者都被上限卡住，因此另測 5000 圖元。

| 圖元數 | 指標 | Konva（預設：整層重畫＋hit graph） | Konva 最佳化（drag layer、perfectDrawEnabled:false） | Pixi v8（WebGL） |
|---|---|---|---|---|
| 500 | 拖曳 FPS | 60 / 60 / 60 | 60 / 60 / 60 | 60 / 60 / 60 |
| 500 | p95 單幀 | 18–20 ms | 17–19 ms | 18–20 ms |
| 5000 | 拖曳 FPS | 43.0 / 43.2 / 44.8 | **60 / 60 / 60** | 60 / 60 / 59.9 |
| 5000 | p95 單幀 | 26–27 ms | **18 ms** | 19–20 ms |
| 5000 | JS heap | 23–26 MB | **21 MB** | 40–45 MB |

> 更正紀錄：本 ADR 初版（同日）的數據是在 **Rosetta（x86_64）下的 Chrome** 量到的（本機 Node 為 x86 版，Playwright 因此以 x86 啟動 universal Chrome），
> 當時 Konva 預設只有 ~5 FPS、最佳化版 ~45 FPS。那些數字反映的是 JIT 轉譯成本而非引擎差異，已作廢。量測腳本現會自動以 arm64 啟動（`tools/chrome-arm64.sh`）。

決策：採用 **Konva（react-konva）**，並把以下最佳化列為 MUST：
1. 拖曳中的圖元移到獨立的 drag/preview layer，只重畫該層；靜態層 pointerup 後才重畫。
2. 所有靜態圖元 `perfectDrawEnabled: false`、`shadowForStrokeEnabled: false`；純裝飾圖層（格線、標註）`listening: false`。
3. 視窗外圖元不繪製（B4 視窗裁剪；待圖元數超過 2000 時實作）。

選項與取捨：
- Pixi：FPS 與最佳化 Konva 相同，但 heap 約兩倍、頁面上多一個 WebGL context（與 three.js 並存）、文字需轉貼圖（縮放時標註較糊）、hit testing/Transformer 需自建。
- Konva：最佳化後在 5000 圖元仍 60 FPS 且記憶體最低；內建事件/hit graph；react-konva 成熟；文字清晰。未最佳化時 5000 圖元掉到 ~43 FPS，因此最佳化是強制規則。
後果：
- 好：開發速度快，不搶 WebGL context，記憶體低。
- 風險：圖元數再大一個量級時需驗證；引擎差異封裝在 editor-2d 內，可用新 ADR 替換。
