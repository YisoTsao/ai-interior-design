import { describe, expect, it } from 'vitest';
import { detectKind, isRoomPlanJson, recognizeRoomPlan } from '../src/index.js';

/** RoomPlan 牆：中心 (cx, cz)，沿 X（rot=0）或沿 Z（rot=90°）的 4×4 欄主序矩陣 */
const T = (cx: number, cy: number, cz: number, rotY = 0) => {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, cx, cy, cz, 1];
};
const room = {
  walls: [
    { dimensions: [4, 2.6, 0], transform: T(2, 1.3, 0) },
    { dimensions: [3, 2.6, 0], transform: T(4, 1.3, 1.5, -Math.PI / 2) },
    { dimensions: [4, 2.6, 0], transform: T(2, 1.3, 3) },
    // 巢狀 4×4 格式
    {
      dimensions: [3, 2.6, 0],
      transform: [
        [0, 0, 1, 0],
        [0, 1, 0, 0],
        [-1, 0, 0, 0],
        [0, 1.3, 1.5, 1],
      ],
    },
  ],
  doors: [{ dimensions: [0.9, 2.05, 0], transform: T(1, 1.025, 0) }],
  windows: [{ dimensions: [1.2, 1.2, 0], transform: T(2, 1.5, 3) }],
};

describe('RoomPlan 掃描匯入（FE-MOB-04）', () => {
  it('格式判斷', () => {
    expect(detectKind(new TextEncoder().encode('{"walls":[]}'), 'scan.json')).toBe('roomplan');
    expect(isRoomPlanJson(JSON.stringify(room))).toBe(true);
    expect(isRoomPlanJson('{"a":1}')).toBe(false);
  });
  it('牆、門窗與尺寸（mm）', () => {
    const r = recognizeRoomPlan(JSON.stringify(room));
    expect(r.units).toBe('mm');
    expect(r.walls).toHaveLength(4);
    const xs = r.walls.flatMap((w) => [w.a[0], w.b[0]]);
    const zs = r.walls.flatMap((w) => [w.a[1], w.b[1]]);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(4000);
    expect(Math.max(...zs) - Math.min(...zs)).toBe(3000);
    const door = r.openings.find((o) => o.type === 'door')!;
    expect(door).toMatchObject({ width: 900, sill: 0, offset: 550 });
    const win = r.openings.find((o) => o.type === 'window')!;
    expect(win).toMatchObject({ width: 1200, height: 1200, sill: 900 });
  });
  it('沒有牆時拒絕', () => {
    expect(() => recognizeRoomPlan('{"walls":[]}')).toThrow();
  });
});
