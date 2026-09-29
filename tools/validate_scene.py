#!/usr/bin/env python3
"""驗證 scene.json：JSON Schema + 語意檢查（規則見 ADR-013）。
用法：python validate_scene.py <scene.json> [--schema <scene.schema.json>]
結束碼：0 通過；1 有錯誤。可在 CI 與 Claude Code 中重複呼叫。
"""
import argparse, json, math, sys
from pathlib import Path

def load(p): return json.loads(Path(p).read_text(encoding="utf-8"))

def wall_len(w):
    return math.hypot(w["b"][0] - w["a"][0], w["b"][1] - w["a"][1])

def semantic_errors(scene):
    errs = []
    for lvl in scene.get("levels", []):
        L = lvl["id"]
        wall_ids = [w["id"] for w in lvl["walls"]]
        walls = {w["id"]: w for w in lvl["walls"]}
        all_ids = wall_ids + [o["id"] for o in lvl["openings"]] + [r["id"] for r in lvl["rooms"]] + [o["id"] for o in lvl["objects"]]
        dup = {i for i in all_ids if all_ids.count(i) > 1}
        if dup: errs.append(f"[{L}] 重複的 id：{sorted(dup)}")
        for w in lvl["walls"]:
            if wall_len(w) < 100:
                errs.append(f"[{L}] 牆 {w['id']} 過短（<100mm）")
            elif w["thickness"] >= wall_len(w):
                errs.append(f"[{L}] 牆 {w['id']} 厚度 {w['thickness']} 不得大於等於長度（ADR-013）")
        for o in lvl["openings"]:
            w = walls.get(o["wallId"])
            if not w: errs.append(f"[{L}] 開口 {o['id']} 指向不存在的牆 {o['wallId']}"); continue
            if o["offset"] + o["width"] > wall_len(w) + 1:
                errs.append(f"[{L}] 開口 {o['id']} 超出牆 {w['id']} 長度")
            if o.get("sill", 0) + o["height"] > lvl["height"]:
                errs.append(f"[{L}] 開口 {o['id']} 高度超過樓層高度")
        # 同牆開口不得重疊
        by_wall = {}
        for o in lvl["openings"]: by_wall.setdefault(o["wallId"], []).append(o)
        for wid, ops in by_wall.items():
            ops = sorted(ops, key=lambda x: x["offset"])
            for a, b in zip(ops, ops[1:]):
                if a["offset"] + a["width"] > b["offset"]:
                    errs.append(f"[{L}] 牆 {wid} 上開口 {a['id']} 與 {b['id']} 重疊")
        for r in lvl["rooms"]:
            if len(set(r["wallIds"])) != len(r["wallIds"]):
                errs.append(f"[{L}] 房間 {r['id']} 的 wallIds 有重複")
            for wid in r["wallIds"]:
                if wid not in walls: errs.append(f"[{L}] 房間 {r['id']} 指向不存在的牆 {wid}")
        for ob in lvl["objects"]:
            if ob.get("roomId") and ob["roomId"] not in [r["id"] for r in lvl["rooms"]]:
                errs.append(f"[{L}] 物件 {ob['id']} 指向不存在的房間 {ob['roomId']}")
    cams = scene.get("cameras", [])
    if len({c["id"] for c in cams}) != len(cams): errs.append("相機 id 重複")
    return errs

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scene")
    ap.add_argument("--schema", default=str(Path(__file__).resolve().parent.parent / "packages" / "scene-schema" / "scene.schema.json"))
    a = ap.parse_args()
    try:
        import jsonschema
    except ImportError:
        print("缺少 jsonschema：pip install jsonschema --break-system-packages", file=sys.stderr); sys.exit(2)
    scene, schema = load(a.scene), load(a.schema)
    v = jsonschema.Draft202012Validator(schema)
    errs = [f"schema: /{'/'.join(map(str, e.absolute_path))} {e.message}" for e in sorted(v.iter_errors(scene), key=lambda e: list(e.absolute_path))]
    if not errs: errs += semantic_errors(scene)
    if errs:
        print(f"✗ {a.scene} 有 {len(errs)} 個問題"); [print("  -", e) for e in errs]; sys.exit(1)
    print(f"✓ {a.scene} 通過（schema + 語意）")

if __name__ == "__main__":
    main()
