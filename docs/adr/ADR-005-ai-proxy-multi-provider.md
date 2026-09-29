# ADR-005 AI Proxy 抽象與多供應商路由
狀態：接受
日期：2026-09-29
背景：避免供應商鎖定，並支援降級。
決策：`ImageProvider/ChatProvider/VisionProvider` 介面；mock 為一級公民；模型名稱與價格放 `services/api/models.yaml`，`verified_at` 超過 30 天由 `scripts/check_models.py` 警告。
後果：真實供應商項目在無金鑰時標「未驗證」。結構驗證門檻與降級規則見 ADR-012。
