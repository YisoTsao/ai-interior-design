"""評測指標（06 §5）：牆 IoU、門窗 precision/recall/F1、房間多邊形 IoU、尺度誤差 %。

比較在「原圖像素」空間進行：GT 以 synth.render 的轉換投影到影像；預測以 PlanResult.image 的
originPx/rotationDeg 與尺度還原到原圖像素。尺度未知時以 GT 尺度模擬「使用者已校正」（另外單獨回報尺度誤差）。
"""
from __future__ import annotations

import math

import cv2
import numpy as np
from shapely.geometry import Polygon

from app.model import PlanResult
from synth.layout import GtPlan
from synth.render import Render


def to_image_px(res: PlanResult, gt_mm_per_px: float):
    """PlanResult 座標 → 原圖像素"""
    im = res.image or {}
    k = res.scale.mmPerPx if res.units == "mm" and res.scale.mmPerPx else (1.0 if res.units == "px" else gt_mm_per_px)
    ox, oy = im.get("originPx", [0, 0])
    w, h = im.get("width", 0), im.get("height", 0)
    ang = im.get("rotationDeg", 0.0)
    M = cv2.getRotationMatrix2D((w / 2, h / 2), ang, 1.0)
    Minv = cv2.invertAffineTransform(M)

    def f(p):
        x, y = p[0] / k + ox, p[1] / k + oy
        return (Minv[0, 0] * x + Minv[0, 1] * y + Minv[0, 2], Minv[1, 0] * x + Minv[1, 1] * y + Minv[1, 2])

    return f, k


def _wall_poly(a, b, t):
    L = math.dist(a, b) or 1
    u = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
    n = (-u[1] * t / 2, u[0] * t / 2)
    ex = (u[0] * t / 2, u[1] * t / 2)
    return np.array(
        [(a[0] - ex[0] + n[0], a[1] - ex[1] + n[1]), (b[0] + ex[0] + n[0], b[1] + ex[1] + n[1]),
         (b[0] + ex[0] - n[0], b[1] + ex[1] - n[1]), (a[0] - ex[0] - n[0], a[1] - ex[1] - n[1])], np.float32)


def wall_iou(gt: GtPlan, r: Render, res: PlanResult) -> float:
    h, w = r.image.shape[:2]
    g = np.zeros((h, w), np.uint8)
    p = np.zeros((h, w), np.uint8)
    for wl in gt.walls:
        a, b = r.to_px(*wl.a), r.to_px(*wl.b)
        cv2.fillPoly(g, [np.int32(np.round(_wall_poly(a, b, wl.thickness / r.mm_per_px)))], 1)
    f, k = to_image_px(res, r.mm_per_px)
    for wl in res.walls:
        cv2.fillPoly(p, [np.int32(np.round(_wall_poly(f(wl.a), f(wl.b), wl.thickness / k)))], 1)
    inter = np.logical_and(g, p).sum()
    union = np.logical_or(g, p).sum()
    return float(inter / union) if union else 0.0


def opening_f1(gt: GtPlan, r: Render, res: PlanResult, tol_mm: float = 400.0) -> dict:
    f, k = to_image_px(res, r.mm_per_px)
    walls = {w.id: w for w in res.walls}

    def gt_centers(kind):
        out = []
        for o in gt.openings:
            if o.type != kind:
                continue
            w = next(x for x in gt.walls if x.id == o.wall_id)
            L = w.length
            t = o.offset + o.width / 2
            out.append(r.to_px(w.a[0] + (w.b[0] - w.a[0]) * t / L, w.a[1] + (w.b[1] - w.a[1]) * t / L))
        return out

    def pr_centers(kind):
        out = []
        for o in res.openings:
            if o.type != kind or o.wallId not in walls:
                continue
            w = walls[o.wallId]
            L = math.dist(w.a, w.b) or 1
            t = o.offset + o.width / 2
            out.append(f((w.a[0] + (w.b[0] - w.a[0]) * t / L, w.a[1] + (w.b[1] - w.a[1]) * t / L)))
        return out

    tol = tol_mm / r.mm_per_px
    result = {}
    tp_all = fp_all = fn_all = 0
    for kind in ("door", "window"):
        g, p = gt_centers(kind), pr_centers(kind)
        used = set()
        tp = 0
        for c in p:
            best = None
            for i, d in enumerate(g):
                if i in used:
                    continue
                dist = math.dist(c, d)
                if dist <= tol and (best is None or dist < best[0]):
                    best = (dist, i)
            if best:
                used.add(best[1])
                tp += 1
        fp, fn = len(p) - tp, len(g) - tp
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        result[kind] = {"precision": prec, "recall": rec, "f1": 2 * prec * rec / (prec + rec) if prec + rec else 0.0}
        tp_all, fp_all, fn_all = tp_all + tp, fp_all + fp, fn_all + fn
    prec = tp_all / (tp_all + fp_all) if tp_all + fp_all else 0.0
    rec = tp_all / (tp_all + fn_all) if tp_all + fn_all else 0.0
    result["all"] = {"precision": prec, "recall": rec, "f1": 2 * prec * rec / (prec + rec) if prec + rec else 0.0}
    return result


def room_iou(gt: GtPlan, r: Render, res: PlanResult) -> float:
    """每個 GT 房間取最佳重疊的預測房間 IoU，取平均（沒配到＝0）"""
    f, _ = to_image_px(res, r.mm_per_px)
    preds = []
    for rm in res.rooms:
        try:
            poly = Polygon([f(p) for p in rm.polygon]).buffer(0)
            if poly.area > 0:
                preds.append(poly)
        except Exception:  # noqa: BLE001
            continue
    scores = []
    for g in gt.rooms:
        gp = Polygon([r.to_px(*p) for p in g.polygon])
        best = 0.0
        for pp in preds:
            inter = gp.intersection(pp).area
            if inter:
                best = max(best, inter / gp.union(pp).area)
        scores.append(best)
    return float(np.mean(scores)) if scores else 0.0


def scale_error(r: Render, res: PlanResult) -> float | None:
    if not res.scale.mmPerPx or res.scale.method == "unknown":
        return None
    return abs(res.scale.mmPerPx - r.mm_per_px) / r.mm_per_px
