# ADR-024 移除登入、瀏覽器端平面圖辨識、物件儲存介面（Supabase 準備）
狀態：接受
日期：2026-09-30
背景：使用者決定（1）目前不需要登入／註冊；（2）上傳 2D 平面圖就要能產生 2D／3D；（3）資料庫之後改用 Supabase，
所有用到 S3 的地方先開介面、暫不實作 Supabase 版本。

決策：
1. **前端移除登入／註冊**：刪除 AuthForm、token 狀態與 refresh 流程；API client 不帶 token。
2. **後端 AUTH_MODE**：`none`（development 預設）＝沒有 Bearer token 的請求以「本機使用者」處理——`LocalIdentity`
   第一次使用時建立無密碼使用者（無法登入）、個人工作區、owner 身分與 1000 點開發用點數（冪等鍵 `local:<userId>`）。
   `jwt`（test／production 預設）保留原本流程與整合測試；改用 Supabase Auth 時新增模式替換。E2E 後端以 `AUTH_MODE=none` 啟動。
3. **平面圖辨識移到瀏覽器**：新套件 `@interiorai/plan-recognition`（純 TypeScript、無 DOM 依賴），移植 cv-service 的
   DXF（ASCII；LINE／LWPOLYLINE／POLYLINE／ARC／TEXT／MTEXT／INSERT＋BLOCKS）與點陣路線。點陣向量化改用
   「水平／垂直連續長度分類 → 連通元件 → 中心線」（取代 skeleton＋Hough；只處理正交牆，斜牆出警告）。
   沒有 OCR：尺度由使用者兩點校正，或以門寬中位數（850 mm）推估並經確認；房名依面積推測（最大＝客廳、≤ 4.5 m²＝衛浴、其餘臥室）。
   點陣辨識在 Web Worker 執行，長邊 > 2400 px 先縮小；匯入工作階段存 IndexedDB（`interiorai-imports`），建立專案後刪除。
   設定 `VITE_CV_URL` 時優先呼叫 cv-service（有 OCR），無法連線則退回瀏覽器。
   驗收沿用 P5 Gate：合成點陣圖牆／門窗／房間數量、外框誤差 ≤ 3%；DXF 門窗數完全一致、誤差 ≤ 1%（單元測試＋E2E）。
4. **物件儲存介面**：後端 `ObjectStorage`（ensureBucket／putUrl／getUrl／put／head／get），`S3Storage` 為目前實作、
   `SupabaseStorage` 為佔位（呼叫即拋錯），`createStorage(config)` 依 `STORAGE_PROVIDER` 選擇；所有 controller、processor、worker 只依賴介面。
   前端 `BlobStore`（`PresignedUploadStore` 目前實作、`SupabaseBlobStore` 佔位，`VITE_STORAGE_PROVIDER`）。
   資料庫改用 Supabase Postgres 時只需把 `DATABASE_URL` 指向 Supabase（drizzle／RLS 不變）。

後果：
- 瀏覽器辨識的品質低於 cv-service（無 OCR、無轉正、無斜牆）；校正頁的「待確認清單」與刪除仍是主要修正手段。
- API 的 `/plan-imports` 與 cv-service 保留（伺服器端辨識、批次處理），前端預設不再使用。
- `AUTH_MODE=none` 只適用於本機／內部環境；對外部署前必須接上真正的身分驗證。
