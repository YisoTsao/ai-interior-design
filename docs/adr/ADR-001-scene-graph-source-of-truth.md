# ADR-001 Scene Graph 為單一事實來源
狀態：接受
日期：2026-09-29
背景：2D 編輯、3D 檢視、AI 渲染、BOM、匯出都需要同一份空間資料。
決策：`scene.json`（契約：`packages/scene-schema/scene.schema.json`）是唯一事實來源；2D、3D、AI 皆為其衍生。相機分兩種：**視埠相機屬 UI 暫態，不入 Scene、不入歷史**；Scene 內的 `cameras[]` 只是「命名視角書籤」，可被儲存與渲染使用。
選項與取捨：否決 2D/3D 雙向同步（易漂移、衝突難解）。
後果：所有修改必須經 Command；AI 生成圖不得回推幾何（平面圖匯入除外）。
