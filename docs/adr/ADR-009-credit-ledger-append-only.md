# ADR-009 點數帳本 append-only 與預扣結算
狀態：接受（邊界細節見 ADR-014）
日期：2026-09-29
背景：計費是最容易出錯的部分。
決策：`credit_ledger` append-only；流程 reserve → settle/refund；禁止直接更新餘額。
後果：需要併發、冪等、對帳與僵屍預扣回收測試。
