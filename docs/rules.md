# 規則書一頁檢查清單（PR 用）— 摘自 docs/specs/10-report-and-rulebook.md B1–B12
MUST=必須｜SHOULD=建議（例外需在 PR 說明）｜MUST NOT=禁止。細節與裁決見 docs/adr/。

**B1 產品原則**
- [ ] Scene Graph 為唯一事實來源；2D/3D/AI 皆為衍生（ADR-001）
- [ ] AI MUST NOT 未經使用者確認修改場景；生成圖不得回推幾何（匯入除外）
- [ ] 辨識結果可視化、可校正、有信心度；所有操作可 Undo/Redo

**B2 資料**
- [ ] 長度 mm 整數（±1,000,000）、角度弧度、Y 向上、平面 (x,z)、UTC ISO-8601（ADR-013）
- [ ] ID 為「前綴_ULID」/UUID，不用陣列索引；讀寫皆過 Zod/JSON Schema；schemaVersion＋migration＋Golden File

**B3 幾何**
- [ ] 牆＝中心線＋厚度；輪廓由 core-geometry 計算，viewer 層 MUST NOT 自行拼牆
- [ ] 處理 L/T/X；開口依附 `wallId+offset`；拖頂點連動相鄰牆與房間
- [ ] 幾何函式為純函式，含邊界測試（極短/共線/近平行/自交）；牆長<100、厚≥長拒絕

**B4 2D 編輯器**
- [ ] 全部經 Command；拖曳為暫態、pointerup 才提交；>500 圖元啟用裁剪/批次

**B5 3D 與資產**
- [ ] glb 過 validator、尺度誤差≤2%、原點底部中心/正面 +Z、面數與貼圖在預算
- [ ] 材質以 id 引用；離開/切換專案 dispose；TransformControls 拖曳時停用 Orbit
- [ ] 資產授權欄位齊全，未確認者 status=draft，不得 published

**B6 AI**
- [ ] 所有 AI 呼叫經後端 Proxy；前端無金鑰；Job 非同步、可取消、有逾時、重試≤2（兩層，ADR-012）
- [ ] 結果附 provenance；G-buffer 存檔；遮罩由 objectId 產生，遮罩外像素還原
- [ ] 使用者文字與系統指令分離；助理輸出過 JSON Schema，變更只提案、確認後才 Command；數值由程式計算
- [ ] 向量檔優先走解析；尺度未知必須校正；非商用資料集/模型不得進商用版

**B7 後端**
- [ ] `/v1`；錯誤 `{code,message,details?,requestId}`；收費端點需 Idempotency-Key；帳本 append-only（ADR-014）
- [ ] 長任務走 Queue，Worker 可水平擴充、有死信；版本不可變＋樂觀鎖

**B8 效能（〔假設〕，先填硬體基準）**
- [ ] FPS≥50（200 家具）、Draw calls≤300、快取後可互動≤3s、增量存檔≤1s、記憶體≤1.5GB
- [ ] 未達標→PROGRESS「未達標清單」＋改善 Task（ADR-011）

**B9 安全隱私**
- [ ] 住家圖資視為敏感個資：加密、最小保留、可刪除（含衍生資料）；不用於訓練（除非 opt-in）
- [ ] 上傳型別/大小白名單與內容審核；Secret 不入 repo/CI 輸出；分享連結唯讀、可撤銷、可到期

**B10 工程**
- [ ] TS strict、禁 any（需註解）；core-geometry / scene-schema 不依賴 React/three/DOM
- [ ] core-geometry 分支覆蓋≥90%；Conventional Commits；重大決策寫 ADR

**B11 DoD**
- [ ] 規格與驗收全過｜有 Undo｜過效能預算｜有測試（AI 有測試集）｜隱私與授權已檢｜有埋點/監控｜文件更新

**B12 規則變更**
- [ ] 規則變更走 PR＋理由；〔假設〕數字在實測後改定案並註明日期
