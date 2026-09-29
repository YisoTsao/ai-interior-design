import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { detectRooms } from '../src/index.js';
import { level, rect, wall } from './fixtures.js';

describe('detectRooms', () => {
  it('單一矩形房間：中心線與淨面積', () => {
    const r = detectRooms(level(rect(0, 0, 4000, 3000)));
    expect(r.rooms).toHaveLength(1);
    expect(r.rooms[0]!.area).toBe(12_000_000);
    expect(r.rooms[0]!.netArea).toBe(3900 * 2900);
    expect(r.rooms[0]!.wallIds).toEqual(['w_e', 'w_n', 'w_s', 'w_w']);
    expect(r.unclosedWallIds).toEqual([]);
  });

  it('T 型隔間切成兩房', () => {
    const walls = [...rect(0, 0, 4000, 3000), wall('mid', [2000, 0], [2000, 3000])];
    const r = detectRooms(level(walls));
    expect(r.rooms).toHaveLength(2);
    expect(r.rooms.map((x) => x.area).sort()).toEqual([6_000_000, 6_000_000]);
  });

  it('中段交叉的牆也會被切分（X）', () => {
    const walls = [
      ...rect(0, 0, 4000, 4000),
      wall('x1', [2000, -500], [2000, 4500]),
      wall('x2', [-500, 2000], [4500, 2000]),
    ];
    const r = detectRooms(level(walls));
    expect(r.rooms).toHaveLength(4);
  });

  it('未封閉：回空集合並列出 unclosedWallIds', () => {
    const r = detectRooms(level(rect(0, 0, 4000, 3000).slice(0, 3)));
    expect(r.rooms).toEqual([]);
    expect(r.unclosedWallIds).toHaveLength(3);
  });

  it('懸空隔間不影響房間，且不觸發洞警告', () => {
    const r = detectRooms(level([...rect(0, 0, 4000, 3000), wall('stub', [2000, 0], [2000, 1000])]));
    expect(r.rooms).toHaveLength(1);
    expect(r.unclosedWallIds).toEqual(['stub']); // 懸空牆本來就不屬於任何房間
    expect(r.warnings).toEqual([]);
  });

  it('房中房（天井）→ HOLE_UNSUPPORTED', () => {
    const r = detectRooms(level([...rect(0, 0, 6000, 6000), ...rect(2000, 2000, 4000, 4000, 100, 'in')]));
    expect(r.rooms).toHaveLength(2);
    expect(r.warnings.map((w) => w.code)).toContain('HOLE_UNSUPPORTED');
  });

  it('空牆集合', () => {
    expect(detectRooms(level([]))).toEqual({ rooms: [], unclosedWallIds: [], warnings: [] });
  });

  it('property：平移不改變面積（S1.6）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 9000 }),
        fc.integer({ min: 1000, max: 9000 }),
        fc.integer({ min: -9e5, max: 9e5 }),
        fc.integer({ min: -9e5, max: 9e5 }),
        (w, h, dx, dy) => {
          const a = detectRooms(level(rect(0, 0, w, h))).rooms[0]!;
          const b = detectRooms(level(rect(dx, dy, dx + w, dy + h))).rooms[0]!;
          expect(b.area).toBe(a.area);
          expect(Math.abs(b.netArea - a.netArea)).toBeLessThanOrEqual(4);
        },
      ),
      { numRuns: 100 },
    );
  });
});
