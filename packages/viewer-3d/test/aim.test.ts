import { describe, expect, it } from 'vitest';
import { aimInverse, aimWorld, roomFillLights } from '../src/lighting.js';

describe('aimInverse', () => {
  for (const facing of ['down', 'up', 'front'] as const)
    for (const [t, p, r] of [
      [30, 40, 0.7],
      [60, -120, -1.2],
      [10, 170, 2.5],
    ] as const)
      it(`${facing} tilt ${t} pan ${p} rot ${r} 往返一致`, () => {
        const w = aimWorld(facing, t, p, r);
        const inv = aimInverse(facing, w, r);
        const back = aimWorld(facing, inv.tiltDeg, inv.panDeg, r);
        for (let i = 0; i < 3; i++) expect(back[i]!).toBeCloseTo(w[i]!, 2);
      });
});

describe('roomFillLights（夜間補光）', () => {
  const W = (id: string, a: [number, number], b: [number, number]) => ({ id, a, b, thickness: 100 });
  const level = {
    height: 2800,
    openings: [],
    walls: [
      W('n', [0, 0], [4000, 0]),
      W('e', [4000, 0], [4000, 3000]),
      W('s', [4000, 3000], [0, 3000]),
      W('w', [0, 3000], [0, 0]),
    ],
  };
  it('沒有燈具的房間在中央補一盞吸頂光', () => {
    const f = roomFillLights(level, []);
    expect(f).toHaveLength(1);
    expect(f[0]!.position[0]).toBeCloseTo(2000, 0);
    expect(f[0]!.position[2]).toBeCloseTo(1500, 0);
    expect(f[0]!.source).toBe('fill');
    expect(f[0]!.lumens).toBeGreaterThanOrEqual(400);
  });
  it('房內已有燈具就不補', () => {
    const lamp = {
      ...roomFillLights(level, [])[0]!,
      id: 'lamp',
      source: 'fixture' as const,
      position: [1000, 1500, 1000] as [number, number, number],
    };
    expect(roomFillLights(level, [lamp])).toHaveLength(0);
  });
});
