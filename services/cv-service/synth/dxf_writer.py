"""把合成戶型寫成 DXF（向量路線測試資料）：A-WALL 雙線牆、A-DOOR 門弧＋門扇、A-WINDOW 窗三線、房名 TEXT。

units：'mm'（$INSUNITS=4）、'cm'（$INSUNITS=5，座標 ÷10）、'unitless'（$INSUNITS=0 → 解析時尺度未知）。
"""
from __future__ import annotations

import math

import ezdxf

from .layout import GtPlan
from .render import _pieces, _wall_frame

UNITS = {"mm": (4, 1.0), "cm": (5, 0.1), "m": (6, 0.001), "unitless": (0, 1.0)}


def write_dxf(plan: GtPlan, path: str, units: str = "mm") -> None:
    code, k = UNITS[units]
    doc = ezdxf.new("R2018")
    doc.header["$INSUNITS"] = code
    for name, color in (("A-WALL", 7), ("A-DOOR", 3), ("A-WINDOW", 5), ("A-TEXT", 2)):
        doc.layers.add(name, color=color)
    msp = doc.modelspace()
    P = lambda x, z: (x * k, -z * k)  # CAD 的 y 朝上＝平面 −z
    ext_ids = {w.id for w in plan.walls[:4]}
    for w in plan.walls:
        u, n = _wall_frame(w)
        h = w.thickness / 2
        ext = h if w.id in ext_ids else 0
        for t0, t1 in _pieces(plan, w):
            t0e = t0 - (ext if t0 == 0 else 0)
            t1e = t1 + (ext if abs(t1 - w.length) < 1e-6 else 0)
            for sgn in (1, -1):
                a = P(w.a[0] + u[0] * t0e + n[0] * h * sgn, w.a[1] + u[1] * t0e + n[1] * h * sgn)
                b = P(w.a[0] + u[0] * t1e + n[0] * h * sgn, w.a[1] + u[1] * t1e + n[1] * h * sgn)
                msp.add_line(a, b, dxfattribs={"layer": "A-WALL"})
    for o in plan.openings:
        w = next(x for x in plan.walls if x.id == o.wall_id)
        u, n = _wall_frame(w)
        h = w.thickness / 2
        at = lambda t, v=0.0: P(w.a[0] + u[0] * t + n[0] * v, w.a[1] + u[1] * t + n[1] * v)
        if o.type == "window":
            for v in (-h, 0, h):
                msp.add_line(at(o.offset, v), at(o.offset + o.width, v), dxfattribs={"layer": "A-WINDOW"})
        else:
            hinge_t = o.offset if o.swing != "right" else o.offset + o.width
            sign = 1 if o.swing != "right" else -1
            c = at(hinge_t, h)
            msp.add_line(c, at(hinge_t, h + o.width), dxfattribs={"layer": "A-DOOR"})
            a0 = math.degrees(math.atan2(n[1], n[0]))
            a1 = math.degrees(math.atan2(u[1] * sign, u[0] * sign))
            s, e = (a0, a1) if (a1 - a0) % 360 <= 180 else (a1, a0)
            msp.add_arc(c, o.width * k, s, e, dxfattribs={"layer": "A-DOOR"})
    for r in plan.rooms:
        cx = sum(p[0] for p in r.polygon) / len(r.polygon)
        cz = sum(p[1] for p in r.polygon) / len(r.polygon)
        msp.add_text(r.label, dxfattribs={"layer": "A-TEXT", "height": 250 * k, "insert": P(cx, cz)})
    doc.saveas(path)
