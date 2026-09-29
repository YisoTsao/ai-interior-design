# Backlog（Epic → Story）
> 來源：`docs/specs/01-prd.md` 附錄。每項附 FR 與 Phase；完成請勾選並同步 `docs/PROGRESS.md`。
> 標記：☐ 未開始｜☑ 完成。軟性指標與受阻項見 PROGRESS。

## E1 Scene 與幾何核心（P1）
- [x] S1.1 Zod schema + JSON Schema 等價測試（FR-301 基礎）— P1
- [x] S1.2 migration 框架與 Golden File — P1
- [x] S1.3 牆中心線→輪廓（Clipper2）— FR-301 — P1
- [x] S1.4 牆角接合 L/T/X — FR-301 — P1
- [x] S1.5 開口 CSG（幾何資料端；3D 端在 S2.5）— FR-301/203 — P1/P2
- [x] S1.6 房間多邊形偵測與面積 — FR-301 — P1
- [x] S1.7 吸附與約束（moveWallVertex）— FR-201/202 — P1
- [x] S1.8 BOM 計算純函式（骨架）— FR-602 — P1（完整於 P6）

## E2 編輯器（P2）
- [x] S2.1 Command / Undo / Redo — P6原則、FR-201 — P2
- [x] S2.2 2D 畫牆（連續/矩形）— FR-201 — P2
- [x] S2.3 標註輸入連動 — FR-202 — P2
- [x] S2.4 門窗依附 — FR-203 — P2
- [x] S2.5 3D 檢視（牆/地板/天花/開口）— FR-301 — P2
- [x] S2.6 TransformControls — FR-302 — P2
- [x] S2.7 材質面板 — FR-303 — P2
- [x] S2.8 選取同步 2D↔3D — P2
- [x] S2.9 快捷鍵 — P2
- [x] S2.10 自動儲存本機（IndexedDB）— P2
- [x] S2.11 圖層顯示切換 — FR-204 — P2
- [x] S2.12 碰撞/穿牆警示與地面吸附 — FR-304 — P2

## E3 資產庫（P2）
- [x] S3.1 目錄 Schema — FR-401 — P2
- [x] S3.2 參數化櫃體/門/窗 — FR-401 — P2
- [x] S3.3 匯入管線 CLI（catalog-tools）— FR-401 — P2
- [x] S3.4 種子資產（P2 目標 ≥30 件已登記授權；上線 ≥300，ADR-015）— FR-401 — P2
- [x] S3.5 瀏覽/搜尋 UI — FR-401 — P2

## E4 後端基礎（P3）
- [ ] S4.1 專案骨架 — P3
- [ ] S4.2 Auth（AuthProvider＋本機 JWT；OIDC 未驗證）— FR-901 — P3
- [ ] S4.3 專案與版本 API — FR-701 — P3
- [ ] S4.4 資產 API（draft）— FR-401/402 — P3
- [ ] S4.5 上傳與儲存 — P3
- [ ] S4.6 Job Queue — P3
- [ ] S4.7 點數帳本 — FR-902 — P3
- [ ] S4.8 限流/審計 — P3

## E5 AI 渲染（P4）
- [ ] S5.1 G-buffer 輸出 — FR-501 — P4
- [ ] S5.2 Provider 介面 + mock — P4
- [ ] S5.3 OpenAI provider（未驗證）— P4
- [ ] S5.4 深度/邊緣控制 provider（未驗證）— P4
- [ ] S5.5 Router — P4
- [ ] S5.6 結構驗證 — FR-501 — P4
- [ ] S5.7 遮罩合成 — FR-503 — P4
- [ ] S5.8 Prompt 模板 — P4
- [ ] S5.9 評測 harness — P4
- [ ] S5.10 渲染 UI（草圖→高清）— FR-502/504 — P4

## E6 平面圖匯入（P5）
- [ ] S6.1 DXF 解析 — FR-102 — P5
- [ ] S6.2 點陣管線 — FR-101 — P5
- [ ] S6.3 向量化 — P5
- [ ] S6.4 尺度校正 — FR-104 — P5
- [ ] S6.5 VLM 標註 — P5
- [ ] S6.6 校正 UI — FR-103 — P5
- [ ] S6.7 合成資料產生器 — P5
- [ ] S6.8 評測指標 — P5

## E7 助理與匯出（P6）
- [ ] S7.1 工具 Schema — FR-601 — P6
- [ ] S7.2 預覽/確認 — FR-601 — P6
- [ ] S7.3 助理評測 — P6
- [ ] S7.4 匯出各格式 — FR-801 — P6
- [ ] S7.5 估價 — FR-602 — P6

## E8 桌面端（P7）
- [ ] S8.1 Electron 殼 — FR-903 — P7
- [ ] S8.2 IPC — P7
- [ ] S8.3 .idp 讀寫 — P7
- [ ] S8.4 離線與同步 — P7
- [ ] S8.5 自動更新（未驗證）— P7

## E9 品質與營運（P1 起持續；P7 收斂）
- [x] S9.1 CI/CD — P1
- [ ] S9.2 可觀測性 — P7
- [ ] S9.3 效能與無障礙 — NFR-01/06 — P2/P7
- [ ] S9.4 威脅模型檢查 — P7
- [ ] S9.5 Runbook — P7
- [ ] S9.6 分享連結 FR-702、多樓層 UI FR-205 — P7

## E10 上線準備（P8）
- [ ] S10.1 授權稽核
- [ ] S10.2 法務草稿審閱（需人）
- [ ] S10.3 備份演練（需雲端）
- [ ] S10.4 發佈檢查表

## FR 覆蓋對照（自動檢查用）
FR-101 S6.2｜FR-102 S6.1｜FR-103 S6.6｜FR-104 S6.4｜FR-201 S2.2｜FR-202 S2.3｜FR-203 S2.4｜FR-204 S2.11｜FR-205 S9.6｜FR-301 S2.5｜FR-302 S2.6｜FR-303 S2.7｜FR-304 S2.12｜FR-401 S3.1–3.5｜FR-402 S4.4｜FR-501 S5.6｜FR-502 S5.10｜FR-503 S5.7｜FR-504 S5.10｜FR-601 S7.1｜FR-602 S7.5｜FR-701 S4.3｜FR-702 S9.6｜FR-801 S7.4｜FR-901 S4.2｜FR-902 S4.7｜FR-903 S8.1
