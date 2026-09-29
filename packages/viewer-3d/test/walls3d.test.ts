import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Level, Wall } from '@interiorai/scene-schema';
import { buildRoomSurfaces, buildWallGeometry, GROUP_A, GROUP_B, GROUP_CAP } from '../src/walls3d.js';

const wall = (id: string, a: [number, number], b: [number, number], thickness = 100): Wall => ({
  id,
  a,
  b,
  thickness,
});
const level = (walls: Wall[], openings: Level['openings'] = []): Level => ({
  id: 'lvl_t',
  elevation: 0,
  height: 2800,
  walls,
  openings,
  rooms: [],
  objects: [],
});
const rect = (): Wall[] => [
  wall('w_s', [0, 0], [4000, 0]),
  wall('w_e', [4000, 0], [4000, 3000]),
  wall('w_n', [4000, 3000], [0, 3000]),
  wall('w_w', [0, 3000], [0, 0]),
];

/** 群組內三角形面積總和 */
function groupArea(g: THREE.BufferGeometry, group: number) {
  const grp = g.groups.find((x) => x.materialIndex === group)!;
  const pos = g.getAttribute('position');
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  let s = 0;
  for (let i = grp.start; i < grp.start + grp.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    s += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
  }
  return s;
}
function trianglesInGroup(g: THREE.BufferGeometry, group: number) {
  const grp = g.groups.find((x) => x.materialIndex === group)!;
  const pos = g.getAttribute('position');
  const out: THREE.Triangle[] = [];
  for (let i = grp.start; i < grp.start + grp.count; i += 3)
    out.push(
      new THREE.Triangle(
        new THREE.Vector3().fromBufferAttribute(pos, i),
        new THREE.Vector3().fromBufferAttribute(pos, i + 1),
        new THREE.Vector3().fromBufferAttribute(pos, i + 2),
      ),
    );
  return out;
}

describe('buildWallGeometry（ADR-016 解析式開口）', () => {
  it('單牆無開口：A/B 面積 = 長×高，頂面 = 長×厚；有三個群組', () => {
    const w = wall('w1', [0, 0], [4000, 0]);
    const g = buildWallGeometry(level([w]), w);
    expect(g.groups.map((x) => x.materialIndex)).toEqual([GROUP_A, GROUP_B, GROUP_CAP]);
    expect(groupArea(g, GROUP_B)).toBeCloseTo(4000 * 2800, 0);
    expect(groupArea(g, GROUP_CAP)).toBeCloseTo(4000 * 100, 0);
    // A 群組含：側面＋兩個端面（自由端）
    expect(groupArea(g, GROUP_A)).toBeCloseTo(4000 * 2800 + 2 * 100 * 2800, 0);
  });

  it('門（落地）與窗：側面扣除開口面積；開口中心沒有被三角形覆蓋', () => {
    const w = wall('w1', [0, 0], [4000, 0]);
    const lv = level(
      [w],
      [
        { id: 'o_d', wallId: 'w1', type: 'door', offset: 500, width: 900, height: 2100, sill: 0 },
        { id: 'o_w', wallId: 'w1', type: 'window', offset: 2000, width: 1200, height: 1200, sill: 900 },
      ],
    );
    const g = buildWallGeometry(lv, w);
    expect(groupArea(g, GROUP_B)).toBeCloseTo(4000 * 2800 - 900 * 2100 - 1200 * 1200, 0);
    const ray = (x: number, y: number) => {
      const r = new THREE.Ray(new THREE.Vector3(x, y, -1000), new THREE.Vector3(0, 0, 1));
      return trianglesInGroup(g, GROUP_B).some(
        (t) => r.intersectTriangle(t.a, t.b, t.c, false, new THREE.Vector3()) !== null,
      );
    };
    expect(ray(950, 1000)).toBe(false); // 門洞
    expect(ray(2600, 1500)).toBe(false); // 窗洞
    expect(ray(2600, 500)).toBe(true); // 窗台下方實牆
    expect(ray(3500, 1500)).toBe(true);
  });

  it('A 面法線朝左（a→b 的左側），B 面朝右', () => {
    const w = wall('w1', [0, 0], [4000, 0]);
    const g = buildWallGeometry(level([w]), w);
    const nor = g.getAttribute('normal');
    const gB = g.groups.find((x) => x.materialIndex === GROUP_B)!;
    // 左法線 perp([1,0]) = [0,1] → world (0,0,1)；B 面應為 (0,0,-1)
    expect(nor.getZ(gB.start)).toBeCloseTo(-1);
  });

  it('矩形房間四面牆：斜接後頂面總面積 = 外框 − 內框', () => {
    const lv = level(rect());
    const cap = lv.walls.reduce((s, w) => s + groupArea(buildWallGeometry(lv, w), GROUP_CAP), 0);
    expect(cap).toBeCloseTo(4100 * 3100 - 3900 * 2900, -1);
  });

  it('效能：100 面牆、每面 3 個開口，建立時間 < 500ms（取代 CSG 的理由）', () => {
    const walls = Array.from({ length: 100 }, (_, i) => wall(`w_${i}`, [0, i * 1000], [8000, i * 1000]));
    const openings = walls.flatMap((w, i) =>
      [0, 1, 2].map((k) => ({
        id: `o_${i}_${k}`,
        wallId: w.id,
        type: 'window' as const,
        offset: 500 + k * 2500,
        width: 1200,
        height: 1200,
        sill: 900,
      })),
    );
    const lv = level(walls, openings);
    const t = performance.now();
    for (const w of walls) buildWallGeometry(lv, w);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe('buildRoomSurfaces', () => {
  it('地板朝上、天花朝下；天花在樓高', () => {
    const [r] = buildRoomSurfaces(level(rect()));
    expect(r!.floor.getAttribute('normal').getY(0)).toBeCloseTo(1);
    expect(r!.ceiling.getAttribute('normal').getY(0)).toBeCloseTo(-1);
    expect(r!.ceiling.getAttribute('position').getY(0)).toBeCloseTo(2800);
  });
});
