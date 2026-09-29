#!/usr/bin/env python3
"""檢查 models.yaml 的 verified_at 是否過期。
用法：python check_models.py <models.yaml> [--max-days 30] [--strict]
- verified_at 為 null → 顯示「未驗證」（不算失敗，除非 --strict）
- 超過 max-days → 警告（--strict 時失敗）
只用標準庫；以簡單文字掃描，不需要 PyYAML。
"""
import argparse, re, sys, datetime as dt
from pathlib import Path

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file"); ap.add_argument("--max-days", type=int, default=30); ap.add_argument("--strict", action="store_true")
    a = ap.parse_args()
    today = dt.date.today(); unverified, stale = [], []
    for n, line in enumerate(Path(a.file).read_text(encoding="utf-8").splitlines(), 1):
        if line.lstrip().startswith("#"): continue
        m = re.search(r"verified_at:\s*(null|\"?(\d{4}-\d{2}-\d{2})\"?)", line)
        if not m: continue
        if m.group(1) == "null": unverified.append(n); continue
        age = (today - dt.date.fromisoformat(m.group(2))).days
        if age > a.max_days: stale.append((n, age))
    for n in unverified: print(f"未驗證：{a.file}:{n} verified_at=null")
    for n, age in stale: print(f"過期：{a.file}:{n} 已 {age} 天未核對（>{a.max_days}）")
    bad = bool(stale) or (a.strict and bool(unverified))
    print("✗" if bad else "✓", f"未驗證 {len(unverified)}、過期 {len(stale)}")
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()
