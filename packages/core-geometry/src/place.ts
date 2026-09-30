import type { Level } from '@interiorai/scene-schema';
import { closestOnSegment, type Vec2 } from './vec.js';

/**
 * 靠牆吸附（FE-V3D-03）：物件背面（局部 −Z）貼齊最近牆面、正面朝向房間。
 * pos＝物件中心 (x, z)；depth＝物件深度 mm；threshold＝背面距牆面多近才吸附。
 * 回傳新中心與 rotationY（前方 (sinθ, cosθ) ＝ 牆指向物件的法線）；沒有夠近的牆回傳 null。
 */
export function snapToWall(
  level: Pick<Level, 'walls'>,
  pos: Vec2,
  depth: number,
  threshold = 350,
): { pos: Vec2; rotationY: number; wallId: string } | null {
  let best: { d: number; pos: Vec2; rot: number; id: string } | null = null;
  for (const w of level.walls) {
    const a = w.a as Vec2;
    const b = w.b as Vec2;
    const c = closestOnSegment(pos, a, b);
    if (c.t <= 0.001 || c.t >= 0.999) continue; // 只吸附到牆身，不吸附到牆端
    const nx = pos[0] - c.point[0];
    const nz = pos[1] - c.point[1];
    const L = Math.hypot(nx, nz);
    if (L < 1e-6) continue;
    const n: Vec2 = [nx / L, nz / L];
    const face = w.thickness / 2;
    const gap = L - face - depth / 2; // 背面到牆面的距離
    if (gap > threshold || gap < -depth) continue;
    if (!best || Math.abs(gap) < best.d) {
      const off = face + depth / 2;
      best = {
        d: Math.abs(gap),
        pos: [Math.round(c.point[0] + n[0] * off), Math.round(c.point[1] + n[1] * off)],
        rot: Math.atan2(n[0], n[1]),
        id: w.id,
      };
    }
  }
  return best ? { pos: best.pos, rotationY: best.rot, wallId: best.id } : null;
}
