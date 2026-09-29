# ADR-008 PostgreSQL + Drizzle（SQL-first）
狀態：接受
日期：2026-09-29
背景：帳本、版本、租戶隔離需要強一致與 RLS。
決策：`db/schema.sql` 為權威 DDL；migration 由它產生；不預設啟用 PostGIS（需要空間索引時另寫 ADR）。
後果：RLS 需在交易內使用 `SET LOCAL app.org_id`（見 04 §2）。
