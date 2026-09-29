# ADR-012 結構驗證門檻、重試與失敗處理
狀態：接受（門檻數值為〔假設〕，待真實供應商校準）
日期：2026-09-29
背景：原規格 strict 門檻（0.90）高於 balanced（0.80），而降級路徑是 balanced→strict，降級後更難通過；重試計數與失敗後付費未定義。
決策：
1. **門檻以使用者選擇的嚴格度為準，整個 Job 期間固定**。降級到 strict「路線」只換供應商/控制方式，不提高門檻。使用者明確選 strict 時，門檻 0.90 且無備援。
2. **兩層重試**：(a) 供應商呼叫層（5xx/逾時，指數退避）最多 2 次，不計入 `retry_count`；(b) 結構驗證層最多 2 次（第 1 次提高嚴格度提示並換 seed，第 2 次降級路線），計入 `retry_count`。
3. **成本硬上限**：Job 累計 `costUsd` 超過 `models.yaml` 的 `max_usd_per_job` 立即中止並退款。
4. **失敗**：全部驗證失敗 → Job=failed → refund → 回 `JOB_FAILED`，附一張 1K、可見浮水印、不可下載的「未通過驗證預覽」。
5. **仍要使用**：使用者對該預覽選擇「仍要使用」時，另建 `adjust` 帳本項目（冪等鍵 `{jobId}:accept-unvalidated`）扣回實際成本點數，之後才提供無浮水印下載。
6. `break_structure` mock 模式的確定性定義：把輸出圖以固定演算法破壞——邊緣圖整體平移 `3τ` px（τ＝短邊×1.2%）並刪除最大的 objectId 區塊（填為周圍平均色）；使 recall 必然低於所有門檻。
7. `seed` 不被供應商支援時，「可重現」定義為：可用相同輸入與 provenance 重跑，但不保證位元相同；provenance 記錄 `seedSupported:false`。
後果：05-ai-design.md §5–6 依此修訂；ai-eval 需報告 mock 與真實供應商兩組結果。
