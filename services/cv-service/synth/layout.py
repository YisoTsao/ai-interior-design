"""合成戶型（06 §4）：以 BSP 切割產生「隨機但合理」的公寓，自動得到標註（牆、門窗、房間、房名）。

- 外牆 200 mm、內牆 120 mm；每道隔間牆一扇門（BSP 樹 → 所有房間連通）；外牆一扇入口門；
- 外牆上避開 T 接點與門的區段加窗；房名依面積：最大＝客廳、最小＝浴室、次小＝廚房、其餘＝臥室。
單位 mm，平面 (x, z)。
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field, asdict

EXT = 200
INT = 120


@dataclass
class GtWall:
    id: str
    a: tuple[float, float]
    b: tuple[float, float]
    thickness: float

    @property
    def length(self) -> float:
        return math.dist(self.a, self.b)


@dataclass
class GtOpening:
    id: str
    wall_id: str
    type: str  # door | window
    offset: float  # 沿牆（a→b）距 a 的起點 mm
    width: float
    height: float
    sill: float
    swing: str = "none"


@dataclass
class GtRoom:
    id: str
    polygon: list[tuple[float, float]]  # 淨地板（扣除半牆厚）
    label: str


@dataclass
class GtPlan:
    walls: list[GtWall] = field(default_factory=list)
    openings: list[GtOpening] = field(default_factory=list)
    rooms: list[GtRoom] = field(default_factory=list)
    width: float = 0
    depth: float = 0

    def to_json(self) -> dict:
        return {
            "width": self.width,
            "depth": self.depth,
            "walls": [asdict(w) for w in self.walls],
            "openings": [asdict(o) for o in self.openings],
            "rooms": [asdict(r) for r in self.rooms],
        }

    @staticmethod
    def from_json(d: dict) -> "GtPlan":
        return GtPlan(
            walls=[GtWall(w["id"], tuple(w["a"]), tuple(w["b"]), w["thickness"]) for w in d["walls"]],
            openings=[GtOpening(**o) for o in d["openings"]],
            rooms=[GtRoom(r["id"], [tuple(p) for p in r["polygon"]], r["label"]) for r in d["rooms"]],
            width=d["width"],
            depth=d["depth"],
        )


def _r100(v: float) -> float:
    return round(v / 100) * 100


def generate_plan(seed: int) -> GtPlan:
    rnd = random.Random(seed)
    W = _r100(rnd.uniform(7000, 13000))
    D = _r100(rnd.uniform(6000, 10000))
    plan = GtPlan(width=W, depth=D)
    ext = [((0, 0), (W, 0)), ((W, 0), (W, D)), ((W, D), (0, D)), ((0, D), (0, 0))]
    for i, (a, b) in enumerate(ext):
        plan.walls.append(GtWall(f"w_ext{i}", a, b, EXT))

    leaves: list[tuple[float, float, float, float]] = []
    splits: list[GtWall] = []

    def split(x0: float, z0: float, x1: float, z1: float, depth: int) -> None:
        w, d = x1 - x0, z1 - z0
        area = w * d / 1e6
        if depth >= 3 or area < rnd.uniform(9, 16) or min(w, d) < 2600:
            leaves.append((x0, z0, x1, z1))
            return
        if w >= d:
            x = _r100(x0 + w * rnd.uniform(0.38, 0.62))
            splits.append(GtWall(f"w_int{len(splits)}", (x, z0), (x, z1), INT))
            split(x0, z0, x, z1, depth + 1)
            split(x, z0, x1, z1, depth + 1)
        else:
            z = _r100(z0 + d * rnd.uniform(0.38, 0.62))
            splits.append(GtWall(f"w_int{len(splits)}", (x0, z), (x1, z), INT))
            split(x0, z0, x1, z, depth + 1)
            split(x0, z, x1, z1, depth + 1)

    split(0, 0, W, D, 0)
    plan.walls += splits

    # 每道牆上的 T 接點（其他牆端點落在此牆上）
    def junctions(w: GtWall) -> list[float]:
        L = w.length
        ux, uz = (w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L
        out = []
        for o in plan.walls:
            if o is w:
                continue
            for p in (o.a, o.b):
                t = (p[0] - w.a[0]) * ux + (p[1] - w.a[1]) * uz
                dist = abs(-(p[0] - w.a[0]) * uz + (p[1] - w.a[1]) * ux)
                if dist < 1 and 1 < t < L - 1:
                    out.append(t)
        return sorted(out)

    def free_spans(w: GtWall, margin: float) -> list[tuple[float, float]]:
        cuts = [0.0, *junctions(w), w.length]
        taken = sorted((o.offset, o.offset + o.width) for o in plan.openings if o.wall_id == w.id)
        spans = []
        for s, e in zip(cuts, cuts[1:]):
            s, e = s + margin, e - margin
            for ts, te in taken:
                if te <= s or ts >= e:
                    continue
                if ts - margin > s:
                    spans.append((s, ts - margin))
                s = te + margin
            if e > s:
                spans.append((s, e))
        return spans

    def place(w: GtWall, typ: str, width: float, height: float, sill: float, margin: float) -> bool:
        spans = [sp for sp in free_spans(w, margin) if sp[1] - sp[0] >= width]
        if not spans:
            return False
        s, e = rnd.choice(spans)
        off = _r100(rnd.uniform(s, e - width)) if e - width > s else s
        off = max(s, min(e - width, off))
        swing = rnd.choice(["left", "right"]) if typ == "door" else "none"
        plan.openings.append(GtOpening(f"op{len(plan.openings)}", w.id, typ, off, width, height, sill, swing))
        return True

    for w in splits:
        place(w, "door", rnd.choice([800, 900]), 2100, 0, 250)
    place(rnd.choice(plan.walls[:4]), "door", 1000, 2100, 0, 400)
    for w in plan.walls[:4]:
        for s, e in free_spans(w, 500):
            if e - s >= 1500 and rnd.random() < 0.85:
                width = _r100(min(e - s, rnd.uniform(1200, 2400)))
                off = _r100(s + (e - s - width) * rnd.uniform(0.2, 0.8))
                plan.openings.append(GtOpening(f"op{len(plan.openings)}", w.id, "window", off, width, 1200, 900))

    # 房間（淨地板）與房名
    def half(x: float, lo: float, hi: float) -> float:
        return (EXT if x in (lo, hi) else INT) / 2

    order = sorted(range(len(leaves)), key=lambda i: (leaves[i][2] - leaves[i][0]) * (leaves[i][3] - leaves[i][1]))
    labels = ["BED"] * len(leaves)
    if leaves:
        labels[order[-1]] = "LIVING"
    if len(leaves) >= 3:
        labels[order[0]] = "BATH"
        labels[order[1]] = "KITCHEN"
    for i, (x0, z0, x1, z1) in enumerate(leaves):
        a = (x0 + half(x0, 0, W), z0 + half(z0, 0, D))
        b = (x1 - half(x1, 0, W), z1 - half(z1, 0, D))
        plan.rooms.append(GtRoom(f"r{i}", [a, (b[0], a[1]), b, (a[0], b[1])], labels[i]))
    return plan
