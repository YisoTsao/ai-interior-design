"""點陣路線：尺度行為與回歸下限（下限＝目前實測，模型/演算法更新不得低於；B6.5-5）"""
import cv2
import pytest

from app.raster.pipeline import Hints, parse_raster
from eval.metrics import opening_f1, room_iou, scale_error, wall_iou
from synth.layout import generate_plan
from synth.render import render_plan


def _png(img):
    ok, enc = cv2.imencode(".png", img)
    return enc.tobytes()


def test_hint_scale_is_user_and_mm():
    gt = generate_plan(0)
    r = render_plan(gt, "filled", 0)
    res = parse_raster(_png(r.image), Hints(scaleMmPerPx=r.mm_per_px))
    assert res.units == "mm" and res.scale.method == "user"
    assert scale_error(r, res) == 0


def test_unknown_scale_returns_px_draft_with_suggestion():
    """沒有尺寸標註可讀 → 只回像素草稿，建議值只放 suggestedMmPerPx（不得套用）"""
    gt = generate_plan(1)
    r = render_plan(gt, "filled", 1)
    img = r.image.copy()
    img[:130, :] = 255  # 擦掉上方與左側的尺寸標註
    img[:, :130] = 255
    res = parse_raster(_png(img))
    assert res.scale.method == "unknown" and res.units == "px" and res.scale.mmPerPx is None
    assert any(w.code == "SCALE_UNKNOWN" for w in res.warnings)
    if res.scale.suggestedMmPerPx:
        assert 0.4 < res.scale.suggestedMmPerPx / r.mm_per_px < 2.5


def test_exif_gps_is_stripped_and_orientation_applied():
    from io import BytesIO

    from PIL import Image

    from app.raster.pipeline import load_image

    im = Image.new("L", (40, 20), 255)
    exif = Image.Exif()
    exif[0x0112] = 6  # 旋轉 90°
    exif[0x8825] = {1: "N"}  # GPS
    buf = BytesIO()
    im.save(buf, format="JPEG", exif=exif)
    g = load_image(buf.getvalue())
    assert g.shape == (40, 20)  # 已依 EXIF 轉正（回傳陣列不含任何中繼資料）


def test_too_large_rejected():
    import numpy as np

    big = np.full((10, 9000), 255, np.uint8)
    with pytest.raises(ValueError):
        parse_raster(_png(big))


# 回歸下限（2026-09-30 實測，4 戶型平均；未達 06 §5 的〔假設〕目標，見 PROGRESS 未達標清單）
FLOORS = {"filled": (0.72, 0.88, 0.65), "grey": (0.65, 0.88, 0.65), "sketch": (0.63, 0.88, 0.65)}


@pytest.mark.parametrize("style", sorted(FLOORS))
def test_regression_floor(style):
    import numpy as np

    rows = []
    for seed in range(4):
        gt = generate_plan(seed)
        r = render_plan(gt, style, seed)
        res = parse_raster(_png(r.image))
        rows.append((wall_iou(gt, r, res), opening_f1(gt, r, res)["all"]["f1"], room_iou(gt, r, res)))
    m = np.mean(rows, axis=0)
    w, o, rm = FLOORS[style]
    assert m[0] >= w and m[1] >= o and m[2] >= rm, m
