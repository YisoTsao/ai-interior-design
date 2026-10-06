import { describe, expect, it } from 'vitest';
import { compassToSceneAzimuth, solarPosition } from '../src/sun.js';

describe('solarPosition', () => {
  it('台北夏至正午：太陽接近天頂、偏北（北回歸線以北但很接近）', () => {
    // 2026-06-21 12:00 台北（UTC+8）→ 04:00 UTC
    const p = solarPosition(25.04, 121.56, new Date('2026-06-21T04:00:00Z'));
    expect(p.elevationDeg).toBeGreaterThan(85);
  });
  // 台北太陽正午 ≈ 11:52（經度 121.56° 與均時差）
  it('台北冬至正午：仰角約 41.5°、方位約正南', () => {
    const p = solarPosition(25.04, 121.56, new Date('2025-12-21T03:52:00Z'));
    expect(p.elevationDeg).toBeCloseTo(90 - 25.04 - 23.44, 0);
    expect(Math.abs(p.azimuthDeg - 180)).toBeLessThan(4);
  });
  it('春分早上 6 點前後日出於正東；晚上在地平線下', () => {
    const am = solarPosition(25.04, 121.56, new Date('2026-03-20T22:30:00Z')); // 06:30 +8
    expect(am.elevationDeg).toBeGreaterThan(-2);
    expect(am.elevationDeg).toBeLessThan(10);
    expect(Math.abs(am.azimuthDeg - 90)).toBeLessThan(5);
    expect(solarPosition(25.04, 121.56, new Date('2026-03-20T14:00:00Z')).elevationDeg).toBeLessThan(0);
  });
  it('羅盤→場景方位：南＝+Z(0)、東＝+X(90)、北＝−Z(±180)', () => {
    expect(compassToSceneAzimuth(180)).toBe(0);
    expect(compassToSceneAzimuth(90)).toBe(90);
    expect(Math.abs(compassToSceneAzimuth(0))).toBe(180);
    expect(compassToSceneAzimuth(270)).toBe(-90);
    // 平面圖北方朝右（northDeg=90）時，正東在畫面下方（+Z）
    expect(Math.abs(compassToSceneAzimuth(90, 90))).toBe(180);
  });
});
