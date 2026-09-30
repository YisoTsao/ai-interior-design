import { describe, expect, it } from 'vitest';
import { luxAt, illuminance, luxColor } from '../src/ai/illuminance';
import { buildSampleScene } from '../src/sample';
import { catalog } from '../src/catalogData';

describe('illuminance', () => {
  it('點光源 1000 lm、正下方 2 m → I/d² ≈ 19.9 lx；平方反比', () => {
    const l = {
      id: 'a',
      kind: 'point' as const,
      position: [0, 2000, 0] as [number, number, number],
      direction: [0, -1, 0] as [number, number, number],
      color: '#fff',
      lumens: 1000,
      castShadow: false,
      ceiling: true,
      source: 'fixture' as const,
    };
    expect(luxAt([l], [0, 0, 0])).toBeCloseTo(1000 / (4 * Math.PI) / 4, 1);
    expect(luxAt([{ ...l, position: [0, 4000, 0] }], [0, 0, 0])).toBeCloseTo(luxAt([l], [0, 0, 0]) / 4, 2);
  });
  it('聚光：光束內高、光束外 0', () => {
    const s = {
      id: 's',
      kind: 'spot' as const,
      position: [0, 2400, 0] as [number, number, number],
      direction: [0, -1, 0] as [number, number, number],
      color: '#fff',
      lumens: 600,
      beamDeg: 40,
      castShadow: false,
      ceiling: true,
      source: 'fixture' as const,
    };
    expect(luxAt([s], [0, 0, 0])).toBeGreaterThan(100);
    expect(luxAt([s], [3000, 0, 0])).toBe(0);
  });
  it('範例專案：每個房間都有統計、色階單調', () => {
    const scene = buildSampleScene({ living: '客餐廳', bed1: '主臥', bed2: '次臥' });
    const r = illuminance(scene.levels[0]!, catalog);
    expect(r.rooms).toHaveLength(3);
    expect(r.rooms.every((x) => x.avg > 0 && x.max >= x.avg && x.avg >= x.min)).toBe(true);
    expect(luxColor(0)).toBe('rgb(20,30,90)');
    expect(luxColor(2000)).toBe('rgb(230,60,40)');
  });
});
