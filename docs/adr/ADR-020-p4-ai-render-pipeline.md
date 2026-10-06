# ADR-020 P4 AI 渲染管線的實作決策與偏離
狀態：接受
日期：2026-09-30

決策：
1. **供應商介面以 PNG 位元組傳遞**（偏離 05 §1 的 URL 欄位）：worker 已從私有桶取回 G-buffer，直接 multipart/base64 傳給供應商，
   不必產生公開 URL（少一個外洩面）。
2. **共用純影像運算套件 `packages/image-ops`**：Canny（5×5 高斯、固定門檻 10/25）、膨脹、recall、objectId 編碼、遮罩、遮罩外還原合成、
   mock 濾鏡（雜訊、平移、區塊填色）、浮水印。瀏覽器（G-buffer 邊緣）與後端（驗證/遮罩/合成/mock）同一份實作，確定性、property test。
3. **G-buffer**（`viewer-3d/src/gbuffer.ts`）：離屏 RT、pixelRatio 1、objectId 無抗鋸齒；深度以 RGBA packing 在 CPU 解包成線性視距並正規化為
   **8-bit**（顯式標註 `depthBits: 8`，03 §6 允許）；近/遠平面由場景包圍盒推得並寫入 meta。只渲染帶 `userData.gkind` 的 mesh
   （TransformControls 等輔助物件自動隱藏）。注意 three r186 的 RGBA 深度打包 r 為最高位。快照測試 `e2e/gbuffer.spec.ts`（容許 2% 像素差）。
4. **路由與降級**：mock 模式下所有路線都指向 mock provider 但保留路線代號（A/B/C），讓降級邏輯被完整測到。
   兩層重試（ADR-012）：呼叫層每條路線 1＋2 次指數退避、熔斷器（連續 3 次失敗開路 60 秒）；驗證層 v=1 加 `{{retryNote}}`＋換 seed、
   v=2 換到備援路線。**重新投遞時從持久化的 retry_count 繼續**（整合測試發現：MinIO 暫時性錯誤觸發 BullMQ 重跑時 retry_count 曾累加到 4）。
5. **Prompt**：`render.balanced` 升為 1.1.0（新增 `{{retryNote}}`，僅系統段）；使用者文字清理（控制字元、三引號、300 字）後只放在引用段。
   中文→英文標準化（ChatProvider）未實作 → P6 助理一起做；目前保存原文。
6. **價目/上限**：`GET /pricing`（公開）回傳 models.yaml 的點數表〔假設〕；每日 AI 任務上限依方案（`daily_job_limit`）。
   renders.id＝jobs.id（一對一，簡化查詢）。
7. **前端**：access token 只在記憶體、refresh 走 httpOnly cookie；SSE 以 fetch 串流解析（EventSource 不能帶 Authorization），斷線退回輪詢。
   渲染前把目前本機 Scene 存成雲端版本快照（本機↔雲端對應在 localStorage；409 時接在最新版本之後）。完整雲端同步/衝突三選項屬 P7。
8. **E2E**：Playwright 多一個 webServer（`services/api/scripts/e2e-backend.mjs`：Testcontainers＋API＋同程序 worker＋mock AI）。
   因此 `pnpm test:e2e` 需要 Docker。
9. **結構驗證參考邊緣**：見 ADR-019。

未驗證／未完成：真實 OpenAI/FLUX 呼叫（需金鑰；卡片以 HTTP mock 測）、FLUX.1 depth/fill 端點是否仍提供、OpenAI 單價、
供應商審核端點、門檻校準、真實供應商評測與人工評分、免費方案可見浮水印（目前只有未通過預覽加浮水印；成品只有中繼資料標示）。
