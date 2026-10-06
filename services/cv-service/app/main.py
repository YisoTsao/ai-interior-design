"""cv-service（06 §1）：POST /v1/parse、GET /healthz。

本服務同步解析並直接回 PlanResult；非同步（Job、進度、重試、退款）由 Node 端 plan_import 任務包裝（06 §1 允許）。
上限（06 §6，〔假設〕）：影像 25MB、長邊 8000px；DXF 50MB、實體 ≤ 500k；超限回 422 UPLOAD_REJECTED。
解析過程不做任何外部網路呼叫。
"""
from __future__ import annotations

import os
from typing import Literal, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .model import PlanResult
from .raster.pipeline import Hints, get_segmenter, parse_raster
from .vector.dxf import parse_dxf

MAX_IMAGE = 25 * 1024 * 1024
MAX_DXF = 50 * 1024 * 1024
IMAGE_MAGIC = (b"\x89PNG", b"\xff\xd8\xff", b"RIFF")

app = FastAPI(title="InteriorAI cv-service", version="0.1.0")
_segmenter = get_segmenter(os.environ.get("SEG_MODEL_PATH"))


def _reject(msg: str, status: int = 422):
    raise HTTPException(status_code=status, detail={"code": "UPLOAD_REJECTED", "message": msg})


def _kind_of(data: bytes, filename: str) -> str:
    head = data[:32]
    if any(head.startswith(m) for m in IMAGE_MAGIC):
        return "raster"
    if filename.lower().endswith(".dwg") or head.startswith(b"AC10"):
        _reject("DWG 不支援（授權與沙箱限制），請轉存為 DXF")
    if head.startswith(b"%PDF"):
        _reject("PDF 平面圖尚未支援（向量 PDF 列入後續），請轉為 DXF 或 PNG/JPG")
    text = head.decode("latin1", "ignore")
    if filename.lower().endswith(".dxf") or text.lstrip().startswith("0") or text.startswith("AutoCAD Binary DXF"):
        return "vector"
    _reject("無法辨識的檔案格式")
    return "raster"


@app.get("/healthz")
def healthz():
    return {"ok": True, "segmenter": _segmenter.name}


@app.post("/v1/parse", response_model=PlanResult)
async def parse(
    file: UploadFile = File(...),
    kind: Literal["auto", "vector", "raster"] = Form("auto"),
    scaleMmPerPx: Optional[float] = Form(None),
    orthogonal: bool = Form(True),
):
    data = await file.read(MAX_DXF + 1)
    if not data:
        _reject("空檔案")
    k = _kind_of(data, file.filename or "") if kind == "auto" else kind
    if k == "raster" and len(data) > MAX_IMAGE:
        _reject("影像超過 25MB")
    if k == "vector" and len(data) > MAX_DXF:
        _reject("DXF 超過 50MB")
    try:
        if k == "vector":
            return parse_dxf(data, orthogonal=orthogonal)
        hint = Hints(scaleMmPerPx=scaleMmPerPx) if scaleMmPerPx and scaleMmPerPx > 0 else None
        return parse_raster(data, hint, _segmenter, orthogonal=orthogonal)
    except HTTPException:
        raise
    except ValueError as e:
        _reject(str(e))
    except Exception as e:  # noqa: BLE001
        return JSONResponse(status_code=422, content={"detail": {"code": "PARSE_FAILED", "message": str(e)[:300]}})
