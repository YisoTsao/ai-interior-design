import { describe, expect, it } from 'vitest';
import { validateScene } from '@interiorai/scene-schema';
import { floorplanScene, sampleFloorplans, searchFloorplans } from '../src/floorplans';

describe('戶型庫（FE-PRJ-05）', () => {
  const all = sampleFloorplans();
  it('示意戶型 3 格局 × 4 面積；搜尋依房數與坪數', () => {
    expect(all).toHaveLength(12);
    const two = searchFloorplans(all, { bed: 2 });
    expect(two).toHaveLength(4);
    expect(two.every((e) => e.bed === 2)).toBe(true);
    const big = searchFloorplans(all, { pingMin: 30 });
    expect(big.every((e) => e.ping >= 30)).toBe(true);
    expect(searchFloorplans(all, { city: '台北市' })).toHaveLength(0);
  });
  it('縮放後的場景合法、外框面積與坪數一致、不佈置家具', () => {
    const e = all.find((x) => x.template?.id === 'twoBed' && x.template.scale[0] === 1.2)!;
    const sc = floorplanScene(e, (k) => k);
    expect(validateScene(sc).ok).toBe(true);
    const lv = sc.levels[0]!;
    expect(lv.objects).toHaveLength(0);
    const xs = lv.walls.flatMap((w) => [w.a[0], w.b[0]]);
    const zs = lv.walls.flatMap((w) => [w.a[1], w.b[1]]);
    const m2 = ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs))) / 1e6;
    expect(Math.abs(m2 / 3.3058 - e.ping)).toBeLessThan(0.2);
  });
});
