# 00 文件缺口盤點（Gap Analysis）

目的：在「規格需求、前端、後端、所有技術文件」開工前，確認文件集是否完整。下表是對先前成果（市場分析報告 + 規則書，即 `10-report-and-rulebook.md`）逐項盤點的結果。**「缺」和「部分」的項目已在本 skill 的 references/ 與 assets/ 補齊**，Claude Code 在 Phase 0 需把它們複製並客製化到目標專案的 `docs/`。

| # | 文件類別 | 先前狀態 | 補齊位置 | 為什麼需要 |
|---|---|---|---|---|
| 1 | 產品需求文件 PRD（角色、使用者故事、需求編號、非目標） | 缺 | `01-prd.md` | 沒有需求編號就無法追蹤測試與驗收 |
| 2 | Backlog（Epic → Story） | 缺 | `01-prd.md` 附錄 | Claude Code 需要可逐項勾選的工作單位 |
| 3 | UX 規格：資訊架構、畫面清單、流程、設計系統、空/錯誤狀態、i18n、無障礙 | 缺 | `02-ux-spec.md` | 前端沒有畫面規格會各自發揮，風格與流程不一致 |
| 4 | 前端技術設計：套件 API、狀態與 Command、渲染迴圈、G-buffer 輸出 | 部分（僅選型） | `03-frontend-design.md` | 核心難點（牆體幾何、G-buffer）需明確演算法 |
| 5 | 桌面端設計：Electron IPC、檔案格式、離線、自動更新 | 缺 | `03-frontend-design.md` §桌面 | 桌面版的安全與離線行為要先定 |
| 6 | 後端設計：模組、認證/RBAC、任務狀態機、點數帳本、儲存佈局、錯誤碼 | 部分 | `04-backend-design.md` | 計費與任務是最容易出錯的部分 |
| 7 | 資料庫 Schema（DDL） | 缺 | `assets/db/schema.sql` | 前後端契約的基礎 |
| 8 | API 規格（OpenAPI） | 缺 | `assets/openapi.skeleton.yaml` | 前後端可平行開發、可做 contract test |
| 9 | Scene Graph JSON Schema | 只有範例 | `assets/scene.schema.json` | 唯一事實來源，需可機器驗證 |
| 10 | AI 設計：Provider 介面、路由、Prompt、結構驗證、評測、成本模型 | 部分 | `05-ai-design.md` + `assets/prompts/` + `assets/models.yaml` | AI 管線需可重現、可評測 |
| 11 | CV 服務：API、管線、資料集、合成資料、訓練、部署 | 部分 | `06-cv-design.md` | 辨識準確率是最大風險 |
| 12 | 資產管線與目錄 Schema | 部分（僅檢查表） | `07-asset-pipeline.md` | 資產庫是護城河，也是授權風險來源 |
| 13 | DevOps：環境、CI/CD、IaC、可觀測性、備份、成本 | 缺 | `08-devops-security-qa.md` + `assets/docker-compose.yml` + `assets/ci/` | 沒有它無法交付 |
| 14 | 威脅模型與隱私資料地圖 | 部分（僅原則） | `08-devops-security-qa.md` | 住家平面圖屬敏感資料 |
| 15 | 測試計畫（單元/整合/E2E/效能/無障礙/AI 評測） | 部分 | `08-devops-security-qa.md` | 完成定義需要可執行的測試 |
| 16 | 分析事件與 KPI 追蹤表 | 缺 | `08-devops-security-qa.md` | 驗證商業假設 |
| 17 | 營運 Runbook、法務文件大綱 | 缺 | `08-devops-security-qa.md` | 上線後的事故與合規 |
| 18 | 術語表、ADR 範本與初始決策 | 缺 | `09-glossary-adr.md` | 避免決策失憶 |
| 19 | 授權登記表 | 只有規則 | `assets/templates/licenses.md` | 資料集/模型/素材/套件授權 |
| 20 | 進度追蹤檔（跨 session 續作） | 缺 | `assets/templates/PROGRESS.md` | Claude Code 對話會壓縮，需要外部記憶 |
| ✔ | 市場分析、AI 策略、功能 F1–F8、規則書 B1–B12 | 已涵蓋 | `10-report-and-rulebook.md` | — |

## 仍無法由文件解決、需要人決定的事項（Claude Code 遇到時記錄並用預設值繼續）
1. 產品名稱與品牌（預設：`InteriorAI`，可改）。
2. AI 供應商金鑰與預算（沒有金鑰時使用 mock provider 完成全流程開發與測試）。
3. 雲端供應商與網域（預設：本機 docker-compose 完整可跑；雲端部署檔只產生 Terraform 骨架）。
4. 首批資產的授權來源（預設：先用自產的參數化模組與 CC0 素材；商品模型需人工確認授權）。
5. 法務文件（ToS/隱私政策）只產生草稿大綱，**必須由法務審閱**。
