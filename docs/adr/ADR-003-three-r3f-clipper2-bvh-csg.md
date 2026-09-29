# ADR-003 3D 用 Three.js + R3F；牆輪廓 Clipper2；開口 three-bvh-csg
狀態：接受（開口部分由 ADR-016 取代：v1 改用解析式開口，不使用 three-bvh-csg）
日期：2026-09-29
背景：需要可編輯的參數化牆體與開口。
決策：牆輪廓由 core-geometry 以 Clipper2 偏移聯集計算（純函式）；開口在 viewer-3d 用 three-bvh-csg 減法。
後果：Clipper2 使用整數座標，見 ADR-013 的縮放與捨入規則。套件授權需在 licenses.md 核對。
