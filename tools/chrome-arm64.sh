#!/bin/sh
# 本機若 Node/終端機跑在 Rosetta（x86_64），Playwright 會以 x86_64 啟動 universal 版 Chrome，
# JIT 產生的程式碼需經 Rosetta 轉譯，冷啟動慢 10–100 倍。此包裝強制以原生 arm64 啟動。
exec /usr/bin/arch -arm64 "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "$@"
