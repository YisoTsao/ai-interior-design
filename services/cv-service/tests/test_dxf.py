"""DXF 向量路線（Gate：DXF 範例尺寸誤差 ≤ 1%）"""
import math

import pytest

from app.vector.dxf import parse_dxf
from synth.dxf_writer import write_dxf
from synth.layout import generate_plan


def _match_walls(gt, res, k=1.0):
    """每道 GT 牆找中心線最接近的預測牆，回傳長度相對誤差"""
    errs = []
    for w in gt.walls:
        mid = ((w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2)
        best = None
        for p in res.walls:
            pa, pb = (p.a[0] * k, p.a[1] * k), (p.b[0] * k, p.b[1] * k)
            L = math.dist(pa, pb) or 1
            t = ((mid[0] - pa[0]) * (pb[0] - pa[0]) + (mid[1] - pa[1]) * (pb[1] - pa[1])) / L**2
            if not -0.05 <= t <= 1.05:
                continue
            q = (pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t)
            d = math.dist(q, mid)
            if best is None or d < best[0]:
                best = (d, L)
        assert best and best[0] < w.thickness, f"找不到牆 {w.id}"
        errs.append(best[1])
    return errs


@pytest.mark.parametrize("seed", range(8))
def test_dxf_mm_lengths_within_1_percent(tmp_path, seed):
    gt = generate_plan(seed)
    f = tmp_path / "p.dxf"
    write_dxf(gt, str(f), "mm")
    res = parse_dxf(str(f))
    assert res.units == "mm" and res.scale.method == "dxf_units"
    total_gt = sum(w.length for w in gt.walls)
    total = sum(math.dist(w.a, w.b) for w in res.walls)
    assert abs(total - total_gt) / total_gt <= 0.01
    _match_walls(gt, res)
    for kind in ("door", "window"):
        assert sum(o.type == kind for o in res.openings) == sum(o.type == kind for o in gt.openings)
    # 開口寬度誤差 ≤ 1%
    gw = sorted(o.width for o in gt.openings)
    pw = sorted(o.width for o in res.openings)
    assert all(abs(a - b) <= max(10, 0.01 * a) for a, b in zip(gw, pw))
    # 厚度：外牆 200、內牆 120
    assert {round(w.thickness) for w in res.walls} <= {120, 200}


def test_dxf_cm_units_converted(tmp_path):
    gt = generate_plan(3)
    f = tmp_path / "cm.dxf"
    write_dxf(gt, str(f), "cm")
    res = parse_dxf(str(f))
    assert res.units == "mm"
    total_gt = sum(w.length for w in gt.walls)
    assert abs(sum(math.dist(w.a, w.b) for w in res.walls) - total_gt) / total_gt <= 0.01


def test_dxf_unitless_requires_calibration(tmp_path):
    """$INSUNITS=0 → 不得猜測（06 §6）：units=px、method=unknown、警告"""
    gt = generate_plan(1)
    f = tmp_path / "u.dxf"
    write_dxf(gt, str(f), "unitless")
    res = parse_dxf(str(f))
    assert res.units == "px" and res.scale.method == "unknown" and res.scale.mmPerPx is None
    assert any(w.code == "SCALE_UNKNOWN" for w in res.warnings)


def test_dxf_room_labels_from_text(tmp_path):
    gt = generate_plan(2)
    f = tmp_path / "t.dxf"
    write_dxf(gt, str(f), "mm")
    res = parse_dxf(str(f))
    assert sorted(l.text for l in res.labels) == sorted(r.label for r in gt.rooms)


def test_dxf_without_lines_rejected(tmp_path):
    import ezdxf

    doc = ezdxf.new()
    f = tmp_path / "e.dxf"
    doc.saveas(str(f))
    with pytest.raises(ValueError):
        parse_dxf(str(f))
