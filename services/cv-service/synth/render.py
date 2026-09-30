"""合成平面圖繪製（06 §4：≥5 種繪圖風格）。回傳影像與 plan→image 轉換，供評測對齊。

風格：
- cad：雙細線牆、門弧＋門扇、窗三線（CAD 輸出）
- filled：實心黑牆（建案 DM 常見）＋房名
- grey：灰色實心牆＋房間底色＋尺寸標註
- sketch：手繪抖動線條、鉛筆雜訊
- scan：filled 再加旋轉 1–3°、模糊、雜訊、紙張色、JPEG 壓縮（掃描件）
所有風格都在外側畫總寬/總深尺寸標註（數字 mm），供 OCR 尺度估計。
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass

import cv2
import numpy as np

from .layout import GtOpening, GtPlan, GtWall

STYLES = ["cad", "filled", "grey", "sketch", "scan"]


@dataclass
class Render:
    image: np.ndarray  # BGR uint8
    mm_per_px: float
    margin: float
    rotation_deg: float
    style: str

    def to_px(self, x: float, z: float) -> tuple[float, float]:
        """plan (mm) → image (px)，含掃描旋轉"""
        px = x / self.mm_per_px + self.margin
        py = z / self.mm_per_px + self.margin
        if self.rotation_deg:
            h, w = self.image.shape[:2]
            cx, cy = w / 2, h / 2
            t = math.radians(self.rotation_deg)
            dx, dy = px - cx, py - cy
            px, py = cx + dx * math.cos(t) - dy * math.sin(t), cy + dx * math.sin(t) + dy * math.cos(t)
        return px, py

    def meta(self) -> dict:
        h, w = self.image.shape[:2]
        return {"mm_per_px": self.mm_per_px, "margin": self.margin, "rotation_deg": self.rotation_deg,
                "style": self.style, "width": w, "height": h}


def _pieces(plan: GtPlan, w: GtWall) -> list[tuple[float, float]]:
    """牆扣掉開口後的實心段（沿牆 t 範圍）"""
    ops = sorted((o.offset, o.offset + o.width) for o in plan.openings if o.wall_id == w.id)
    out, t = [], 0.0
    for s, e in ops:
        if s > t:
            out.append((t, s))
        t = max(t, e)
    if w.length > t:
        out.append((t, w.length))
    return out


def _wall_frame(w: GtWall):
    L = w.length
    u = ((w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L)
    n = (-u[1], u[0])
    return u, n


def render_plan(plan: GtPlan, style: str, seed: int = 0) -> Render:
    rnd = random.Random(seed * 31 + STYLES.index(style))
    s = rnd.uniform(16, 26)  # mm/px
    margin = 140.0
    W = int(plan.width / s + 2 * margin)
    H = int(plan.depth / s + 2 * margin)
    paper = (245, 242, 235) if style in ("sketch", "scan") else (255, 255, 255)
    img = np.full((H, W, 3), paper, np.uint8)
    P = lambda x, z: (x / s + margin, z / s + margin)
    ext_ids = {w.id for w in plan.walls[:4]}

    def jitter(pts: np.ndarray) -> np.ndarray:
        if style != "sketch":
            return pts
        return pts + np.array([[rnd.uniform(-1.5, 1.5), rnd.uniform(-1.5, 1.5)] for _ in pts])

    # 房間底色（grey 風格）
    if style == "grey":
        palette = [(222, 236, 244), (230, 240, 226), (244, 234, 222), (236, 228, 244)]
        for i, r in enumerate(plan.rooms):
            pts = np.array([P(*p) for p in r.polygon], np.int32)
            cv2.fillPoly(img, [pts], palette[i % len(palette)])

    ink = (30, 30, 30)
    wall_fill = {"filled": (20, 20, 20), "scan": (25, 25, 25), "grey": (90, 90, 90), "sketch": (60, 60, 60)}
    for w in plan.walls:
        u, n = _wall_frame(w)
        h = w.thickness / 2
        # 外牆的實心段在兩端延伸半牆厚，讓轉角封閉
        ext = h if w.id in ext_ids else 0
        for t0, t1 in _pieces(plan, w):
            t0e = t0 - (ext if t0 == 0 else 0)
            t1e = t1 + (ext if abs(t1 - w.length) < 1e-6 else 0)
            quad = []
            for t, sgn in ((t0e, 1), (t1e, 1), (t1e, -1), (t0e, -1)):
                x = w.a[0] + u[0] * t + n[0] * h * sgn
                z = w.a[1] + u[1] * t + n[1] * h * sgn
                quad.append(P(x, z))
            q = jitter(np.array(quad))
            if style == "cad":
                cv2.line(img, tuple(np.int32(q[0])), tuple(np.int32(q[1])), ink, 1, cv2.LINE_AA)
                cv2.line(img, tuple(np.int32(q[3])), tuple(np.int32(q[2])), ink, 1, cv2.LINE_AA)
            else:
                cv2.fillPoly(img, [np.int32(np.round(q))], wall_fill[style], cv2.LINE_AA)

    for o in plan.openings:
        _draw_opening(img, plan, o, P, s, style, ink)

    # 房名
    if style in ("filled", "grey", "scan", "cad"):
        for r in plan.rooms:
            cx = sum(p[0] for p in r.polygon) / 4
            cz = sum(p[1] for p in r.polygon) / 4
            x, y = P(cx, cz)
            cv2.putText(img, r.label, (int(x) - 25, int(y)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, ink, 1, cv2.LINE_AA)

    _dimensions(img, plan, P, ink)

    rot = 0.0
    if style == "sketch":
        noise = np.random.default_rng(seed).normal(0, 6, img.shape).astype(np.int16)
        img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    if style == "scan":
        rot = rnd.uniform(1.0, 3.0) * rnd.choice([-1, 1])
        M = cv2.getRotationMatrix2D((W / 2, H / 2), -rot, 1.0)
        img = cv2.warpAffine(img, M, (W, H), borderValue=paper)
        img = cv2.GaussianBlur(img, (3, 3), 0.8)
        noise = np.random.default_rng(seed).normal(0, 7, img.shape).astype(np.int16)
        img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
        ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 55])
        img = cv2.imdecode(enc, cv2.IMREAD_COLOR)
    return Render(img, s, margin, rot, style)


def _draw_opening(img, plan: GtPlan, o: GtOpening, P, s: float, style: str, ink) -> None:
    w = next(x for x in plan.walls if x.id == o.wall_id)
    u, n = _wall_frame(w)
    h = w.thickness / 2
    at = lambda t, v=0.0: P(w.a[0] + u[0] * t + n[0] * v, w.a[1] + u[1] * t + n[1] * v)
    lw = 1
    if o.type == "window":
        for v in (-h, 0, h):
            a, b = at(o.offset, v), at(o.offset + o.width, v)
            cv2.line(img, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])), ink, lw, cv2.LINE_AA)
    else:
        # 門：門扇＋ 90° 弧（鉸鏈在開口一端，開向牆的 +n 側）
        hinge_t = o.offset if o.swing != "right" else o.offset + o.width
        sign = 1 if o.swing != "right" else -1
        hx, hy = at(hinge_t, h)
        r = o.width / s
        leaf_end = P(w.a[0] + u[0] * hinge_t + n[0] * (h + o.width), w.a[1] + u[1] * hinge_t + n[1] * (h + o.width))
        cv2.line(img, (int(hx), int(hy)), (int(leaf_end[0]), int(leaf_end[1])), ink, lw, cv2.LINE_AA)
        a0 = math.degrees(math.atan2(n[1], n[0]))
        a1 = math.degrees(math.atan2(u[1] * sign, u[0] * sign))
        start, end = sorted((a0, a1))
        if end - start > 180:
            start, end = end, start + 360
        cv2.ellipse(img, (int(hx), int(hy)), (int(r), int(r)), 0, start, end, ink, lw, cv2.LINE_AA)


def _dimensions(img, plan: GtPlan, P, ink) -> None:
    """外側總寬/總深尺寸線（兩端短斜線）＋數字（mm）"""
    off = 70  # px（在牆外）
    x0, y0 = P(0, 0)
    x1, y1 = P(plan.width, plan.depth)
    yt = int(y0 - off)
    cv2.line(img, (int(x0), yt), (int(x1), yt), ink, 1)
    for x in (x0, x1):
        cv2.line(img, (int(x) - 6, yt + 6), (int(x) + 6, yt - 6), ink, 1)
    label = str(int(plan.width))
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
    cv2.putText(img, label, (int((x0 + x1) / 2 - tw / 2), yt - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, ink, 2, cv2.LINE_AA)
    xl = int(x0 - off)
    cv2.line(img, (xl, int(y0)), (xl, int(y1)), ink, 1)
    for y in (y0, y1):
        cv2.line(img, (xl - 6, int(y) + 6), (xl + 6, int(y) - 6), ink, 1)
    label = str(int(plan.depth))
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
    # 直向標註：畫在旋轉的子圖再貼回
    tile = np.full((th + 12, tw + 8, 3), img[int((y0 + y1) / 2), 5].tolist(), np.uint8)
    cv2.putText(tile, label, (4, th + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.7, ink, 2, cv2.LINE_AA)
    tile = cv2.rotate(tile, cv2.ROTATE_90_COUNTERCLOCKWISE)
    ty = int((y0 + y1) / 2 - tile.shape[0] / 2)
    tx = xl - 12 - tile.shape[1]
    if tx > 0 and ty > 0 and ty + tile.shape[0] < img.shape[0]:
        img[ty : ty + tile.shape[0], tx : tx + tile.shape[1]] = tile
