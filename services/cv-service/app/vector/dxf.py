"""DXF 向量路線（06 §2）：ezdxf 讀取 → 圖層啟發式 → 雙線牆配對成中心線＋厚度 → 共線合併 →
門弧/窗線填補牆缺口成開口 → 端點吸附（L/T 接點）。

單位由 $INSUNITS 取得；缺失或 0（unitless）→ scale.method='unknown'、units='px'（原始圖面單位），
前端必須校正，不得猜測（06 §6、B6.5-3）。
"""
from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass

import ezdxf
from ezdxf.document import Drawing

from ..model import (
    LabelOut,
    OpeningOut,
    PlanResult,
    Scale,
    Seg,
    WallOut,
    Warning,
    merge_collinear,
    orthogonal_snap,
    project_on,
    snap_endpoints,
)

WALL_RE = re.compile(r"(^|[^a-z])(a-)?wall|牆|墙", re.I)
DOOR_RE = re.compile(r"door|門|门", re.I)
WIN_RE = re.compile(r"window|(^|[^a-z])win([^a-z]|$)|glaz|窗", re.I)

# $INSUNITS → mm
UNIT_MM = {1: 25.4, 2: 304.8, 4: 1.0, 5: 10.0, 6: 1000.0, 14: 100.0}

MAX_ENTITIES = 500_000


@dataclass
class Line:
    a: tuple[float, float]
    b: tuple[float, float]
    layer: str

    @property
    def length(self) -> float:
        return math.dist(self.a, self.b)


@dataclass
class Arc:
    c: tuple[float, float]
    r: float
    layer: str


def _load(data: bytes | str) -> Drawing:
    if isinstance(data, str):
        return ezdxf.readfile(data)
    try:
        return ezdxf.read(io.StringIO(data.decode("utf-8")))
    except UnicodeDecodeError:
        return ezdxf.read(io.StringIO(data.decode("cp1252")))


def _collect(doc: Drawing):
    lines: list[Line] = []
    arcs: list[Arc] = []
    texts: list[tuple[str, tuple[float, float]]] = []
    count = 0

    def visit(e, layer_override: str | None = None):
        nonlocal count
        count += 1
        if count > MAX_ENTITIES:
            raise ValueError("DXF 實體數超過上限")
        t = e.dxftype()
        layer = layer_override if layer_override and e.dxf.layer == "0" else e.dxf.layer
        if t == "LINE":
            lines.append(Line((e.dxf.start.x, e.dxf.start.y), (e.dxf.end.x, e.dxf.end.y), layer))
        elif t in ("LWPOLYLINE", "POLYLINE"):
            pts = [(p[0], p[1]) for p in (e.get_points("xy") if t == "LWPOLYLINE" else [v.dxf.location for v in e.vertices])]
            closed = e.closed if t == "LWPOLYLINE" else e.is_closed
            if closed and len(pts) > 2:
                pts.append(pts[0])
            for p, q in zip(pts, pts[1:]):
                lines.append(Line((p[0], p[1]), (q[0], q[1]), layer))
        elif t == "ARC":
            arcs.append(Arc((e.dxf.center.x, e.dxf.center.y), e.dxf.radius, layer))
        elif t in ("TEXT", "MTEXT"):
            txt = e.dxf.text if t == "TEXT" else e.plain_text()
            ins = e.dxf.insert
            texts.append((txt.strip(), (ins.x, ins.y)))
        elif t == "INSERT":
            for v in e.virtual_entities():
                visit(v, e.dxf.layer)

    for e in doc.modelspace():
        visit(e)
    return lines, arcs, texts


def _pair_walls(lines: list[Line], tmin: float, tmax: float) -> tuple[list[Seg], list[Line]]:
    """雙線牆：平行、間距在 [tmin, tmax]、投影重疊 ≥ 50% → 中心線（重疊區間）＋厚度"""
    segs: list[Seg] = []
    used = set()
    order = sorted(range(len(lines)), key=lambda i: -lines[i].length)
    for i in order:
        p = lines[i]
        if p.length < tmin:
            continue
        L = p.length
        u = ((p.b[0] - p.a[0]) / L, (p.b[1] - p.a[1]) / L)
        best = None
        for j, q in enumerate(lines):
            if j == i or q.length < tmin:
                continue
            ang = abs(math.degrees(math.atan2(q.b[1] - q.a[1], q.b[0] - q.a[0]) - math.atan2(u[1], u[0]))) % 180
            if min(ang, 180 - ang) > 1.0:
                continue
            d1 = (q.a[0] - p.a[0]) * -u[1] + (q.a[1] - p.a[1]) * u[0]
            d2 = (q.b[0] - p.a[0]) * -u[1] + (q.b[1] - p.a[1]) * u[0]
            if abs(d1 - d2) > tmin * 0.2 or not (tmin <= abs(d1) <= tmax):
                continue
            t = lambda pt: (pt[0] - p.a[0]) * u[0] + (pt[1] - p.a[1]) * u[1]
            q0, q1 = sorted((t(q.a), t(q.b)))
            lo, hi = max(0.0, q0), min(L, q1)
            if hi - lo < 0.5 * min(L, q.length):
                continue
            # 取最近的平行線（避免跨房間配對）
            if best is None or abs(d1) < abs(best[0]):
                best = (d1, lo, hi, j)
        if best is None:
            continue
        d, lo, hi, j = best
        key = tuple(sorted((i, j)))
        if key in used:
            continue
        used.add(key)
        n = (-u[1], u[0])
        off = d / 2
        a = (p.a[0] + u[0] * lo + n[0] * off, p.a[1] + u[1] * lo + n[1] * off)
        b = (p.a[0] + u[0] * hi + n[0] * off, p.a[1] + u[1] * hi + n[1] * off)
        segs.append(Seg(a, b, abs(d), 0.95))
    paired = {k for pair in used for k in pair}
    singles = [l for k, l in enumerate(lines) if k not in paired and l.length >= tmin]
    return segs, singles


def _bridge_openings(segs: list[Seg], arcs: list[Arc], win_lines: list[Line], unit: float):
    """共線的牆段之間若有門弧（半徑 ≈ 缺口）或窗線 → 合併成一道牆＋開口；沒有標記的缺口保留。"""
    openings: list[dict] = []
    changed = True
    while changed:
        changed = False
        for i in range(len(segs)):
            for j in range(len(segs)):
                if i == j:
                    continue
                p, q = segs[i], segs[j]
                ang = abs(math.degrees(p.angle - q.angle)) % 180
                if min(ang, 180 - ang) > 2:
                    continue
                t0, d0 = project_on(p, q.a)
                t1, d1 = project_on(p, q.b)
                if max(d0, d1) > max(p.thickness, q.thickness) * 0.3:
                    continue
                # q 在 p 的 b 端之後
                qs, qe = sorted((t0, t1))
                gap = qs - p.length
                if gap <= p.thickness * 0.5 or gap > 3000 * unit:
                    continue
                u = ((p.b[0] - p.a[0]) / p.length, (p.b[1] - p.a[1]) / p.length)
                g0 = p.b
                g1 = (p.a[0] + u[0] * qs, p.a[1] + u[1] * qs)
                kind = None
                swing = "none"
                tol = max(p.thickness, q.thickness) * 1.2
                for arc in arcs:
                    near0 = math.dist(arc.c, g0) - p.thickness / 2
                    near1 = math.dist(arc.c, g1) - p.thickness / 2
                    ta, da = project_on(p, arc.c)
                    if da > tol + p.thickness:
                        continue
                    if abs(arc.r - gap) <= 0.18 * gap and min(near0, near1) <= tol:
                        kind = "door"
                        swing = "left" if near0 <= near1 else "right"
                        break
                if kind is None:
                    for wl in win_lines:
                        m = ((wl.a[0] + wl.b[0]) / 2, (wl.a[1] + wl.b[1]) / 2)
                        tm, dm = project_on(p, m)
                        if p.length < tm < qs and dm <= p.thickness and wl.length >= gap * 0.6:
                            kind = "window"
                            break
                if kind is None:
                    continue
                end = (p.a[0] + u[0] * max(qe, qs), p.a[1] + u[1] * max(qe, qs))
                merged = Seg(p.a, end, max(p.thickness, q.thickness), min(p.confidence, q.confidence), {})
                openings.append({"type": kind, "p0": g0, "p1": g1, "swing": swing})
                segs[i] = merged
                segs.pop(j)
                changed = True
                break
            if changed:
                break
    return segs, openings


def parse_dxf(data: bytes | str, orthogonal: bool = True) -> PlanResult:
    doc = _load(data)
    units = int(doc.header.get("$INSUNITS", 0) or 0)
    mm = UNIT_MM.get(units)
    warnings: list[Warning] = []
    lines, arcs, texts = _collect(doc)
    if not lines:
        raise ValueError("DXF 中沒有線段")

    k = mm if mm else 1.0
    scale_pt = lambda p: (p[0] * k, -p[1] * k)  # DXF y 朝上 → 平面 z 朝下（與 2D 編輯器一致）
    lines = [Line(scale_pt(l.a), scale_pt(l.b), l.layer) for l in lines]
    arcs = [Arc(scale_pt(a.c), a.r * k, a.layer) for a in arcs]
    texts = [(t, scale_pt(p)) for t, p in texts]

    # 圖面單位未知 → 以範圍推估厚度門檻（只影響配對，不當作尺度）
    xs = [c for l in lines for c in (l.a[0], l.b[0])]
    ys = [c for l in lines for c in (l.a[1], l.b[1])]
    extent = max(max(xs) - min(xs), max(ys) - min(ys)) or 1.0
    unit = 1.0 if mm else extent / 10000.0
    tmin, tmax = (40.0, 450.0) if mm else (extent * 0.003, extent * 0.05)

    wall_lines = [l for l in lines if WALL_RE.search(l.layer)]
    door_arcs = [a for a in arcs if DOOR_RE.search(a.layer)] or [a for a in arcs if 450 * unit <= a.r <= 1400 * unit]
    win_lines = [l for l in lines if WIN_RE.search(l.layer)]
    if not wall_lines:
        warnings.append(Warning(code="NO_WALL_LAYER", message="找不到牆圖層，改用所有非門窗線段（信心較低）"))
        wall_lines = [l for l in lines if not DOOR_RE.search(l.layer) and not WIN_RE.search(l.layer)]

    segs, singles = _pair_walls(wall_lines, tmin, tmax)
    default_t = 120.0 * unit
    for s in singles:
        segs.append(Seg(s.a, s.b, default_t, 0.55, {"single": True}))
    if orthogonal:
        segs = orthogonal_snap(segs)
    segs = merge_collinear(segs, gap=tmin, offset_tol=tmin * 0.8)
    segs, ops = _bridge_openings(segs, door_arcs, win_lines, unit)
    segs = snap_endpoints(segs)
    segs = [s for s in segs if s.length >= 100 * unit]

    walls: list[WallOut] = []
    for i, s in enumerate(segs):
        walls.append(WallOut(id=f"w_{i}", a=_r(s.a, mm), b=_r(s.b, mm), thickness=_rt(s.thickness, mm), confidence=round(s.confidence, 3)))
    openings: list[OpeningOut] = []
    for o in ops:
        best = None
        for w, s in zip(walls, segs):
            t0, d0 = project_on(s, o["p0"])
            t1, d1 = project_on(s, o["p1"])
            if max(d0, d1) <= s.thickness and (best is None or d0 + d1 < best[0]):
                best = (d0 + d1, w, s, min(t0, t1), abs(t1 - t0))
        if not best:
            continue
        _, w, s, off, width = best
        openings.append(
            OpeningOut(
                id=f"op_{len(openings)}",
                wallId=w.id,
                type=o["type"],
                offset=_rt(off, mm),
                width=_rt(width, mm),
                height=2100.0 if o["type"] == "door" else 1200.0,
                sill=0.0 if o["type"] == "door" else 900.0,
                swing=o["swing"] if o["type"] == "door" else None,
                confidence=0.9 if o["type"] == "door" else 0.85,
            )
        )
    if not mm:
        warnings.append(Warning(code="SCALE_UNKNOWN", message="DXF 未設定單位（$INSUNITS），請以兩點與實際長度校正尺度"))
    return PlanResult(
        source="vector",
        units="mm" if mm else "px",
        scale=Scale(mmPerPx=1.0 if mm else None, method="dxf_units" if mm else "unknown", confidence=1.0 if mm else 0),
        walls=walls,
        openings=openings,
        labels=[LabelOut(text=t, position=_r(p, mm)) for t, p in texts if t],
        warnings=warnings,
    )


def _r(p, mm) -> tuple[float, float]:
    return (round(p[0]), round(p[1])) if mm else (round(p[0], 3), round(p[1], 3))


def _rt(v: float, mm) -> float:
    return float(round(v)) if mm else round(v, 3)
