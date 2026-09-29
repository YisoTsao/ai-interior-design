# 09 術語表與 ADR

## 術語
| 詞 | 定義 |
|---|---|
| Scene Graph | 專案的唯一事實來源 JSON（樓層、牆、開口、房間、物件、材質引用） |
| Command | 對 Scene 的原子修改，可 do/undo |
| G-buffer | 供 AI 使用的結構訊號圖（color/depth/normal/edge/objectId） |
| Clay 渲染 | 無材質細節的白模渲染，強調形體 |
| 嚴格度 | 結構保持強度：free/balanced/strict，決定 AI 路由 |
| 結構驗證 | 比對輸出圖與 G-buffer 邊緣以偵測結構偏移 |
| 校正模式 | 平面圖辨識後讓使用者確認/修正低信心元素的 UI |
| Provenance | 生成結果的出處記錄（模型、模板、參數、成本…） |
| 點數 Credit | 計費單位；帳本 append-only |
| .idp | 專案檔（zip） |
| 坪 | 台灣面積單位，1 坪 ≈ 3.3058 m² |

## ADR 範本
```
# ADR-NNN 標題
狀態：提議|接受|取代(ADR-xxx)
日期：YYYY-MM-DD
背景：
決策：
選項與取捨：
後果（好/壞/風險）：
```

## 初始 ADR（Claude Code 需在 `docs/adr/` 建立並依實作調整）
- **ADR-001 Scene Graph 為單一事實來源**：2D、3D、AI 皆為衍生；否決雙向同步。
- **ADR-002 Monorepo（pnpm + Turborepo）**：核心套件共用於 Web/Desktop/Server。
- **ADR-003 3D 用 Three.js + R3F；牆體輪廓用 Clipper2；開口用 three-bvh-csg**。
- **ADR-004 後端 TypeScript + CV 用 Python 微服務**：與前端共用型別；CV 生態在 Python。
- **ADR-005 AI Proxy 抽象與多供應商路由**：避免鎖定，支援降級。
- **ADR-006 內部長度單位 mm 整數**：避免浮點累積誤差。
- **ADR-007 桌面端選 Electron**：WebGL 行為一致；Tauri 待體積成為關鍵再評估。
- **ADR-008 資料庫 PostgreSQL + Drizzle（SQL-first）**。
- **ADR-009 點數帳本 append-only 與預扣結算**。
- **ADR-010 2D 引擎選型（Konva vs Pixi）**：Phase 2 以原型比較後決定並記錄。
- **ADR-011 Gate 判定與受阻處理**：硬性 Gate vs 軟性指標；⚠ 受阻規則。
- **ADR-012 結構驗證門檻、重試與失敗處理**：門檻固定、兩層重試、成本上限、失敗後付費。
- **ADR-013 Scene ID、單位、confidence 與上限**：ULID 前綴、Clipper2 縮放與捨入、cameras 書籤、幾何邊界。
- **ADR-014 點數帳本與冪等邊界**：預扣上限、鍵語意、僵屍預扣、對帳。
- **ADR-015 範圍與 Phase 對照**：OIDC、資產件數、多樓層、admin、檔名與路徑。

以上 ADR-001~015 的內文已放在 `assets/adr/`，bootstrap 會複製到 `docs/adr/`。
