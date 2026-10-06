"""產生 repo 內的固定測試檔（fixtures/plans/）：整合測試與 E2E 用。"""
import json
from pathlib import Path

import cv2

from synth.dxf_writer import write_dxf
from synth.layout import generate_plan
from synth.render import render_plan

out = Path(__file__).resolve().parents[3] / "fixtures" / "plans"
out.mkdir(parents=True, exist_ok=True)
p = generate_plan(1)
r = render_plan(p, "filled", 1)
cv2.imwrite(str(out / "synth-filled.png"), r.image)
# 標註＋兩個可在影像上點選的校正點（外框左上、右上角的牆中心線）與實際距離
a = r.to_px(0, 0)
b = r.to_px(p.width, 0)
meta = {**r.meta(), "gt": p.to_json(), "calibration": {"p0": a, "p1": b, "mm": p.width}}
(out / "synth-filled.json").write_text(json.dumps(meta, indent=1))
write_dxf(p, str(out / "synth-mm.dxf"), "mm")
write_dxf(p, str(out / "synth-unitless.dxf"), "unitless")
print("fixtures →", out)
