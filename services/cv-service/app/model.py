"""PlanResult 契約（06 §1）與共用幾何後處理。

座標：平面 (x, z)，單位由 `units` 決定：'mm'（尺度已知）或 'px'（尺度未知，只是草稿，前端必須校正）。
scale.method = 'unknown' 時不得產生最終 Scene（06 §1、B6.5-3）。
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal, Optional

from pydantic import BaseModel, Field

Vec2 = tuple[float, float]
ScaleMethod = Literal["dimension_ocr", "user", "dxf_units", "unknown"]


class WallOut(BaseModel):
    id: str
    a: tuple[float, float]
    b: tuple[float, float]
    thickness: float
    confidence: float = Field(ge=0, le=1)


class OpeningOut(BaseModel):
    id: str
    wallId: str
    type: Literal["door", "window", "passage"]
    offset: float
    width: float
    height: float
    sill: float = 0
    swing: Optional[Literal["left", "right", "none"]] = None
    confidence: float = Field(ge=0, le=1)


class RoomOut(BaseModel):
    polygon: list[tuple[float, float]]
    label: Optional[str] = None
    confidence: float = Field(ge=0, le=1)


class LabelOut(BaseModel):
    text: str
    position: tuple[float, float]


class Scale(BaseModel):
    mmPerPx: Optional[float] = None
    method: ScaleMethod
    confidence: float = 0
    # 尺度未知時的建議值（例如由門寬中位數推估）；只供校正 UI 預填，不得直接套用
    suggestedMmPerPx: Optional[float] = None


class Warning(BaseModel):
    code: str
    message: str


class PlanResult(BaseModel):
    source: Literal["vector", "raster"]
    units: Literal["mm", "px"]
    scale: Scale
    walls: list[WallOut]
    openings: list[OpeningOut]
    rooms: list[RoomOut] = []
    labels: list[LabelOut] = []
    image: Optional[dict] = None  # 點陣：{width, height, rotationDeg}
    warnings: list[Warning] = []


# ── 幾何後處理 ──────────────────────────────────────────────────────


@dataclass
class Seg:
    a: Vec2
    b: Vec2
    thickness: float
    confidence: float = 0.8
    meta: dict = field(default_factory=dict)

    @property
    def length(self) -> float:
        return math.dist(self.a, self.b)

    @property
    def angle(self) -> float:
        return math.atan2(self.b[1] - self.a[1], self.b[0] - self.a[0])


def _dir(s: Seg) -> Vec2:
    L = s.length or 1.0
    return ((s.b[0] - s.a[0]) / L, (s.b[1] - s.a[1]) / L)


def orthogonal_snap(segs: list[Seg], tol_deg: float = 6.0) -> list[Seg]:
    """接近水平/垂直（±tol）的牆吸附成正交（06 §3-3 Manhattan；非直角保留）。"""
    out = []
    for s in segs:
        ang = math.degrees(s.angle) % 180
        if min(ang, 180 - ang) <= tol_deg:
            y = (s.a[1] + s.b[1]) / 2
            out.append(Seg((s.a[0], y), (s.b[0], y), s.thickness, s.confidence, s.meta))
        elif abs(ang - 90) <= tol_deg:
            x = (s.a[0] + s.b[0]) / 2
            out.append(Seg((x, s.a[1]), (x, s.b[1]), s.thickness, s.confidence, s.meta))
        else:
            out.append(s)
    return out


def merge_collinear(segs: list[Seg], gap: float, offset_tol: float, angle_tol_deg: float = 2.0) -> list[Seg]:
    """共線且重疊/相距 < gap 的段合併（06 §2 後處理）。"""
    segs = [s for s in segs if s.length > 0]
    changed = True
    while changed:
        changed = False
        for i in range(len(segs)):
            for j in range(i + 1, len(segs)):
                p, q = segs[i], segs[j]
                d = abs(math.degrees(p.angle - q.angle)) % 180
                if min(d, 180 - d) > angle_tol_deg:
                    continue
                u = _dir(p)
                n = (-u[1], u[0])
                # q 到 p 所在直線的垂直距離
                off = abs((q.a[0] - p.a[0]) * n[0] + (q.a[1] - p.a[1]) * n[1])
                off2 = abs((q.b[0] - p.a[0]) * n[0] + (q.b[1] - p.a[1]) * n[1])
                if max(off, off2) > offset_tol:
                    continue
                t = lambda pt: (pt[0] - p.a[0]) * u[0] + (pt[1] - p.a[1]) * u[1]
                p0, p1 = sorted((0.0, p.length))
                q0, q1 = sorted((t(q.a), t(q.b)))
                if q0 > p1 + gap or p0 > q1 + gap:
                    continue
                lo, hi = min(p0, q0), max(p1, q1)
                a = (p.a[0] + u[0] * lo, p.a[1] + u[1] * lo)
                b = (p.a[0] + u[0] * hi, p.a[1] + u[1] * hi)
                w = (p.length * p.confidence + q.length * q.confidence) / max(1e-9, p.length + q.length)
                th = p.thickness if p.length >= q.length else q.thickness
                segs[i] = Seg(a, b, th, w, {**q.meta, **p.meta})
                segs.pop(j)
                changed = True
                break
            if changed:
                break
    return segs


def snap_endpoints(segs: list[Seg], tol_factor: float = 1.0) -> list[Seg]:
    """端點吸附（容差 ≈ 牆厚）：端點延伸/縮回到最近的另一面牆中心線，形成 L/T 接點。"""
    out = [Seg(s.a, s.b, s.thickness, s.confidence, s.meta) for s in segs]
    for i, s in enumerate(out):
        for end in ("a", "b"):
            pt = getattr(s, end)
            best = None
            for j, o in enumerate(out):
                if i == j:
                    continue
                d1 = abs(math.degrees(s.angle - o.angle)) % 180
                if min(d1, 180 - d1) < 30:  # 只和不平行的牆接
                    continue
                inter = _line_intersection(s.a, s.b, o.a, o.b)
                if inter is None:
                    continue
                # 交點必須落在 o 上（容許超出牆厚）
                u = _dir(o)
                t = (inter[0] - o.a[0]) * u[0] + (inter[1] - o.a[1]) * u[1]
                if t < -o.thickness or t > o.length + o.thickness:
                    continue
                dist = math.dist(pt, inter)
                tol = (max(s.thickness, o.thickness) * 1.5 + 2) * tol_factor
                if dist <= tol and (best is None or dist < best[0]):
                    best = (dist, inter)
            if best:
                setattr(s, end, best[1])
    return out


def _line_intersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2) -> Optional[Vec2]:
    x1, y1 = a
    x2, y2 = b
    x3, y3 = c
    x4, y4 = d
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(den) < 1e-9:
        return None
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
    return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))


def project_on(s: Seg, pt: Vec2) -> tuple[float, float]:
    """回傳 (沿牆位置 t, 垂直距離)"""
    u = _dir(s)
    dx, dy = pt[0] - s.a[0], pt[1] - s.a[1]
    return dx * u[0] + dy * u[1], abs(-dx * u[1] + dy * u[0])
