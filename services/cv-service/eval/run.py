"""評測腳本（06 §5）：合成資料集（N 戶型 × 5 風格）＋ DXF → 指標報告；與 baseline 比較（B6.5-5：主要指標不得低於上一版）。

用法：python -m eval.run [--plans 20] [--out eval/reports/latest] [--update-baseline]
輸出：report.json、report.md
"""
from __future__ import annotations

import argparse
import json
import math
import tempfile
import time
from pathlib import Path

import cv2
import numpy as np

from app.raster.pipeline import parse_raster
from app.vector.dxf import parse_dxf
from eval.metrics import opening_f1, room_iou, scale_error, wall_iou
from synth.dxf_writer import write_dxf
from synth.layout import generate_plan
from synth.render import STYLES, render_plan

HERE = Path(__file__).resolve().parent
BASELINE = HERE / "baseline.json"
# 〔假設〕MVP 目標（06 §5）
TARGETS = {"wall_iou": 0.80, "opening_f1": 0.85}


def run(plans: int) -> dict:
    per_style: dict[str, dict] = {}
    for st in STYLES:
        rows, scales, t0 = [], [], time.time()
        ocr_hits = 0
        for seed in range(plans):
            gt = generate_plan(1000 + seed)
            r = render_plan(gt, st, 1000 + seed)
            ok, enc = cv2.imencode(".png", r.image)
            try:
                res = parse_raster(enc.tobytes())
            except Exception:  # noqa: BLE001
                rows.append((0.0, 0.0, 0.0))
                continue
            f1 = opening_f1(gt, r, res)
            rows.append((wall_iou(gt, r, res), f1["all"]["f1"], room_iou(gt, r, res)))
            se = scale_error(r, res)
            if se is not None:
                ocr_hits += 1
                scales.append(se)
        m = np.mean(rows, axis=0)
        per_style[st] = {
            "wall_iou": round(float(m[0]), 4),
            "opening_f1": round(float(m[1]), 4),
            "room_iou": round(float(m[2]), 4),
            "scale_detect_rate": round(ocr_hits / plans, 4),
            "scale_error_median": round(float(np.median(scales)), 4) if scales else None,
            "sec_per_plan": round((time.time() - t0) / plans, 3),
        }
    overall = {k: round(float(np.mean([v[k] for v in per_style.values()])), 4) for k in ("wall_iou", "opening_f1", "room_iou")}
    # 向量路線：牆長誤差
    errs = []
    with tempfile.TemporaryDirectory() as d:
        for seed in range(plans):
            gt = generate_plan(2000 + seed)
            f = f"{d}/p.dxf"
            write_dxf(gt, f, "mm")
            res = parse_dxf(f)
            tot = sum(w.length for w in gt.walls)
            errs.append(abs(sum(math.dist(w.a, w.b) for w in res.walls) - tot) / tot)
    return {
        "date": time.strftime("%Y-%m-%d"),
        "plans_per_style": plans,
        "segmenter": "traditional-cv",
        "raster": {"overall": overall, "by_style": per_style},
        "vector": {"wall_length_error_max": round(max(errs), 5), "wall_length_error_mean": round(float(np.mean(errs)), 5)},
        "targets": TARGETS,
        "note": "合成資料評測；真實建照圖/DM/手繪/掃描資料集尚未取得（授權與蒐集），真實準確率未驗證",
    }


def compare(report: dict, base: dict) -> list[str]:
    bad = []
    for k in ("wall_iou", "opening_f1", "room_iou"):
        if report["raster"]["overall"][k] + 1e-4 < base["raster"]["overall"][k]:
            bad.append(f"{k}: {report['raster']['overall'][k]} < baseline {base['raster']['overall'][k]}")
    if report["vector"]["wall_length_error_max"] > 0.01:
        bad.append("DXF 牆長誤差 > 1%")
    return bad


def markdown(r: dict) -> str:
    lines = [f"# 平面圖辨識評測（{r['date']}，每風格 {r['plans_per_style']} 張，{r['segmenter']}）", "", r["note"], "",
             "| 風格 | 牆 IoU | 門窗 F1 | 房間 IoU | 尺度自動判定率 | 尺度誤差中位數 | 秒/張 |", "|---|---|---|---|---|---|---|"]
    for st, v in r["raster"]["by_style"].items():
        lines.append(f"| {st} | {v['wall_iou']} | {v['opening_f1']} | {v['room_iou']} | {v['scale_detect_rate']} | {v['scale_error_median']} | {v['sec_per_plan']} |")
    o = r["raster"]["overall"]
    lines += ["", f"**整體**：牆 IoU {o['wall_iou']}（目標 ≥{r['targets']['wall_iou']}）、門窗 F1 {o['opening_f1']}（目標 ≥{r['targets']['opening_f1']}）、房間 IoU {o['room_iou']}",
              f"**DXF**：牆長誤差最大 {r['vector']['wall_length_error_max'] * 100:.3f}%（Gate ≤ 1%）"]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--plans", type=int, default=20)
    ap.add_argument("--out", default=str(HERE / "reports" / "latest"))
    ap.add_argument("--update-baseline", action="store_true")
    a = ap.parse_args()
    rep = run(a.plans)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2))
    (out / "report.md").write_text(markdown(rep))
    print(markdown(rep))
    if a.update_baseline or not BASELINE.exists():
        BASELINE.write_text(json.dumps(rep, ensure_ascii=False, indent=2))
        print("baseline 已更新")
    else:
        problems = compare(rep, json.loads(BASELINE.read_text()))
        if problems:
            print("回歸：", *problems, sep="\n  ")
            raise SystemExit(1)
        print("無回歸")
