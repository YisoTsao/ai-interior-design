import { describe, expect, it } from 'vitest';
import { snapToWall } from '../src/index.js';

const walls = [
  { id: 'w_s', a: [0, 0], b: [4000, 0], thickness: 200 },
  { id: 'w_e', a: [4000, 0], b: [4000, 3000], thickness: 200 },
] as Parameters<typeof snapToWall>[0]['walls'];

describe('snapToWall', () => {
  it('靠近南牆：背面貼齊、正面朝 +Z（房間內）', () => {
    const r = snapToWall({ walls }, [1500, 500], 600)!;
    expect(r.wallId).toBe('w_s');
    expect(r.pos).toEqual([1500, 100 + 300]);
    expect(r.rotationY).toBeCloseTo(0);
  });
  it('靠近東牆：正面朝 −X', () => {
    const r = snapToWall({ walls }, [3500, 1500], 400)!;
    expect(r.wallId).toBe('w_e');
    expect(r.pos).toEqual([4000 - 100 - 200, 1500]);
    expect(Math.sin(r.rotationY)).toBeCloseTo(-1);
  });
  it('離牆太遠不吸附', () => {
    expect(snapToWall({ walls }, [2000, 1500], 400)).toBeNull();
  });
});
