import { describe, expect, it } from 'vitest';
import { mergeCollinearWalls, moveWallVertex, resizeWall, snap, wallLength } from '../src/index.js';
import { level, rect, wall } from './fixtures.js';

const L = level(rect(0, 0, 4000, 3000));

describe('snap（端點 > 牆線 > 角度 > 格線）', () => {
  it('端點優先於牆線', () => {
    expect(snap([4030, 20], { level: L, tolerance: 50, gridMm: 100 })).toMatchObject({
      kind: 'endpoint',
      point: [4000, 0],
    });
  });
  it('牆線', () => {
    expect(snap([2000, 30], { level: L, tolerance: 50 })).toMatchObject({ kind: 'wall', point: [2000, 0] });
  });
  it('角度吸附 15°，長度吸附格線', () => {
    const r2 = snap([10_000, 10_060], { level: L, tolerance: 10, angleFrom: [9000, 10_000], gridMm: 100 });
    expect(r2).toMatchObject({ kind: 'angle', point: [10_000, 10_000] });
    const r3 = snap([10_000, 10_060], { level: L, tolerance: 10, angleFrom: [9000, 10_000] });
    expect(r3.kind).toBe('angle');
  });
  it('角度參考點與目標重合時退回格線', () => {
    expect(snap([9000, 9000], { level: L, tolerance: 10, angleFrom: [9000, 9000], gridMm: 100 }).kind).toBe(
      'grid',
    );
  });
  it('格線、無吸附、停用、排除牆', () => {
    expect(snap([10_049, 10_051], { level: L, tolerance: 10, gridMm: 100 })).toMatchObject({
      kind: 'grid',
      point: [10_000, 10_100],
    });
    expect(snap([10_049.4, 10_051.6], { level: L, tolerance: 10 })).toMatchObject({
      kind: 'none',
      point: [10_049, 10_052],
    });
    expect(snap([4000, 0], { level: L, tolerance: 50, disabled: true }).kind).toBe('none');
    expect(snap([2000, 30], { level: L, tolerance: 50, excludeWallIds: ['w_s'] }).kind).toBe('none');
  });
});

describe('moveWallVertex', () => {
  it('相接牆端一起移動（連動）', () => {
    const r = moveWallVertex(L, { wallId: 'w_s', end: 'b' }, [4500, 0]);
    expect(r.violations).toEqual([]);
    expect(r.level.walls.find((w) => w.id === 'w_s')!.b).toEqual([4500, 0]);
    expect(r.level.walls.find((w) => w.id === 'w_e')!.a).toEqual([4500, 0]);
    expect(r.changedWallIds.sort()).toEqual(['w_e', 'w_s']);
    expect(L.walls[0]!.b).toEqual([4000, 0]); // 不修改輸入
  });
  it('開口超出範圍 → 阻止', () => {
    const lv = level(rect(0, 0, 4000, 3000), {
      openings: [{ id: 'o1', wallId: 'w_s', type: 'door', offset: 3000, width: 900, height: 2100 }],
    });
    const r = moveWallVertex(lv, { wallId: 'w_s', end: 'b' }, [3500, 0]);
    expect(r.violations.map((v) => v.code)).toEqual(['OPENING_OUT_OF_RANGE']);
    expect(r.level).toBe(lv);
  });
  it('牆過短 → 阻止；找不到牆', () => {
    expect(moveWallVertex(L, { wallId: 'w_s', end: 'b' }, [50, 0]).violations[0]!.code).toBe(
      'WALL_TOO_SHORT',
    );
    expect(moveWallVertex(L, { wallId: 'nope', end: 'a' }, [0, 0]).violations[0]!.code).toBe(
      'WALL_NOT_FOUND',
    );
    expect(moveWallVertex(L, { wallId: 'w_s', end: 'a' }, [-100, 0]).violations).toEqual([]);
  });
});

describe('resizeWall（保持相鄰牆角度）', () => {
  it('keep=start：右牆整體平移、北牆伸長，仍為矩形', () => {
    const r = resizeWall(L, 'w_s', 5000, 'start');
    const g = (id: string) => r.level.walls.find((w) => w.id === id)!;
    expect(g('w_s').b).toEqual([5000, 0]);
    expect(g('w_e').a).toEqual([5000, 0]);
    expect(g('w_e').b).toEqual([5000, 3000]);
    expect(g('w_n').a).toEqual([5000, 3000]);
    expect(wallLength(g('w_n'))).toBe(5000);
  });
  it('keep=end 與 center', () => {
    const e = resizeWall(L, 'w_s', 5000, 'end');
    expect(e.level.walls.find((w) => w.id === 'w_s')!.a).toEqual([-1000, 0]);
    const c = resizeWall(L, 'w_s', 5000, 'center');
    expect(c.level.walls.find((w) => w.id === 'w_s')!.a).toEqual([-500, 0]);
    expect(c.level.walls.find((w) => w.id === 'w_s')!.b).toEqual([4500, 0]);
    expect(resizeWall(L, 'w_s', 5000).level.walls[0]!.b).toEqual([5000, 0]);
  });
  it('縮短造成開口超出 → 阻止；找不到牆', () => {
    const lv = level(rect(0, 0, 4000, 3000), {
      openings: [{ id: 'o1', wallId: 'w_s', type: 'door', offset: 3000, width: 900, height: 2100 }],
    });
    expect(resizeWall(lv, 'w_s', 3000).violations[0]!.code).toBe('OPENING_OUT_OF_RANGE');
    expect(resizeWall(lv, 'zz', 3000).violations[0]!.code).toBe('WALL_NOT_FOUND');
  });
});

describe('mergeCollinearWalls', () => {
  it('合併共線牆並換算開口 offset 與房間參照', () => {
    const lv = level(
      [wall('a', [0, 0], [1000, 0]), wall('b', [1000, 0], [3000, 0]), wall('c', [3000, 0], [3000, 1000])],
      {
        openings: [{ id: 'o', wallId: 'b', type: 'window', offset: 200, width: 500, height: 500 }],
        rooms: [{ id: 'r', wallIds: ['a', 'b', 'c'] }],
      },
    );
    const m = mergeCollinearWalls(lv);
    expect(m.walls.map((w) => w.id)).toEqual(['a', 'c']);
    expect(m.walls[0]).toMatchObject({ a: [0, 0], b: [3000, 0] });
    expect(m.openings[0]).toMatchObject({ wallId: 'a', offset: 1200 });
    expect(m.rooms[0]!.wallIds).toEqual(['a', 'c']);
  });
  it('反向牆也能合併並正確換算', () => {
    const lv = level([wall('a', [1000, 0], [0, 0]), wall('b', [3000, 0], [1000, 0])], {
      openings: [
        { id: 'oa', wallId: 'a', type: 'window', offset: 100, width: 200, height: 500 },
        { id: 'ob', wallId: 'b', type: 'window', offset: 100, width: 200, height: 500 },
      ],
    });
    const m = mergeCollinearWalls(lv);
    expect(m.walls).toHaveLength(1);
    const w = m.walls[0]!;
    const byId = Object.fromEntries(m.openings.map((o) => [o.id, o]));
    // 世界座標：oa 在 x∈[700,900]、ob 在 x∈[2700,2900]
    const at = (off: number) => w.a[0] + Math.sign(w.b[0] - w.a[0]) * off;
    expect([at(byId.oa!.offset), at(byId.oa!.offset + 200)].sort((x, y) => x - y)).toEqual([700, 900]);
    expect([at(byId.ob!.offset), at(byId.ob!.offset + 200)].sort((x, y) => x - y)).toEqual([2700, 2900]);
  });
  it('接點有第三面牆、厚度或材質不同時不合併', () => {
    const t = level([
      wall('a', [0, 0], [1000, 0]),
      wall('b', [1000, 0], [2000, 0]),
      wall('c', [1000, 0], [1000, 500]),
    ]);
    expect(mergeCollinearWalls(t).walls).toHaveLength(3);
    expect(
      mergeCollinearWalls(level([wall('a', [0, 0], [1000, 0]), wall('b', [1000, 0], [2000, 0], 200)])).walls,
    ).toHaveLength(2);
    expect(
      mergeCollinearWalls(
        level([wall('a', [0, 0], [1000, 0]), wall('b', [1000, 0], [2000, 0], 100, { materialId: 'm_x' })]),
      ).walls,
    ).toHaveLength(2);
  });
});
