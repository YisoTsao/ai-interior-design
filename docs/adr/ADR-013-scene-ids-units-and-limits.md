# ADR-013 Scene ID、單位、confidence 與上限
狀態：接受（上限數值為〔假設〕）
日期：2026-09-29
背景：規則書要求 ULID/UUID，schema 只限制格式（`^[A-Za-z0-9_-]{3,64}$`），範例用 `w_01`；整數 mm 與 Clipper2、旋轉、縮放如何共存未說明。
決策：
1. **ID**：程式產生的 ID 用「前綴_ULID」（如 `w_01J...`）；schema 只驗證格式；`w_01` 這類可讀 ID 僅限 fixtures 與測試。禁止用陣列索引。
2. **長度與位置**：`a/b/position` 為整數 mm，座標範圍 ±1,000,000（1 km）；`position[1]` 為離地高度。`rotationY`、`scale` 為浮點。
3. **Clipper2**：內部以 ×1000（μm）整數運算，輸出時以「四捨五入、0.5 遠離零」回 mm；輪廓頂點去重後再輸出。面積以 mm² 計算（1e6 座標上限下不超過 2^53）。
4. **confidence**：可存在於 Scene 元素（匯入來源）；使用者校正確認後，該元素的 `confidence` 設為 1 並將 `meta.source` 保持原值。完整的 `PlanResult`（含 scale.method、warnings）不進 Scene，只存於 `plan_imports`。
5. **cameras[]**：命名視角書籤；視埠相機為 UI 暫態（見 ADR-001）。
6. **上限（〔假設〕）**：每樓層 walls ≤ 5000、openings ≤ 10000、objects ≤ 5000；超過時 `validateScene` 回錯誤碼 `SCENE_LIMIT_EXCEEDED`。
7. **多樓層**：資料模型支援多層；v1 UI 只編輯單層；樓梯與挑空為非目標。
8. **幾何邊界**：牆長 <100 mm 視為無效；牆厚 ≥ 牆長時拒絕；開口不得跨牆角、不得重疊；`detectRooms` 對未封閉牆圖回空集合並附 `unclosedWallIds`；含洞（天井）房間 v1 不支援，需回報警告。
後果：schema 加入座標範圍與 maxItems；`validate_scene.py` 與 Zod 語意檢查同步。
