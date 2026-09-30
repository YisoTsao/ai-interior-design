import sys, cv2, numpy as np
from synth.layout import generate_plan
from synth.render import render_plan, STYLES
from app.raster.pipeline import parse_raster
from eval.metrics import wall_iou, opening_f1, room_iou, scale_error
n = int(sys.argv[1]) if len(sys.argv) > 1 else 3
tot = []
for st in STYLES:
    rows = []
    for seed in range(n):
        p = generate_plan(seed); r = render_plan(p, st, seed)
        ok, enc = cv2.imencode('.png', r.image)
        try:
            res = parse_raster(enc.tobytes())
        except Exception as e:
            rows.append((0, 0, 0)); print(st, seed, 'ERR', e); continue
        rows.append((wall_iou(p, r, res), opening_f1(p, r, res)['all']['f1'], room_iou(p, r, res)))
    m = np.mean(rows, axis=0); tot.append(m)
    print(f"{st:7s} wallIoU {m[0]:.3f}  openF1 {m[1]:.3f}  roomIoU {m[2]:.3f}")
m = np.mean(tot, axis=0); print(f"ALL     wallIoU {m[0]:.3f}  openF1 {m[1]:.3f}  roomIoU {m[2]:.3f}")
