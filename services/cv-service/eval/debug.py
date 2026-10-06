"""除錯疊圖：GT（綠）與預測（紅：牆、藍：門、洋紅：窗）"""
import sys, cv2, numpy as np, math
from synth.layout import generate_plan
from synth.render import render_plan
from app.raster.pipeline import parse_raster
from eval.metrics import to_image_px

def overlay(seed, style, out):
    p = generate_plan(seed); r = render_plan(p, style, seed)
    ok, enc = cv2.imencode('.png', r.image)
    res = parse_raster(enc.tobytes())
    img = r.image.copy()
    for w in p.walls:
        a, b = r.to_px(*w.a), r.to_px(*w.b)
        cv2.line(img, tuple(map(int, a)), tuple(map(int, b)), (0, 200, 0), 5)
    f, k = to_image_px(res, r.mm_per_px)
    walls = {w.id: w for w in res.walls}
    for w in res.walls:
        cv2.line(img, tuple(map(int, f(w.a))), tuple(map(int, f(w.b))), (0, 0, 255), 2)
    for o in res.openings:
        w = walls[o.wallId]; L = math.dist(w.a, w.b) or 1
        pt = lambda t: f((w.a[0] + (w.b[0]-w.a[0])*t/L, w.a[1] + (w.b[1]-w.a[1])*t/L))
        c = (255, 0, 0) if o.type == 'door' else (255, 0, 255)
        cv2.line(img, tuple(map(int, pt(o.offset))), tuple(map(int, pt(o.offset+o.width))), c, 4)
    for rm in res.rooms:
        cv2.polylines(img, [np.int32([f(q) for q in rm.polygon])], True, (0, 160, 255), 1)
    cv2.imwrite(out, img)
    print(len(p.walls), len(res.walls), len(p.openings), len(res.openings), res.image)

if __name__ == '__main__':
    overlay(int(sys.argv[1]), sys.argv[2], sys.argv[3])
