import { describe, expect, it } from 'vitest';
import { aimInverse, aimWorld } from '../src/lighting.js';

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
