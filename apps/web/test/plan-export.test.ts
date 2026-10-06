import { describe, expect, it } from 'vitest';
import { buildSampleScene } from '../src/sample';
import { catalog } from '../src/catalogData';
import { planToDxf, planToSvg } from '../src/export/plan';

describe('平面圖匯出', () => {
  const scene = buildSampleScene({ living: '客餐廳', bed1: '主臥', bed2: '次臥' });
  const lv = scene.levels[0]!;
  it('DXF：R12、mm、各圖層都有實體、Y 軸翻轉', () => {
    const dxf = planToDxf(lv, catalog);
    const lines = dxf.split('\r\n');
    expect(lines[0]).toBe('0');
    expect(dxf).toContain('AC1009');
    expect(lines.at(-2)).toBe('EOF');
    for (const l of ['WALLS', 'DOORS', 'WINDOWS', 'FURNITURE', 'ROOMS']) {
      const n = lines.filter((x, i) => x === l && lines[i - 1] === '8').length;
      expect(n, l).toBeGreaterThan(0);
    }
    // 牆每面 4 條邊
    expect(lines.filter((x, i) => x === 'WALLS' && lines[i - 1] === '8').length).toBe(lv.walls.length * 4);
    expect(dxf).toContain('主臥');
    // 北牆 z=8400 → y=-8400
    expect(dxf).toMatch(/\r\n20\r\n-8[45]\d\d/);
  });
  it('SVG：房間名稱、牆、門窗、家具', () => {
    const svg = planToSvg(lv, catalog, { nameOf: (id) => catalog.get(id)!.nameZh, title: 't' });
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('客餐廳');
    expect((svg.match(/fill="#222"/g) ?? []).length).toBe(lv.walls.length);
    expect(svg).toContain('#3b82c4');
    expect(svg).toContain('三人沙發');
  });
});
