"""點陣路線（06 §3）：前處理 → 語意分割（可替換：傳統 CV／ONNX 模型）→ 向量化 → 開口 → 房間 → 尺度。

座標：輸出在「轉正後影像」的像素座標，尺度已知時換成 mm（原點＝牆體外框左上角）。
`image.transform` 描述 mm/px → 原圖像素的換算（前端疊圖與評測用）。
"""
from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass
from typing import Optional, Protocol

import cv2
import numpy as np
from PIL import Image, ImageOps
from skimage.morphology import skeletonize

from ..model import (
    LabelOut,
    OpeningOut,
    PlanResult,
    RoomOut,
    Scale,
    Seg,
    WallOut,
    Warning,
    merge_collinear,
    orthogonal_snap,
    project_on,
    snap_endpoints,
)

MAX_SIDE = 8000
Image.MAX_IMAGE_PIXELS = MAX_SIDE * MAX_SIDE  # 壓縮炸彈防護（06 §6）
TYPICAL_DOOR_MM = 850.0


# ── 影像載入與前處理 ───────────────────────────────────────────────


def load_image(data: bytes) -> np.ndarray:
    """讀圖：套用 EXIF 方向後丟棄 EXIF（含 GPS，06 §6）；回傳灰階 uint8"""
    im = Image.open(io.BytesIO(data))
    if max(im.size) > MAX_SIDE:
        raise ValueError(f"影像長邊超過 {MAX_SIDE}px")
    im = ImageOps.exif_transpose(im).convert("L")
    return np.array(im)


def deskew_angle(gray: np.ndarray) -> float:
    """主方向：邊緣的 Hough 線段角度（±20° 內）取長度加權中位數"""
    edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 50, 150)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 720, 60, minLineLength=max(30, min(gray.shape) // 12), maxLineGap=4)
    if lines is None:
        return 0.0
    angs, wts = [], []
    for x1, y1, x2, y2 in lines.reshape(-1, 4):
        a = math.degrees(math.atan2(y2 - y1, x2 - x1))
        a = ((a + 45) % 90) - 45  # 折到 [-45, 45)
        if abs(a) <= 20:
            angs.append(a)
            wts.append(math.hypot(x2 - x1, y2 - y1))
    if not angs:
        return 0.0
    order = np.argsort(angs)
    cum = np.cumsum(np.array(wts)[order])
    return float(np.array(angs)[order][np.searchsorted(cum, cum[-1] / 2)])


def rotate(gray: np.ndarray, deg: float) -> np.ndarray:
    if abs(deg) < 0.05:
        return gray
    h, w = gray.shape
    M = cv2.getRotationMatrix2D((w / 2, h / 2), deg, 1.0)
    return cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_LINEAR, borderValue=255)


# ── 語意分割（可替換介面，06 §3-2） ─────────────────────────────────


class Segmenter(Protocol):
    name: str

    def walls(self, gray: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
        """回傳 (牆 mask, 墨跡 mask, 平均信心)"""


class TraditionalSegmenter:
    """無模型權重時的傳統 CV 分割：二值化 → 閉運算填滿雙線牆 → 開運算移除細線（文字、門弧、尺寸線）。
    閉運算核大小自動挑選：讓「又長又粗」的元件面積最大者。信心固定偏低（0.6–0.75）。"""

    name = "traditional-cv"
    hollow = False

    def walls(self, gray: np.ndarray):
        blur = cv2.GaussianBlur(gray, (3, 3), 0)
        # 墨跡＝深色筆畫；Otsu 門檻上限 150，避免房間底色（淺色填色）被當成墨跡
        otsu, _ = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        _, ink = cv2.threshold(blur, min(otsu, 150), 255, cv2.THRESH_BINARY_INV)
        # 模糊/掃描件的細線（門弧、窗線）可能淡到門檻以上 → 加上局部自適應門檻
        thin = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 18)
        ink = cv2.bitwise_or(ink, thin)
        # 實心牆：細筆畫（文字、尺寸線）在開運算就消失 → 只需濾掉很小的殘塊；
        # 空心牆需閉運算，文字會被糊成塊 → 用較大的長度門檻
        opened = lambda m, frac: _keep_long(
            cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (4, 4))),
            int(min(gray.shape) * frac),
        )
        solid = opened(ink, 0.04)
        # 雙線（空心）牆：閉運算後牆面積大幅增加才採用；實心牆圖用閉運算只會把文字/家具糊成牆
        best = (solid, 0)
        base = max(1, int(solid.sum() // 255))
        for k in (5, 7, 9, 13):
            m = opened(cv2.morphologyEx(ink, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))), 0.13)
            if m.sum() // 255 > base * 1.8 and (best[1] == 0 or m.sum() > best[0].sum() * 1.15):
                best = (m, k)
        self.hollow = best[1] > 0
        conf = 0.72 if best[1] == 0 else 0.62
        return best[0], ink, conf


class OnnxSegmenter:
    """ONNX 分割模型（U-Net/SegFormer 匯出）；權重缺席時由 get_segmenter 退回傳統 CV。
    權重不在 repo 內（授權/資料集未定，docs/licenses.md）。"""

    name = "onnx"

    def __init__(self, path: str):
        import onnxruntime as ort  # noqa: F401 — 僅在有權重時需要

        self.session = ort.InferenceSession(path)

    def walls(self, gray: np.ndarray):  # pragma: no cover - 需模型權重
        x = cv2.resize(gray, (512, 512)).astype(np.float32)[None, None] / 255.0
        prob = self.session.run(None, {self.session.get_inputs()[0].name: x})[0][0, 1]
        prob = cv2.resize(prob, gray.shape[::-1])
        mask = (prob > 0.5).astype(np.uint8) * 255
        _, ink = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        return mask, ink, float(prob[mask > 0].mean()) if mask.any() else 0.0


def get_segmenter(model_path: Optional[str] = None) -> Segmenter:
    if model_path:
        try:
            return OnnxSegmenter(model_path)
        except Exception:  # noqa: BLE001 — 權重或 onnxruntime 缺席
            pass
    return TraditionalSegmenter()


def _keep_long(mask: np.ndarray, min_len: int) -> np.ndarray:
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    keep = np.zeros(n, bool)
    for i in range(1, n):
        w, h = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
        if max(w, h) >= min_len:
            keep[i] = True
    return (keep[lab] * 255).astype(np.uint8)


# ── 向量化 ──────────────────────────────────────────────────────────


def vectorize(mask: np.ndarray) -> tuple[list[Seg], float]:
    dt = cv2.distanceTransform((mask > 0).astype(np.uint8), cv2.DIST_L2, 5)
    sk = skeletonize(mask > 0)
    widths = dt[sk] * 2
    t_px = float(np.median(widths)) if widths.size else 4.0
    lines = cv2.HoughLinesP(
        (sk * 255).astype(np.uint8), 1, np.pi / 360, 12, minLineLength=max(8, int(t_px * 2)), maxLineGap=max(3, int(t_px))
    )
    segs: list[Seg] = []
    if lines is not None:
        for x1, y1, x2, y2 in lines.reshape(-1, 4):
            segs.append(Seg((float(x1), float(y1)), (float(x2), float(y2)), t_px, 0.7))
    segs = orthogonal_snap(segs, 8)
    segs = merge_collinear(segs, gap=t_px * 1.5, offset_tol=max(2.0, t_px * 0.8))
    # 每段厚度與覆蓋率（信心）
    out = []
    for s in segs:
        n = max(4, int(s.length))
        xs = np.clip(np.linspace(s.a[0], s.b[0], n).round().astype(int), 0, mask.shape[1] - 1)
        ys = np.clip(np.linspace(s.a[1], s.b[1], n).round().astype(int), 0, mask.shape[0] - 1)
        on = mask[ys, xs] > 0
        th = float(np.median(dt[ys, xs][on]) * 2) if on.any() else t_px
        s.thickness = max(2.0, th)
        s.confidence = float(0.5 + 0.45 * on.mean())
        out.append(s)
    out = snap_endpoints(out)
    return [s for s in out if s.length >= t_px * 1.2], t_px


def detect_symbols(ink: np.ndarray, mask: np.ndarray, t_px: float) -> list[dict]:
    """直接找門窗符號（不依賴牆段）：
    - 門：牆外的細線元件（門扇＋1/4 弧）外框約為正方形，其中一邊貼在牆線上、該處牆有缺口且兩端外仍有牆
    - 窗：沿牆方向細長、落在牆缺口中的細線元件
    回傳開口（影像座標的兩端點）；呼叫端會把缺口補回牆 mask，讓牆向量化成連續的一道。"""
    thin = cv2.bitwise_and(ink, cv2.bitwise_not(cv2.dilate(mask, np.ones((3, 3), np.uint8))))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(thin, 8)
    t = max(2.0, t_px)
    out = []

    def wall_cov(a, b, pad: float, lo: float, hi: float) -> float:
        return _line_cov(mask, a, b, n=20, r=int(max(1, t / 3)), lo=lo, hi=hi)

    for i in range(1, n):
        x, y, w, h, area = stats[i]
        side, short = max(w, h), min(w, h)
        # 候選開口：外框四邊（門）或長軸中線（窗）
        cands = []
        if 2.5 * t <= side <= 22 * t and short >= 0.7 * side and area < 0.35 * w * h:
            cands += [("door", (x, y), (x + w, y)), ("door", (x, y + h), (x + w, y + h)),
                      ("door", (x, y), (x, y + h)), ("door", (x + w, y), (x + w, y + h))]
        if side >= 2.5 * t and short <= 1.8 * t:
            if w >= h:
                cands.append(("window", (x, y + h / 2), (x + w, y + h / 2)))
            else:
                cands.append(("window", (x + w / 2, y), (x + w / 2, y + h)))
        best = None
        for kind, a, b in cands:
            L = math.dist(a, b)
            u = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
            inside = wall_cov(a, b, 0, 0.15, 0.85)
            ext = lambda p, d: (p[0] + u[0] * d, p[1] + u[1] * d)
            before = _line_cov(mask, ext(a, -2.2 * t), ext(a, -0.8 * t), n=6, r=int(max(1, t / 3)), lo=0, hi=1)
            after = _line_cov(mask, ext(b, 0.8 * t), ext(b, 2.2 * t), n=6, r=int(max(1, t / 3)), lo=0, hi=1)
            sc = (1 - inside) * 0.4 + before * 0.3 + after * 0.3
            if inside < 0.3 and before > 0.6 and after > 0.6 and (best is None or sc > best[0]):
                best = (sc, kind, a, b)
        if best:
            sc, kind, a, b = best
            out.append({"type": kind, "p0": a, "p1": b, "swing": None, "confidence": round(0.55 + 0.4 * sc, 3)})
    return out


def _line_cov(img: np.ndarray, a, b, n: int = 24, r: int = 1, lo: float = 0.1, hi: float = 0.9) -> float:
    ts = np.linspace(lo, hi, n)
    return float(np.mean([_ink_near(img, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r) for t in ts]))


def _classify_gap(ink, mask, g0, g1, t: float):
    """缺口分類：wall→其實是同一道牆被切斷；window→缺口中線有細線；door→鉸鏈端有 1/4 弧＋門扇；none"""
    gap = math.dist(g0, g1)
    if _line_cov(mask, g0, g1, r=0) > 0.35:
        return "wall", 0.0, None
    u = ((g1[0] - g0[0]) / gap, (g1[1] - g0[1]) / gap)
    n = (-u[1], u[0])
    win = max(_line_cov(ink, (g0[0] + n[0] * v, g0[1] + n[1] * v), (g1[0] + n[0] * v, g1[1] + n[1] * v), r=1) for v in (0.0, -t / 2, t / 2))
    best = (0.0, None)
    for hinge, toward, sw in ((g0, u, "left"), (g1, (-u[0], -u[1]), "right")):
        for sgn in (1, -1):
            c = (hinge[0] + n[0] * sgn * t / 2, hinge[1] + n[1] * sgn * t / 2)
            arc = np.mean([
                _ink_near(ink, c[0] + (math.cos(th) * n[0] * sgn + math.sin(th) * toward[0]) * gap,
                          c[1] + (math.cos(th) * n[1] * sgn + math.sin(th) * toward[1]) * gap, 2)
                for th in np.radians(np.linspace(15, 75, 16))
            ])
            leaf = _line_cov(ink, c, (c[0] + n[0] * sgn * gap, c[1] + n[1] * sgn * gap), r=2, lo=0.3, hi=0.9)
            sc = 0.6 * arc + 0.4 * leaf
            if sc > best[0]:
                best = (sc, sw)
    if win >= 0.6 and win >= best[0]:
        return "window", 0.5 + 0.4 * win, None
    if best[0] >= 0.5:
        return "door", 0.5 + 0.45 * best[0], best[1]
    return "none", 0.35, None


def find_openings(segs: list[Seg], ink: np.ndarray, mask: np.ndarray, t_px: float, px_range: tuple[float, float]):
    """開口候選：(1) 共線牆段之間的缺口；(2) 牆的自由端到前方垂直牆之間的缺口（門緊貼 T 接點時）。"""
    ops = []
    seen = set()
    for i, p in enumerate(segs):
        u = ((p.b[0] - p.a[0]) / p.length, (p.b[1] - p.a[1]) / p.length)
        for j, q in enumerate(segs):
            if i == j or (j, i) in seen:
                continue
            ang = abs(math.degrees(p.angle - q.angle)) % 180
            if min(ang, 180 - ang) > 3:
                continue
            t0, d0 = project_on(p, q.a)
            t1, d1 = project_on(p, q.b)
            if max(d0, d1) > max(p.thickness, q.thickness):
                continue
            qs = min(t0, t1)
            gap = qs - p.length
            if not (px_range[0] <= gap <= px_range[1]):
                continue
            g1 = (p.a[0] + u[0] * qs, p.a[1] + u[1] * qs)
            kind, conf, swing = _classify_gap(ink, mask, p.b, g1, p.thickness)
            seen.add((i, j))
            if kind == "window" or kind == "door":
                ops.append({"type": kind, "p0": p.b, "p1": g1, "i": i, "j": j, "swing": swing, "confidence": conf})
            elif kind == "wall":
                ops.append({"type": "wall", "p0": p.b, "p1": g1, "i": i, "j": j})
            else:
                # 'none'：沒有門窗標記的缺口不猜（保留兩段牆、不產生開口），但切房間時要封起來
                ops.append({"type": "gap", "p0": p.b, "p1": g1, "i": i, "j": None, "end": None})
        # 自由端 → 前方的垂直牆
        for end, sign in (("a", -1), ("b", 1)):
            pt = getattr(p, end)
            d = (u[0] * sign, u[1] * sign)
            best = None
            for k, o in enumerate(segs):
                if k == i:
                    continue
                ang = abs(math.degrees(p.angle - o.angle)) % 180
                if min(ang, 180 - ang) < 60:
                    continue
                to, do = project_on(o, pt)
                if to < -o.thickness or to > o.length + o.thickness:
                    continue
                # 沿 d 前進到 o 的中心線距離
                on = (-(o.b[1] - o.a[1]) / o.length, (o.b[0] - o.a[0]) / o.length)
                side = (pt[0] - o.a[0]) * on[0] + (pt[1] - o.a[1]) * on[1]
                speed = -(d[0] * on[0] + d[1] * on[1]) * (1 if side > 0 else -1)
                if speed <= 0.5:
                    continue
                dist = abs(side) / speed - o.thickness / 2
                if px_range[0] <= dist <= px_range[1] and (best is None or dist < best[0]):
                    best = (dist, k)
            if not best:
                continue
            dist, k = best
            g1 = (pt[0] + d[0] * dist, pt[1] + d[1] * dist)
            kind, conf, swing = _classify_gap(ink, mask, pt, g1, p.thickness)
            # 自由端缺口較容易誤判（射線可能穿過整個房間）：門寬需合理、信心要求較高
            if dist > p.thickness * 12 or conf < 0.78 or kind not in ("door", "window"):
                # 不當成開口，但切房間時封起來（不跨越房間：限於門寬範圍）
                if dist <= p.thickness * 12:
                    ops.append({"type": "gap", "p0": pt, "p1": g1, "i": i, "j": None, "end": None})
                continue
            if kind in ("door", "window"):
                if end == "a":
                    swing = {"left": "right", "right": "left"}.get(swing or "", swing)
                ops.append({"type": kind, "p0": pt, "p1": g1, "i": i, "j": None, "end": end, "swing": swing, "confidence": conf})
    return ops


def hollow_windows(segs: list[Seg], ink: np.ndarray, t_px: float, min_len: float) -> list[dict]:
    """雙線（空心）牆的窗：牆中心線上有連續墨跡（窗的中線），長度 ≥ min_len"""
    ops = []
    for i, s in enumerate(segs):
        n = max(8, int(s.length))
        ts = np.linspace(0, 1, n)
        hits = np.array([_ink_near(ink, s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t, 0) for t in ts])
        run_start = None
        for k, h in enumerate(np.append(hits, 0)):
            if h and run_start is None:
                run_start = k
            elif not h and run_start is not None:
                L = (k - run_start) / n * s.length
                if L >= min_len and run_start > 0 and k < n:
                    p0 = (s.a[0] + (s.b[0] - s.a[0]) * ts[run_start], s.a[1] + (s.b[1] - s.a[1]) * ts[run_start])
                    p1 = (s.a[0] + (s.b[0] - s.a[0]) * ts[k - 1], s.a[1] + (s.b[1] - s.a[1]) * ts[k - 1])
                    ops.append({"type": "window", "p0": p0, "p1": p1, "i": i, "j": i, "swing": None, "confidence": 0.7})
                run_start = None
    return ops


def _cross(a, b) -> float:
    return a[0] * b[1] - a[1] * b[0]


def _ink_near(ink: np.ndarray, x: float, y: float, r: int = 2) -> float:
    h, w = ink.shape
    xi, yi = int(round(x)), int(round(y))
    if xi < r or yi < r or xi >= w - r or yi >= h - r:
        return 0.0
    return 1.0 if ink[yi - r : yi + r + 1, xi - r : xi + r + 1].any() else 0.0


def bridge(segs: list[Seg], ops: list[dict]) -> tuple[list[Seg], list[dict]]:
    """開口兩側的牆段合併為一道牆；自由端的門窗 → 把牆延伸到前方牆。'wall' 型缺口只合併、不產生開口。"""
    segs = [Seg(s.a, s.b, s.thickness, s.confidence, dict(s.meta)) for s in segs]
    for o in ops:
        if o["type"] == "gap":
            continue
        if o.get("j") is None:
            s = segs[o["i"]]
            if o["end"] == "b":
                s.b = o["p1"]
            else:
                s.a = o["p1"]
    parent = list(range(len(segs)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for o in ops:
        if o.get("j") is not None and o["j"] != o["i"]:
            parent[find(o["i"])] = find(o["j"])
    groups: dict[int, list[Seg]] = {}
    for k, s in enumerate(segs):
        groups.setdefault(find(k), []).append(s)
    merged = []
    for g in groups.values():
        if len(g) == 1:
            merged.append(g[0])
            continue
        base = max(g, key=lambda s: s.length)
        u = ((base.b[0] - base.a[0]) / base.length, (base.b[1] - base.a[1]) / base.length)
        ts = [project_on(base, pt)[0] * (1 if (pt[0] - base.a[0]) * u[0] + (pt[1] - base.a[1]) * u[1] >= 0 else -1) for s in g for pt in (s.a, s.b)]
        lo, hi = min(ts), max(ts)
        a = (base.a[0] + u[0] * lo, base.a[1] + u[1] * lo)
        b = (base.a[0] + u[0] * hi, base.a[1] + u[1] * hi)
        merged.append(Seg(a, b, float(np.median([s.thickness for s in g])), float(np.mean([s.confidence for s in g]))))
    return merged, [o for o in ops if o["type"] not in ("wall",)]


def find_rooms(mask: np.ndarray, segs: list[Seg], ops: list[dict], t_px: float) -> list[tuple[list[tuple[float, float]], float]]:
    """封閉區域 → 房間多邊形：牆 mask ＋ 把開口封起來，取不碰到影像邊界的空白連通區"""
    closed = mask.copy()
    for o in ops:
        cv2.line(closed, tuple(map(int, o["p0"])), tuple(map(int, o["p1"])), 255, max(2, int(t_px)))
    free = cv2.bitwise_not(cv2.dilate(closed, np.ones((3, 3), np.uint8)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(free, 4)
    h, w = mask.shape
    rooms = []
    min_area = (t_px * 12) ** 2
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if x == 0 or y == 0 or x + bw >= w or y + bh >= h or area < min_area:
            continue
        comp = (lab == i).astype(np.uint8) * 255
        cs, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        c = max(cs, key=cv2.contourArea)
        poly = cv2.approxPolyDP(c, max(2.0, t_px * 0.8), True)[:, 0]
        rect = cv2.minAreaRect(c)
        solidity = area / max(1.0, rect[1][0] * rect[1][1])
        rooms.append(([(float(px), float(py)) for px, py in poly], float(min(0.95, 0.4 + 0.55 * solidity))))
    return rooms


# ── OCR：房名與尺寸標註（06 §3-4） ─────────────────────────────────


def _ocr_words(gray: np.ndarray) -> list[tuple[str, tuple[int, int, int, int]]]:
    try:
        import pytesseract

        d = pytesseract.image_to_data(gray, output_type=pytesseract.Output.DICT, config="--psm 11")
    except Exception:  # noqa: BLE001 — 系統沒有 tesseract → 尺度走校正
        return []
    out = []
    for i, txt in enumerate(d["text"]):
        t = (txt or "").strip()
        if t and float(d["conf"][i]) > 40:
            out.append((t, (d["left"][i], d["top"][i], d["width"][i], d["height"][i])))
    return out


def ocr_scale(gray: np.ndarray, ink: np.ndarray, wall_mask: np.ndarray) -> tuple[Optional[float], float, list]:
    """尺寸數字 N（mm）＋附近平行的細尺寸線長度 L(px) → mm/px = N / L；多個估計取中位數，離散大則降信心。"""
    thin = cv2.bitwise_and(ink, cv2.bitwise_not(cv2.dilate(wall_mask, np.ones((5, 5), np.uint8))))
    lines = cv2.HoughLinesP(thin, 1, np.pi / 360, 40, minLineLength=max(40, min(gray.shape) // 8), maxLineGap=3)
    segs = [] if lines is None else [tuple(map(float, l)) for l in lines.reshape(-1, 4)]
    ests = []
    words = []
    for rot in (0, 1):  # 0：橫向文字；1：轉 90° 讀直向標註
        g = gray if rot == 0 else cv2.rotate(gray, cv2.ROTATE_90_CLOCKWISE)
        for txt, (x, y, w, h) in _ocr_words(g):
            words.append((txt, (x, y, w, h), rot))
            m = re.fullmatch(r"(\d{3,5})", txt.replace(",", ""))
            if not m or not (500 <= int(m.group(1)) <= 40000):
                continue
            val = int(m.group(1))
            if rot == 1:  # 旋轉座標換回原圖
                H = gray.shape[0]
                x, y, w, h = y, H - x - w, h, w
            cx, cy = x + w / 2, y + h / 2
            best = None
            for x1, y1, x2, y2 in segs:
                horiz = abs(y2 - y1) < abs(x2 - x1)
                if horiz != (rot == 0):
                    continue
                L = math.hypot(x2 - x1, y2 - y1)
                mx, my = (x1 + x2) / 2, (y1 + y2) / 2
                d = abs(cy - my) if horiz else abs(cx - mx)
                along = abs(cx - mx) if horiz else abs(cy - my)
                if d < max(w, h) * 2.5 and along < L / 2 and (best is None or d < best[0]):
                    best = (d, L)
            if best:
                ests.append(val / best[1])
    if not ests:
        return None, 0.0, words
    med = float(np.median(ests))
    spread = float(np.max(np.abs(np.array(ests) - med)) / med) if len(ests) > 1 else 0.1
    conf = 0.9 if len(ests) > 1 and spread < 0.03 else 0.6 if spread < 0.1 else 0.3
    return med, conf, words


# ── 主流程 ──────────────────────────────────────────────────────────


@dataclass
class Hints:
    scaleMmPerPx: Optional[float] = None


def parse_raster(data: bytes, hints: Optional[Hints] = None, segmenter: Optional[Segmenter] = None, orthogonal: bool = True) -> PlanResult:
    hints = hints or Hints()
    seg = segmenter or get_segmenter()
    gray0 = load_image(data)
    angle = deskew_angle(gray0)
    gray = rotate(gray0, angle)
    mask, ink, seg_conf = seg.walls(gray)
    warnings: list[Warning] = []
    _, t0 = vectorize(mask)
    symbols = detect_symbols(ink, mask, t0)
    # 把找到的門窗缺口補回牆 mask → 牆向量化成連續的一道（開口之後再指派）
    filled = mask.copy()
    for o in symbols:
        cv2.line(filled, tuple(map(int, o["p0"])), tuple(map(int, o["p1"])), 255, max(2, int(round(t0))))
    segs, t_px = vectorize(filled)
    if not orthogonal:
        pass
    if not segs:
        raise ValueError("影像中找不到牆")
    # 開口尺寸範圍：尺度已知用 mm，未知用牆厚倍數
    mmpp_hint = hints.scaleMmPerPx
    rng = (450 / mmpp_hint, 2600 / mmpp_hint) if mmpp_hint else (t_px * 3, t_px * 28)
    ops = find_openings(segs, ink, filled, t_px, rng)
    if getattr(seg, "hollow", False):
        ops += hollow_windows(segs, ink, t_px, rng[0])
    segs, ops = bridge(segs, ops)
    segs = [s for s in segs if s.length >= t_px * 2.5]
    segs = snap_endpoints(segs)
    rooms = find_rooms(filled, segs, ops, t_px)  # 含未標記缺口：全部封起來再切房間
    ops = [o for o in ops if o["type"] in ("door", "window")]
    # 符號偵測的開口優先；與其重疊的缺口式開口去重
    def overlaps(a, b):
        ca = ((a["p0"][0] + a["p1"][0]) / 2, (a["p0"][1] + a["p1"][1]) / 2)
        cb = ((b["p0"][0] + b["p1"][0]) / 2, (b["p0"][1] + b["p1"][1]) / 2)
        return math.dist(ca, cb) < max(math.dist(a["p0"], a["p1"]), math.dist(b["p0"], b["p1"])) * 0.6
    ops = symbols + [o for o in ops if not any(overlaps(o, s2) for s2 in symbols)]
    # 去重：窗的三條平行線各自是一個元件 → 同一位置只留信心最高的一個
    dedup: list[dict] = []
    for o in sorted(ops, key=lambda x: -x.get("confidence", 0)):
        if not any(overlaps(o, d) for d in dedup):
            dedup.append(o)
    ops = dedup

    # 尺度
    method = "unknown"
    mmpp: Optional[float] = None
    s_conf = 0.0
    words: list = []
    if mmpp_hint:
        method, mmpp, s_conf = "user", float(mmpp_hint), 1.0
    else:
        est, s_conf, words = ocr_scale(gray, ink, mask)
        if est:
            method, mmpp = "dimension_ocr", est
    suggested = None
    doors = [math.dist(o["p0"], o["p1"]) for o in ops if o["type"] == "door"]
    if method == "unknown":
        if doors:
            suggested = round(TYPICAL_DOOR_MM / float(np.median(doors)), 3)
        warnings.append(Warning(code="SCALE_UNKNOWN", message="無法自動判定尺度，請以兩點與實際長度校正"))
    elif s_conf < 0.6:
        warnings.append(Warning(code="SCALE_LOW_CONFIDENCE", message="尺寸標註辨識不一致，建議校正尺度"))

    # 座標：原點＝牆外框左上角；尺度已知 → mm
    xs = [c for s in segs for c in (s.a[0], s.b[0])]
    ys = [c for s in segs for c in (s.a[1], s.b[1])]
    ox, oy = min(xs), min(ys)
    k = mmpp if mmpp else 1.0
    T = lambda p: ((p[0] - ox) * k, (p[1] - oy) * k)
    rnd = (lambda v: float(round(v))) if mmpp else (lambda v: round(v, 2))
    walls = [
        WallOut(id=f"w_{i}", a=tuple(map(rnd, T(s.a))), b=tuple(map(rnd, T(s.b))), thickness=rnd(s.thickness * k), confidence=round(min(s.confidence, 0.95) * (seg_conf / 0.72), 3))
        for i, s in enumerate(segs)
    ]
    openings: list[OpeningOut] = []
    for o in ops:
        best = None
        for w, s in zip(walls, segs):
            t0, d0 = project_on(s, o["p0"])
            t1, d1 = project_on(s, o["p1"])
            if max(d0, d1) <= s.thickness * 1.2 and (best is None or d0 + d1 < best[0]):
                best = (d0 + d1, w, min(t0, t1), abs(t1 - t0))
        if not best:
            continue
        _, w, off, width = best
        openings.append(OpeningOut(
            id=f"op_{len(openings)}", wallId=w.id, type=o["type"], offset=rnd(off * k), width=rnd(width * k),
            height=2100.0 if o["type"] == "door" else 1200.0, sill=0.0 if o["type"] == "door" else 900.0,
            swing=o["swing"] if o["type"] == "door" else None, confidence=round(min(0.95, o["confidence"]), 3),
        ))
    # 房名：OCR 字詞落在房間多邊形內
    room_out = []
    label_words = [(t, (x + w / 2, y + h / 2)) for t, (x, y, w, h), rot in words if rot == 0 and re.fullmatch(r"[A-Za-z一-鿿]{2,}", t)]
    for poly, conf in rooms:
        label = None
        pts = np.array(poly, np.float32)
        for t, c in label_words:
            if cv2.pointPolygonTest(pts, c, False) >= 0:
                label = t
                break
        room_out.append(RoomOut(polygon=[tuple(map(rnd, T(p))) for p in poly], label=label, confidence=round(conf, 3)))
    h, w = gray0.shape
    return PlanResult(
        source="raster",
        units="mm" if mmpp else "px",
        scale=Scale(mmPerPx=mmpp, method=method, confidence=round(s_conf, 3), suggestedMmPerPx=suggested),
        walls=walls,
        openings=openings,
        rooms=room_out,
        labels=[LabelOut(text=t, position=tuple(map(rnd, T(c)))) for t, c in label_words],
        image={"width": w, "height": h, "rotationDeg": round(angle, 3), "originPx": [ox, oy], "segmenter": seg.name, "wallThicknessPx": round(t_px, 2)},
        warnings=warnings,
    )
