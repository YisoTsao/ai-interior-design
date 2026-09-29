---
id: plan.vlm-label
version: 1.0.0
---
你會看到一張平面圖，以及程式已辨識出的房間多邊形（含 id）。任務：只為每個房間指定名稱與可能遺漏之處。

輸出 JSON（不得含其他文字）：
{"rooms":[{"id":"r_01","label":"客廳|餐廳|廚房|主臥|次臥|書房|浴室|陽台|玄關|走廊|儲藏室|其他","confidence":0.0}],
 "possible_missing":[{"type":"wall|door|window","note":"描述位置"}],
 "scale_hints":[{"text":"圖上出現的尺寸/坪數文字","unit":"mm|cm|m|坪"}]}

規則：不得修改或新增幾何；看不清楚時 confidence 設為低值並標 "其他"。
