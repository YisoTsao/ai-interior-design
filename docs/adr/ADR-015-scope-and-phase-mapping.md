# ADR-015 需求範圍與 Phase 對照裁決
狀態：接受
日期：2026-09-29
背景：PRD 的 FR 與 Phase 有若干落差。
決策：
1. **FR-901 認證**：P3 交付 `AuthProvider` 抽象＋本機 email/密碼 JWT；OIDC 供應商整合標「未驗證」，列入 release-checklist。
2. **FR-401 資產**：P2 Gate 要求管線可用＋參數化門/窗/櫃＋≥30 件已登記授權的種子資產（目標值，可於 PROGRESS 調整並記錄）；≥300 件為 v1 上線目標，不足列為發佈阻擋項。
3. **FR-402 使用者上傳 glb**：P3 只做 API 契約與 `status=draft`；審核管線與 UI 在 P7。
4. **FR-205 多樓層**：見 ADR-013 第 7 點。
5. **apps/admin**：v1 非目標，不建立。
6. **即時多人協作**：非 v1（PRD 非目標）；Job 進度用 SSE。
7. **PostGIS**：不預設啟用。
8. **測試位置**：E2E 在根目錄 `e2e/`；i18n 檔在 `apps/web/src/locales/{zh-TW,en}.json`。
9. **契約檔名**：`docs/specs/openapi.yaml` 為權威（初始內容取自 `openapi.skeleton.yaml`）。
後果：`check_gates.py` 與 bootstrap 依此路徑。
