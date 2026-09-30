import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  close,
  components,
  detectKind,
  distanceTransform,
  gray,
  open,
  otsu,
  recognizeDxf,
  recognizeRaster,
  rgbaToGray,
  simplify,
} from '../src/index.js';
import { decodePng } from './png.js';

const FX = new URL('../../../fixtures/plans/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('synth-filled.json', FX), 'utf8'));
const gt = meta.gt as {
  width: number;
  depth: number;
  walls: unknown[];
  openings: unknown[];
  rooms: unknown[];
};

const extent = (walls: { a: number[]; b: number[] }[]) => {
  const xs = walls.flatMap((w) => [w.a[0]!, w.b[0]!]);
  const ys = walls.flatMap((w) => [w.a[1]!, w.b[1]!]);
  return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
};

describe('影像運算', () => {
  it('Otsu、形態學、連通元件、距離轉換', () => {
    const g = gray(20, 10);
    g.data.fill(240);
    for (let y = 3; y < 7; y++) for (let x = 2; x < 18; x++) g.data[y * 20 + x] = 10;
    const t = otsu(g);
    expect(t).toBeGreaterThanOrEqual(10);
    expect(t).toBeLessThan(240);
    const m = gray(20, 10);
    for (let i = 0; i < 200; i++) m.data[i] = g.data[i]! <= t ? 255 : 0;
    const { stats } = components(m);
    expect(stats).toHaveLength(2);
    expect(stats[1]).toMatchObject({ x: 2, y: 3, w: 16, h: 4, area: 64 });
    // 開運算移除 1px 雜點、閉運算補 1px 缺口
    m.data[0] = 255;
    expect(open(m, 3).data[0]).toBe(0);
    m.data[3 * 20 + 9] = 0;
    expect(close(m, 3).data[3 * 20 + 9]).toBe(255);
    const dt = distanceTransform(m);
    expect(dt[5 * 20 + 10]).toBeCloseTo(2);
    expect(dt[0]).toBeCloseTo(1);
  });
  it('Douglas–Peucker 把矩形輪廓簡化成 4 點', () => {
    const pts: [number, number][] = [];
    for (let x = 0; x < 10; x++) pts.push([x, 0]);
    for (let y = 0; y < 5; y++) pts.push([10, y]);
    for (let x = 10; x > 0; x--) pts.push([x, 5]);
    for (let y = 5; y > 0; y--) pts.push([0, y]);
    expect(simplify(pts, 0.5)).toHaveLength(4);
  });
  it('格式判斷', () => {
    expect(detectKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'a.png')).toBe('raster');
    expect(detectKind(new TextEncoder().encode('  0\nSECTION'), 'a.dxf')).toBe('vector');
    expect(() => detectKind(new TextEncoder().encode('%PDF-1.4'), 'a.pdf')).toThrow(/PDF/);
    expect(() => detectKind(new TextEncoder().encode('AC1032'), 'a.dwg')).toThrow(/DWG/);
  });
});

describe('點陣平面圖（瀏覽器版，對照 cv-service 的 P5 Gate）', () => {
  const png = decodePng(readFileSync(new URL('synth-filled.png', FX)));
  const r = recognizeRaster(rgbaToGray(png.rgba, png.width, png.height));
  const [p0, p1] = [meta.calibration.p0, meta.calibration.p1] as [number, number][];
  const mmPerPx = meta.calibration.mm / Math.hypot(p1![0]! - p0![0]!, p1![1]! - p0![1]!);

  it('尺度未知：units=px、必須校正，並依門寬預填建議值', () => {
    expect(r.units).toBe('px');
    expect(r.scale.method).toBe('unknown');
    expect(r.warnings.map((w) => w.code)).toContain('SCALE_UNKNOWN');
    expect(r.scale.suggestedMmPerPx).toBeGreaterThan(mmPerPx * 0.6);
    expect(r.scale.suggestedMmPerPx).toBeLessThan(mmPerPx * 1.6);
  });
  it('牆、門窗、房間數量與外框尺寸（誤差 ≤ 3%）', () => {
    expect(r.walls.length).toBeGreaterThanOrEqual(gt.walls.length - 3);
    expect(r.openings.length).toBeGreaterThanOrEqual(gt.openings.length - 3);
    expect(r.rooms.length).toBeGreaterThanOrEqual(gt.rooms.length - 2);
    const e = extent(r.walls);
    expect(Math.abs(e.w * mmPerPx - gt.width) / gt.width).toBeLessThan(0.03);
    expect(Math.abs(e.d * mmPerPx - gt.depth) / gt.depth).toBeLessThan(0.03);
    for (const o of r.openings) expect(r.walls.some((w) => w.id === o.wallId)).toBe(true);
  });
  it('已知尺度直接輸出 mm', () => {
    const m = recognizeRaster(rgbaToGray(png.rgba, png.width, png.height), { scaleMmPerPx: mmPerPx });
    expect(m.units).toBe('mm');
    expect(Math.abs(extent(m.walls).w - gt.width) / gt.width).toBeLessThan(0.03);
  });
});

describe('DXF', () => {
  it('有單位：牆與門窗完全一致、文字標籤', () => {
    const r = recognizeDxf(readFileSync(new URL('synth-mm.dxf', FX), 'utf8'));
    expect(r.units).toBe('mm');
    expect(r.scale.method).toBe('dxf_units');
    expect(r.openings).toHaveLength(gt.openings.length);
    expect(r.labels.length).toBe(gt.rooms.length);
    const e = extent(r.walls);
    expect(Math.abs(e.w - gt.width) / gt.width).toBeLessThan(0.01);
    expect(Math.abs(e.d - gt.depth) / gt.depth).toBeLessThan(0.01);
  });
  it('無單位：units=px、SCALE_UNKNOWN', () => {
    const r = recognizeDxf(readFileSync(new URL('synth-unitless.dxf', FX), 'utf8'));
    expect(r.units).toBe('px');
    expect(r.warnings.map((w) => w.code)).toContain('SCALE_UNKNOWN');
    expect(r.walls.length).toBeGreaterThan(5);
  });
});
