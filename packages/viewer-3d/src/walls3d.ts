import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { detectRooms, offsetPolygon, wallLength, wallQuad, type Vec2 } from '@interiorai/core-geometry';
import type { Level, Wall } from '@interiorai/scene-schema';

/** 牆面群組：A＝沿 a→b 方向的左側面、B＝右側面、CAP＝頂面（剖面色）。開口側邊(reveal)與端面歸 A。 */
export const GROUP_A = 0;
export const GROUP_B = 1;
export const GROUP_CAP = 2;

type V3 = [number, number, number];

/** 以三角形累積幾何並依群組輸出 */
class Builder {
  private pos: number[][] = [[], [], []];
  private nor: number[][] = [[], [], []];
  private uv: number[][] = [[], [], []];

  /** 平面四邊形；自動調整繞序使其法線朝 normal */
  quad(p: [V3, V3, V3, V3], normal: V3, uvs: [number, number][], group: number) {
    const e1 = sub3(p[1], p[0]);
    const e2 = sub3(p[2], p[0]);
    const c = cross3(e1, e2);
    const flip = c[0] * normal[0] + c[1] * normal[1] + c[2] * normal[2] < 0;
    const order = flip ? [0, 3, 2, 1] : [0, 1, 2, 3];
    const tri = [order[0]!, order[1]!, order[2]!, order[0]!, order[2]!, order[3]!];
    for (const i of tri) {
      this.pos[group]!.push(...p[i]!);
      this.nor[group]!.push(...normal);
      this.uv[group]!.push(...uvs[i]!);
    }
  }
  polygon(pts: V3[], normal: V3, uvs: [number, number][], group: number) {
    // 凸多邊形扇形三角化（牆頂為凸四邊形）
    for (let i = 1; i + 1 < pts.length; i++) {
      const tri: [V3, V3, V3] = [pts[0]!, pts[i]!, pts[i + 1]!];
      const c = cross3(sub3(tri[1], tri[0]), sub3(tri[2], tri[0]));
      const flip = c[0] * normal[0] + c[1] * normal[1] + c[2] * normal[2] < 0;
      const idx = flip ? [0, i + 1, i] : [0, i, i + 1];
      for (const k of idx) {
        this.pos[group]!.push(...pts[k]!);
        this.nor[group]!.push(...normal);
        this.uv[group]!.push(...uvs[k]!);
      }
    }
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const all = (arr: number[][]) => new Float32Array(arr.flat());
    g.setAttribute('position', new THREE.BufferAttribute(all(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(all(this.nor), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(all(this.uv), 2));
    let start = 0;
    this.pos.forEach((p, gi) => {
      const n = p.length / 3;
      g.addGroup(start, n, gi);
      start += n;
    });
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * 單面牆的 3D 幾何（ADR-016）：平面輪廓由 core-geometry 的 wallQuad 提供（B3.1：viewer 不自行拼牆），
 * 矩形開口以解析方式切成四邊形（側面分帶＋開口內側面），不使用 CSG，時間 O(開口數)。
 * height：牆頂高度（剖面模型的矮牆用）；預設為樓層高。高於牆頂的開口直接略過。
 */
export function buildWallGeometry(level: Level, w: Wall, height = level.height): THREE.BufferGeometry {
  const H = height;
  const L = wallLength(w) || 1;
  const a = w.a as Vec2;
  const d: Vec2 = [(w.b[0] - a[0]) / L, (w.b[1] - a[1]) / L];
  const n: Vec2 = [-d[1], d[0]];
  const h = w.thickness / 2;
  const world = (u: number, v: number, y: number): V3 => [
    a[0] + d[0] * u + n[0] * v,
    y,
    a[1] + d[1] * u + n[1] * v,
  ];
  const local = (p: Vec2) => (p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1];
  const [aMinus, bMinus, bPlus, aPlus] = wallQuad(level.walls, w);
  const uAm = local(aMinus!);
  const uBm = local(bMinus!);
  const uBp = local(bPlus!);
  const uAp = local(aPlus!);

  const ops = level.openings
    .filter((o) => o.wallId === w.id)
    .map((o) => ({
      u0: o.offset,
      u1: o.offset + o.width,
      y0: o.sill ?? 0,
      y1: Math.min(H, (o.sill ?? 0) + o.height),
    }))
    .filter((o) => o.y0 < H)
    .sort((x, y) => x.u0 - y.u0);

  const b = new Builder();
  const nA: V3 = [n[0], 0, n[1]];
  const nB: V3 = [-n[0], 0, -n[1]];

  // 側面：依開口邊界分帶
  const side = (v: number, uStart: number, uEnd: number, normal: V3, group: number) => {
    const cuts = new Set<number>([uStart, uEnd]);
    for (const o of ops) {
      if (o.u0 > uStart && o.u0 < uEnd) cuts.add(o.u0);
      if (o.u1 > uStart && o.u1 < uEnd) cuts.add(o.u1);
    }
    const xs = [...cuts].sort((x, y) => x - y);
    for (let i = 1; i < xs.length; i++) {
      const u0 = xs[i - 1]!;
      const u1 = xs[i]!;
      if (u1 - u0 < 1e-6) continue;
      const mid = (u0 + u1) / 2;
      const o = ops.find((x) => mid > x.u0 && mid < x.u1);
      const spans: [number, number][] = o
        ? [
            [0, o.y0],
            [o.y1, H],
          ]
        : [[0, H]];
      for (const [y0, y1] of spans) {
        if (y1 - y0 < 1e-6) continue;
        b.quad(
          [world(u0, v, y0), world(u1, v, y0), world(u1, v, y1), world(u0, v, y1)],
          normal,
          [
            [u0, y0],
            [u1, y0],
            [u1, y1],
            [u0, y1],
          ],
          group,
        );
      }
    }
  };
  side(h, uAp, uBp, nA, GROUP_A);
  side(-h, uAm, uBm, nB, GROUP_B);

  // 頂面（剖面）
  const top: V3[] = [aMinus!, bMinus!, bPlus!, aPlus!].map((p) => [p[0], H, p[1]]);
  b.polygon(
    top,
    [0, 1, 0],
    top.map((p) => [p[0], p[2]]),
    GROUP_CAP,
  );

  // 端面（自由端可見；接合端被相鄰牆遮住）
  const endFace = (p0: Vec2, p1: Vec2, outward: Vec2) => {
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (len < 1e-6) return;
    let nx = -(p1[1] - p0[1]) / len;
    let nz = (p1[0] - p0[0]) / len;
    if (nx * outward[0] + nz * outward[1] < 0) {
      nx = -nx;
      nz = -nz;
    }
    b.quad(
      [
        [p0[0], 0, p0[1]],
        [p1[0], 0, p1[1]],
        [p1[0], H, p1[1]],
        [p0[0], H, p0[1]],
      ],
      [nx, 0, nz],
      [
        [0, 0],
        [len, 0],
        [len, H],
        [0, H],
      ],
      GROUP_A,
    );
  };
  endFace(aMinus!, aPlus!, [-d[0], -d[1]]);
  endFace(bMinus!, bPlus!, d);

  // 開口內側面（門窗框洞）
  for (const o of ops) {
    const jamb = (u: number, dir: 1 | -1) =>
      b.quad(
        [world(u, -h, o.y0), world(u, h, o.y0), world(u, h, o.y1), world(u, -h, o.y1)],
        [d[0] * dir, 0, d[1] * dir],
        [
          [0, o.y0],
          [w.thickness, o.y0],
          [w.thickness, o.y1],
          [0, o.y1],
        ],
        GROUP_A,
      );
    jamb(o.u0, 1);
    jamb(o.u1, -1);
    if (o.y1 < H)
      b.quad(
        [world(o.u0, -h, o.y1), world(o.u1, -h, o.y1), world(o.u1, h, o.y1), world(o.u0, h, o.y1)],
        [0, -1, 0],
        [
          [o.u0, 0],
          [o.u1, 0],
          [o.u1, w.thickness],
          [o.u0, w.thickness],
        ],
        GROUP_A,
      );
    if (o.y0 > 0)
      b.quad(
        [world(o.u0, -h, o.y0), world(o.u1, -h, o.y0), world(o.u1, h, o.y0), world(o.u0, h, o.y0)],
        [0, 1, 0],
        [
          [o.u0, 0],
          [o.u1, 0],
          [o.u1, w.thickness],
          [o.u0, w.thickness],
        ],
        GROUP_A,
      );
  }
  return b.build();
}

/** 地板/天花：房間淨地板多邊形；UV＝平面 mm 座標（貼圖 repeat 依真實尺寸） */
export function buildRoomSurfaces(level: Level): {
  key: string;
  roomId?: string;
  floor: THREE.BufferGeometry;
  ceiling: THREE.BufferGeometry;
  /** 間接燈槽的發光條（cove） */
  cove?: THREE.BufferGeometry;
}[] {
  const byKey = new Map(level.rooms.map((r) => [[...r.wallIds].sort().join('|'), r]));
  return detectRooms(level)
    .rooms.filter((d) => d.floor.length >= 3)
    .map((d) => {
      const floorShape = new THREE.Shape(d.floor.map(([x, z]) => new THREE.Vector2(x, -z)));
      const floor = new THREE.ShapeGeometry(floorShape);
      floor.rotateX(-Math.PI / 2); // (x, −z) → (x, 0, z)，法線朝上
      const room = byKey.get(d.key);
      const c = room?.ceiling;
      const flat = (poly: readonly Vec2[], y: number, holes: readonly Vec2[][] = []) => {
        const sh = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, z)));
        for (const h of holes) sh.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, z))));
        const g = new THREE.ShapeGeometry(sh);
        g.rotateX(Math.PI / 2); // 法線朝下
        g.translate(0, y, 0);
        return g;
      };
      let ceiling: THREE.BufferGeometry;
      let cove: THREE.BufferGeometry | undefined;
      const inner =
        c && (c.type === 'tray' || c.type === 'cove')
          ? offsetPolygon([d.floor], -c.borderMm, false)[0]
          : undefined;
      if (c && c.type === 'drop') ceiling = flat(d.floor, level.height - c.dropMm);
      else if (c && inner && inner.length >= 3) {
        // 跌級：周邊降板（中間挖洞）＋內緣立面＋中央原高
        const y = level.height - c.dropMm;
        const ring = flat(d.floor, y, [inner]);
        const center = flat(inner, level.height);
        const risers: THREE.BufferGeometry[] = [];
        const strips: THREE.BufferGeometry[] = [];
        for (let i = 0; i < inner.length; i++) {
          const p = inner[i]!;
          const q = inner[(i + 1) % inner.length]!;
          const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (L < 1) continue;
          const ang = Math.atan2(-(q[1] - p[1]), q[0] - p[0]);
          const riser = new THREE.PlaneGeometry(L, c.dropMm);
          riser.rotateY(ang);
          riser.translate((p[0] + q[0]) / 2, y + c.dropMm / 2, (p[1] + q[1]) / 2);
          // 兩面都要看得到（從房間中央或周邊往上看）
          const back = riser.clone();
          back.rotateY(0);
          const idx = back.getIndex();
          if (idx) back.setIndex(Array.from(idx.array).reverse());
          risers.push(riser, back);
          if (c.type === 'cove') {
            const st = new THREE.BoxGeometry(L, 12, 30);
            st.rotateY(ang);
            st.translate((p[0] + q[0]) / 2, y + 8, (p[1] + q[1]) / 2);
            strips.push(st);
          }
        }
        ceiling = mergeGeometries(
          [ring.toNonIndexed(), center.toNonIndexed(), ...risers.map((g) => g.toNonIndexed())],
          false,
        )!;
        [ring, center, ...risers].forEach((g) => g.dispose());
        if (strips.length) {
          cove = mergeGeometries(strips, false) ?? undefined;
          strips.forEach((g) => g.dispose());
        }
      } else ceiling = flat(d.floor, level.height);
      return { key: d.key, roomId: room?.id, floor, ceiling, ...(cove ? { cove } : {}) };
    });
}

/**
 * 踢腳板（ADR-023）：沿牆兩個側面的細長方塊，高 height、厚 12 mm，落地開口（門、通道、落地窗）處斷開。
 * sides：只在朝向房間的一側加（外牆外側不加）；'both' 用於內牆。
 */
export function buildBaseboard(
  level: Level,
  w: Wall,
  height: number,
  sides: 'A' | 'B' | 'both',
  depth = 12,
): THREE.BufferGeometry | null {
  if (height <= 0) return null;
  const L = wallLength(w);
  if (L < 1) return null;
  const a = w.a as Vec2;
  const d: Vec2 = [(w.b[0] - a[0]) / L, (w.b[1] - a[1]) / L];
  const n: Vec2 = [-d[1], d[0]];
  const gaps = level.openings
    .filter((o) => o.wallId === w.id && (o.sill ?? 0) < height)
    .map((o) => [o.offset, o.offset + o.width] as [number, number])
    .sort((x, y) => x[0] - y[0]);
  const spans: [number, number][] = [];
  let u = w.thickness / 2;
  for (const [g0, g1] of gaps) {
    if (g0 > u) spans.push([u, g0]);
    u = Math.max(u, g1);
  }
  if (L - w.thickness / 2 > u) spans.push([u, L - w.thickness / 2]);
  const parts: THREE.BufferGeometry[] = [];
  const angle = Math.atan2(-d[1], d[0]);
  for (const side of sides === 'both' ? (['A', 'B'] as const) : [sides]) {
    const off = (w.thickness / 2 + depth / 2) * (side === 'A' ? 1 : -1);
    for (const [u0, u1] of spans) {
      if (u1 - u0 < 20) continue;
      const g = new THREE.BoxGeometry(u1 - u0, height, depth);
      g.rotateY(angle);
      const um = (u0 + u1) / 2;
      g.translate(a[0] + d[0] * um + n[0] * off, height / 2, a[1] + d[1] * um + n[1] * off);
      parts.push(g);
    }
  }
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

/**
 * 沿牆面的條帶（v1.3，FE-FIN-02／04）：護牆板、腰線、頂角線、踢腳板斷面。
 * y0..y1 高度範圍、depth 凸出牆面的深度；與該高度範圍重疊的門窗處斷開。
 * profile：flat＝單一方塊；step＝兩階（下深上淺）；cove＝三階近似凹弧。
 */
export function buildWallStrip(
  level: Level,
  w: Wall,
  y0: number,
  y1: number,
  sides: 'A' | 'B' | 'both',
  depth: number,
  profile: 'flat' | 'step' | 'cove' = 'flat',
  invert = false,
): THREE.BufferGeometry | null {
  if (y1 - y0 <= 0) return null;
  const L = wallLength(w);
  if (L < 1) return null;
  const a = w.a as Vec2;
  const d: Vec2 = [(w.b[0] - a[0]) / L, (w.b[1] - a[1]) / L];
  const n: Vec2 = [-d[1], d[0]];
  const gaps = level.openings
    .filter((o) => o.wallId === w.id && (o.sill ?? 0) < y1 && (o.sill ?? 0) + o.height > y0)
    .map((o) => [o.offset, o.offset + o.width] as [number, number])
    .sort((x, y) => x[0] - y[0]);
  const spans: [number, number][] = [];
  let u = w.thickness / 2;
  for (const [g0, g1] of gaps) {
    if (g0 > u) spans.push([u, g0]);
    u = Math.max(u, g1);
  }
  if (L - w.thickness / 2 > u) spans.push([u, L - w.thickness / 2]);
  // 斷面：由下而上的 [高度比例, 深度比例]；invert＝頂角線（上深下淺）
  const steps: [number, number][] =
    profile === 'step'
      ? [
          [0.6, 1],
          [0.4, 0.55],
        ]
      : profile === 'cove'
        ? [
            [0.34, 1],
            [0.33, 0.66],
            [0.33, 0.33],
          ]
        : [[1, 1]];
  const parts: THREE.BufferGeometry[] = [];
  const angle = Math.atan2(-d[1], d[0]);
  const H = y1 - y0;
  for (const side of sides === 'both' ? (['A', 'B'] as const) : [sides]) {
    for (const [u0, u1] of spans) {
      if (u1 - u0 < 20) continue;
      let y = y0;
      for (const [hk, dk] of invert ? [...steps].reverse() : steps) {
        const h = H * hk;
        const dep = Math.max(2, depth * dk);
        const off = (w.thickness / 2 + dep / 2) * (side === 'A' ? 1 : -1);
        const g = new THREE.BoxGeometry(u1 - u0, h, dep);
        g.rotateY(angle);
        const um = (u0 + u1) / 2;
        g.translate(a[0] + d[0] * um + n[0] * off, y + h / 2, a[1] + d[1] * um + n[1] * off);
        parts.push(g);
        y += h;
      }
    }
  }
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}
