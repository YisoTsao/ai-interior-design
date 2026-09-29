# ADR-014 點數帳本與冪等邊界
狀態：接受
日期：2026-09-29
背景：原規格未定義結算超額、冪等鍵 TTL、同鍵不同內容、僵屍預扣。
決策：
1. **預扣上限**：`reserve` ＝ 該 Job 在價目表下的最大成本；`settle` 只能退回差額（實際 ≤ 預扣），不允許補扣。餘額因此永不為負（`credit_ledger.balance_after >= 0` 為最後防線）。
2. **帳本冪等鍵**：`{jobId}:{reason}`（如 `…:reserve`）；`UNIQUE(org_id, idempotency_key)` 永久有效，另加 `(job_id, reason)` 對 reserve/settle/refund 的部分唯一索引，確保各只發生一次。
3. **HTTP Idempotency-Key**：存於 `idempotency_keys`，TTL 24 小時。同 key 且 `request_hash` 相同 → 回原回應；同 key 但內容不同 → `422 IDEMPOTENCY_KEY_REUSED`；TTL 後重送視為新請求（不影響帳本，因帳本鍵綁 jobId）。
4. **僵屍預扣**：Job 未進入終態且超過 `2 × 任務逾時` 者，由回收工作標記 failed 並 refund；回收工作本身冪等。
5. **對帳**：帳本加總必須等於 `credit_balances` 快取；容差為 0；不一致觸發告警並停止新預扣（該 org）。
6. **部分退款**：以 `settle` 的差額表達，不另設 partial refund。
7. **組織轉移**：v1 不支援。
後果：需併發測試（同鍵重送只扣一次、失敗必退、重複 settle 被擋、回收工作冪等）。
