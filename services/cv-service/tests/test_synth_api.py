import cv2
from fastapi.testclient import TestClient

from app.main import app
from synth.dxf_writer import write_dxf
from synth.layout import generate_plan
from synth.render import STYLES, render_plan

client = TestClient(app)


def test_synth_deterministic_and_valid():
    a, b = generate_plan(5), generate_plan(5)
    assert a.to_json() == b.to_json()
    ids = {w.id for w in a.walls}
    for o in a.openings:
        w = next(x for x in a.walls if x.id == o.wall_id)
        assert o.wall_id in ids and 0 <= o.offset and o.offset + o.width <= w.length + 1e-6
    assert len(STYLES) >= 5
    for st in STYLES:
        r = render_plan(a, st, 5)
        assert r.image.ndim == 3 and r.mm_per_px > 0


def test_api_health_and_parse(tmp_path):
    assert client.get("/healthz").json()["ok"] is True
    f = tmp_path / "p.dxf"
    write_dxf(generate_plan(0), str(f), "mm")
    r = client.post("/v1/parse", files={"file": ("p.dxf", f.read_bytes(), "application/dxf")})
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "vector" and body["units"] == "mm" and len(body["walls"]) > 4
    img = render_plan(generate_plan(0), "filled", 0).image
    ok, enc = cv2.imencode(".png", img)
    r = client.post("/v1/parse", files={"file": ("p.png", enc.tobytes(), "image/png")}, data={"scaleMmPerPx": "20"})
    assert r.status_code == 200 and r.json()["scale"]["method"] == "user"


def test_api_rejects_dwg_pdf_empty():
    for name, data in (("a.dwg", b"AC1032xxxx"), ("a.pdf", b"%PDF-1.7 ..."), ("x.bin", b"\x00\x01\x02")):
        r = client.post("/v1/parse", files={"file": (name, data, "application/octet-stream")})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "UPLOAD_REJECTED", name
