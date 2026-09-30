import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { resolveParams, type CatalogEntry } from '@interiorai/catalog';
import type { ViewStyle } from './style.js';

/**
 * 參數化家具幾何（07 §3：自產參數化模組）。原點＝底部中心、正面朝 +Z、單位 mm（B5）。
 * 回傳單一合併幾何＋頂點色：body 部件為白色（由 instance color 著色＝材質槽顏色），配件為固定深色。
 * 一個變體（catalogId＋參數）一個幾何 → InstancedMesh 一次 draw call。
 */
type Part = { g: THREE.BufferGeometry; x: number; y: number; z: number; color: string; ry?: number };
const BODY = '#ffffff';
const ACCENT = '#5a5650';
const DARK = '#2e2c2a';
const LIGHT = '#f4f2ee';
const GLASS = '#cfe3ea';
/** 自發光部件（燈罩、燈板、螢幕、LED）：排在最後並自成 group 1，由光色材質著色（夜間氛圍會 bloom） */
export const EMIT = '#fff4d6';
/** 剖面模型的莫蘭迪軟裝色（低飽和） */
const MORANDI = { sage: '#a3b09a', blue: '#9aa8b5', beige: '#d9cdb8', grey: '#b3aea7', linen: '#efebe3' };

const box = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color = BODY,
  ry = 0,
): Part => {
  const g = new THREE.BoxGeometry(Math.max(1, w), Math.max(1, h), Math.max(1, d));
  if (ry) g.rotateY(-ry);
  return { g, x, y: y + h / 2, z, color };
};
const cyl = (
  rTop: number,
  rBot: number,
  h: number,
  x: number,
  y: number,
  z: number,
  color = BODY,
  seg = 20,
): Part => ({
  g: new THREE.CylinderGeometry(rTop, rBot, h, seg),
  x,
  y: y + h / 2,
  z,
  color,
});

/** 圓角方塊（剖面模型用）；soft＝坐墊/枕頭等較大圓角 */
const rbox =
  (soft: boolean) =>
  (w: number, h: number, d: number, x: number, y: number, z: number, color = BODY): Part => {
    const W = Math.max(1, w);
    const H = Math.max(1, h);
    const D = Math.max(1, d);
    const r = Math.min(soft ? 45 : 10, Math.min(W, H, D) * (soft ? 0.3 : 0.2));
    return { g: new RoundedBoxGeometry(W, H, D, soft ? 2 : 1, r), x, y: y + H / 2, z, color };
  };

/** 朝 +Z 的圓盤（鐘面、洗衣機門等） */
const disc = (r: number, depth: number, x: number, y: number, z: number, color = BODY, seg = 28): Part => {
  const g = new THREE.CylinderGeometry(r, r, depth, seg);
  g.rotateX(Math.PI / 2);
  return { g, x, y, z, color };
};
/** 旋轉體（花瓶等）；profile 為 [半徑, 高] 序列 */
const lathe = (profile: [number, number][], x: number, y: number, z: number, color = BODY): Part => ({
  g: new THREE.LatheGeometry(
    profile.map(([r, h]) => new THREE.Vector2(Math.max(0.5, r), h)),
    28,
  ),
  x,
  y,
  z,
  color,
});
const ART = ['#c9b79c', '#8fa3a8', '#b86b4b', '#e6dfd3', '#5d6b5a'];

function parts(type: string, w: number, d: number, h: number, p: Record<string, number | string>): Part[] {
  const legs = (top: number, inset = 40, s = 40, color = ACCENT) =>
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([sx, sz]) => box(s, top, s, sx! * (w / 2 - inset), 0, sz! * (d / 2 - inset), color));
  switch (type) {
    case 'sofa': {
      const arm = Math.min(180, w * 0.1);
      return [
        box(w, 120, d, 0, 60, 0, ACCENT),
        box(w - arm * 2, h * 0.3, d * 0.8, 0, 180, d * 0.1),
        box(w, h - 180, d * 0.22, 0, 180, -d / 2 + d * 0.11),
        box(arm, h * 0.62 - 180, d, -w / 2 + arm / 2, 180, 0),
        box(arm, h * 0.62 - 180, d, w / 2 - arm / 2, 180, 0),
        ...legs(60, 60, 50, DARK),
      ];
    }
    case 'bed':
      return [
        box(w, 300, d, 0, 0, 0, ACCENT),
        box(w - 40, 220, d - 80, 0, 300, 20, LIGHT),
        box(w, h, 70, 0, 0, -d / 2 + 35),
        box(w * 0.3, 120, 350, -w * 0.22, 520, -d / 2 + 260, LIGHT),
        box(w * 0.3, 120, 350, w * 0.22, 520, -d / 2 + 260, LIGHT),
      ];
    case 'table':
    case 'desk':
      return [box(w, 40, d, 0, h - 40, 0), ...legs(h - 40)];
    case 'chair':
      return [box(w, 40, d, 0, 440, 0), ...legs(440, 30, 30), box(w, h - 480, 30, 0, 480, -d / 2 + 15)];
    case 'shelf': {
      const n = 5;
      const out: Part[] = [box(25, h, d, -w / 2 + 12, 0, 0), box(25, h, d, w / 2 - 12, 0, 0)];
      for (let i = 0; i < n; i++) out.push(box(w - 50, 20, d, 0, (i * (h - 20)) / (n - 1), 0, ACCENT));
      return out;
    }
    case 'cabinet': {
      const doors = Number(p.doors ?? 2);
      const shelves = Number(p.shelves ?? 3);
      const out: Part[] = [box(w, h - 80, d, 0, 80, 0), box(w - 20, 80, d - 40, 0, 0, -20, DARK)];
      if (doors > 0) {
        for (let i = 1; i < doors; i++)
          out.push(box(6, h - 100, 6, -w / 2 + (w * i) / doors, 90, d / 2 + 2, DARK));
        for (let i = 0; i < doors; i++)
          out.push(
            box(
              12,
              160,
              20,
              -w / 2 + (w * (i + 0.5)) / doors + (i % 2 ? -w / doors / 2 + 40 : w / doors / 2 - 40),
              h / 2,
              d / 2 + 10,
              DARK,
            ),
          );
      } else {
        for (let i = 1; i <= shelves; i++)
          out.push(box(w - 40, 12, 8, 0, 80 + ((h - 80) * i) / (shelves + 1), d / 2 - 4, DARK));
      }
      return out;
    }
    case 'tvstand':
    case 'nightstand':
      return [
        box(w, h - 60, d, 0, 60, 0),
        box(w - 40, 60, d - 40, 0, 0, 0, DARK),
        box(w - 40, 6, 6, 0, h * 0.55, d / 2 + 3, DARK),
      ];
    case 'counter':
      return [
        box(w, h - 110, d - 20, 0, 90, -10),
        box(w, 40, d, 0, h - 40, 0, DARK),
        box(w - 20, 90, d - 80, 0, 0, -30, DARK),
      ];
    case 'toilet':
      return [
        cyl(w * 0.45, w * 0.35, 420, 0, 0, d * 0.12, LIGHT),
        box(w, h - 420, d * 0.28, 0, 420, -d / 2 + d * 0.14, LIGHT),
      ];
    case 'basin':
      return [box(w, h - 150, d, 0, 0, 0), box(w, 150, d, 0, h - 150, 0, LIGHT)];
    case 'bathtub':
      return [box(w, h, d, 0, 0, 0, LIGHT), box(w - 140, 20, d - 140, 0, h - 10, 0, GLASS)];
    case 'fridge':
      return [box(w, h, d, 0, 0, 0), box(w - 10, 6, 6, 0, h * 0.62, d / 2 + 3, DARK)];
    case 'lamp_floor':
      return [
        cyl(w * 0.35, w * 0.35, 30, 0, 0, 0, DARK),
        cyl(12, 12, h - 330, 0, 30, 0, DARK),
        cyl(w * 0.35, w * 0.5, 300, 0, h - 300, 0, EMIT),
      ];
    case 'lamp_pendant':
      return [
        cyl(4, 4, h * 0.5, 0, h * 0.5, 0, DARK),
        cyl(w * 0.15, w * 0.5, h * 0.5, 0, 20, 0),
        cyl(w * 0.42, w * 0.42, 14, 0, 12, 0, EMIT),
      ];
    case 'lamp_table':
      return [
        cyl(w * 0.3, w * 0.34, 24, 0, 0, 0, DARK),
        cyl(10, 10, h * 0.5, 0, 24, 0, ACCENT),
        cyl(w * 0.32, w * 0.5, h * 0.42, 0, h * 0.58, 0, EMIT),
      ];
    case 'lamp_wall':
      return [
        box(110, 180, 18, 0, h / 2 - 90, -d / 2 + 9, DARK),
        box(24, 24, d * 0.6, 0, h * 0.5, -d / 2 + d * 0.3, DARK),
        cyl(w * 0.35, w * 0.48, h * 0.55, 0, h * 0.4, d * 0.1, EMIT),
      ];
    case 'lamp_downlight':
      return [cyl(w / 2, w / 2, 14, 0, h - 14, 0, LIGHT), cyl(w * 0.34, w * 0.34, 10, 0, h - 22, 0, EMIT)];
    case 'lamp_track': {
      const out: Part[] = [box(w, 30, 40, 0, h - 30, 0, DARK)];
      for (const x of [-w / 3, 0, w / 3]) {
        out.push(cyl(8, 8, 50, x, h - 80, 0, DARK));
        out.push(cyl(38, 30, 110, x, h - 190, 30, DARK));
        out.push(cyl(28, 28, 8, x, h - 196, 30, EMIT));
      }
      return out;
    }
    case 'lamp_chandelier': {
      const out: Part[] = [
        cyl(w * 0.12, w * 0.12, 30, 0, h - 30, 0, ACCENT),
        cyl(6, 6, h * 0.45, 0, h * 0.5, 0, ACCENT),
      ];
      out.push(cyl(w * 0.1, w * 0.14, 80, 0, h * 0.42, 0, ACCENT));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const [x, z] = [Math.cos(a) * w * 0.38, Math.sin(a) * w * 0.38];
        out.push(box(w * 0.36, 12, 12, x / 2, h * 0.45, z / 2, ACCENT, a));
        const bulb = new THREE.IcosahedronGeometry(55, 1);
        out.push({ g: bulb, x, y: h * 0.45 + 60, z, color: EMIT });
      }
      return out;
    }
    case 'lamp_arc': {
      // 底座＋弧形燈桿（折線近似）＋燈罩在 +X 端
      const out: Part[] = [box(360, 40, 360, -w / 2 + 180, 0, 0, DARK)];
      const x0 = -w / 2 + 180;
      const x1 = w * 0.4;
      const pts: [number, number][] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        pts.push([
          x0 + (x1 - x0) * t,
          40 + ((h - 180) * Math.sin(t * Math.PI * 0.62)) / Math.sin(Math.PI * 0.62),
        ]);
      }
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1]!;
        const [bx2, by] = pts[i]!;
        const len = Math.hypot(bx2 - ax, by - ay);
        const g = new THREE.CylinderGeometry(12, 12, len, 8);
        g.rotateZ(-Math.atan2(bx2 - ax, by - ay));
        out.push({ g, x: (ax + bx2) / 2, y: (ay + by) / 2, z: 0, color: DARK });
      }
      out.push(cyl(60, 200, 170, x1, h - 190, 0, DARK));
      out.push(cyl(180, 180, 8, x1, h - 196, 0, EMIT));
      return out;
    }
    case 'light_hex': {
      // 三片六角形燈板（面朝 +Z，貼牆）
      const r = Math.min(w, h) * 0.3;
      const cells: [number, number][] = [
        [-r * 0.9, h * 0.62],
        [r * 0.9, h * 0.62],
        [0, h * 0.62 - r * 1.6],
      ];
      return cells.map(([x, y]) => {
        const g = new THREE.CylinderGeometry(r, r, d, 6);
        g.rotateX(Math.PI / 2);
        g.rotateZ(Math.PI / 6);
        return { g, x, y, z: 0, color: EMIT };
      });
    }
    case 'led_strip':
      return [box(w, 6, d, 0, 0, 0, DARK), box(w - 4, h - 6, d * 0.6, 0, 6, 0, EMIT)];
    case 'led_bar':
      return [box(w, h, d, 0, 0, -2, DARK), box(w * 0.5, h - 40, 6, 0, 20, d / 2, EMIT)];
    case 'monitor':
      return [
        box(220, 12, 180, 0, 0, -d / 4, DARK),
        box(40, 170, 20, 0, 12, -d / 4, DARK),
        box(w, h - 150, 24, 0, 150, 0, DARK),
        box(w - 24, h - 174, 4, 0, 162, 14, EMIT),
      ];
    case 'curtain': {
      // 窗簾桿＋左右兩片打褶布簾（直立圓柱排列成摺）
      const rod = new THREE.CylinderGeometry(12, 12, w, 10);
      rod.rotateZ(Math.PI / 2);
      const out: Part[] = [{ g: rod, x: 0, y: h - 20, z: 0, color: DARK }];
      const panelW = w * 0.26;
      for (const side of [-1, 1]) {
        const cx = side * (w / 2 - panelW / 2);
        const folds = 7;
        for (let i = 0; i < folds; i++) {
          const fx = cx - panelW / 2 + (panelW * (i + 0.5)) / folds;
          out.push(
            cyl(panelW / folds / 1.6, panelW / folds / 1.6, h - 60, fx, 10, (i % 2) * 22 - 11, BODY, 10),
          );
        }
      }
      return out;
    }

    case 'sofa_l': {
      const d0 = Math.min(950, d * 0.56);
      const cw = Math.min(900, w * 0.34);
      const zc0 = -d / 2 + d0 / 2;
      const zc1 = -d / 2 + d0 + (d - d0) / 2;
      return [
        box(w, 120, d0, 0, 60, zc0, ACCENT),
        box(cw, 120, d - d0, w / 2 - cw / 2, 60, zc1, ACCENT),
        box(w, h - 180, 200, 0, 180, -d / 2 + 100),
        box(180, h * 0.62 - 180, d0, -w / 2 + 90, 180, zc0),
        box(w - 180, 180, d0 - 200, 90, 180, zc0 + 100),
        box(cw, 180, d - d0, w / 2 - cw / 2, 180, zc1),
        box(160, h * 0.5 - 180, d - d0, w / 2 - 80, 180, zc1),
        ...legs(60, 60, 50, DARK),
      ];
    }
    case 'ottoman':
      return [cyl(w * 0.42, w * 0.42, 40, 0, 0, 0, DARK), cyl(w / 2, w / 2, h - 40, 0, 40, 0)];
    case 'bench':
      return [box(w, 60, d, 0, h - 60, 0), ...legs(h - 60, 50, 45, ACCENT)];
    case 'stool': {
      const ring = new THREE.TorusGeometry(w * 0.3, 10, 6, 20);
      ring.rotateX(Math.PI / 2);
      return [
        cyl(w * 0.45, w * 0.42, 70, 0, h - 70, 0),
        cyl(22, 22, h - 70, 0, 20, 0, ACCENT, 12),
        cyl(w * 0.34, w * 0.38, 20, 0, 0, 0, ACCENT),
        { g: ring, x: 0, y: h * 0.33, z: 0, color: ACCENT },
      ];
    }
    case 'table_round': {
      const top = cyl(w / 2, w / 2, 40, 0, h - 40, 0, BODY, 40);
      top.g.scale(1, 1, d / w);
      return [top, cyl(55, 55, h - 60, 0, 20, 0, ACCENT), cyl(w * 0.24, w * 0.28, 22, 0, 0, 0, ACCENT)];
    }
    case 'rug_round': {
      const r = cyl(w / 2, w / 2, Math.max(4, h), 0, 0, 0, BODY, 48);
      r.g.scale(1, 1, d / w);
      return [r];
    }
    case 'dresser': {
      const n = 5;
      const out: Part[] = [box(w, h - 80, d, 0, 80, 0), ...legs(80, 50, 40, DARK)];
      for (let i = 1; i < n; i++) out.push(box(w - 40, 6, 6, 0, 80 + ((h - 80) * i) / n, d / 2 + 2, DARK));
      for (let i = 0; i < n; i++)
        out.push(box(120, 16, 16, 0, 80 + ((h - 80) * (i + 0.5)) / n - 8, d / 2 + 6, ACCENT));
      return out;
    }
    case 'tv': {
      const wall = d < 70;
      return [
        box(w, h - (wall ? 0 : 80), Math.min(40, d), 0, wall ? 0 : 80, 0, DARK),
        box(w - 30, h - (wall ? 30 : 110), 4, 0, wall ? 15 : 95, Math.min(40, d) / 2 + 1, '#101216'),
        ...(wall
          ? []
          : [box(w * 0.08, 80, d, -w * 0.36, 0, 0, DARK), box(w * 0.08, 80, d, w * 0.36, 0, 0, DARK)]),
      ];
    }
    case 'piano':
      return [
        box(w, h - 100, d * 0.55, 0, 100, -d * 0.225),
        box(w - 60, 70, d * 0.42, 0, 660, d / 2 - d * 0.21),
        box(w - 220, 22, d * 0.3, 0, 730, d / 2 - d * 0.2, LIGHT),
        box(60, 660, 60, -w / 2 + 80, 0, d / 2 - 60),
        box(60, 660, 60, w / 2 - 80, 0, d / 2 - 60),
        box(w * 0.5, 12, 30, 0, h - 350, -d * 0.225 + d * 0.275 + 15, DARK),
      ];
    case 'fireplace':
      return [
        box(w, h - 50, d, 0, 0, 0),
        box(w + 80, 50, d + 60, 0, h - 50, 30),
        box(w * 0.62, h * 0.5, 6, 0, h * 0.12, d / 2 + 1, '#15130f'),
        box(w * 0.5, 30, 60, 0, h * 0.12, d / 2 - 20, '#3b2a1c'),
        box(w * 0.44, h * 0.16, 10, 0, h * 0.12 + 30, d / 2 + 6, EMIT),
      ];
    case 'washer':
      return [
        box(w, h, d, 0, 0, 0),
        box(w - 40, 90, 6, 0, h - 120, d / 2 + 3, LIGHT),
        disc(w * 0.33, 24, 0, h * 0.44, d / 2 + 12, DARK),
        disc(w * 0.25, 10, 0, h * 0.44, d / 2 + 26, GLASS),
      ];
    case 'stove':
      return [
        box(w, h - 40, d - 20, 0, 0, -10),
        box(w, 40, d, 0, h - 40, 0, DARK),
        box(w - 120, h * 0.4, 6, 0, h * 0.2, d / 2 - 7, '#1d1f22'),
        box(w - 80, 20, 20, 0, h * 0.64, d / 2, '#9ea3a6'),
        ...[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => cyl(70, 70, 10, sx * w * 0.22, h, sz * d * 0.2, '#1b1b1b')),
        ),
      ];
    case 'sink':
      return [
        box(w, h - 40, d - 20, 0, 0, -10),
        box(w, 40, d, 0, h - 40, 0, LIGHT),
        box(w * 0.55, 8, d * 0.55, 0, h - 4, 0, '#8f9496'),
        cyl(14, 14, 260, 0, h, -d * 0.36, '#c8cacc', 10),
        box(24, 24, 170, 0, h + 236, -d * 0.36 + 85, '#c8cacc'),
        box(w - 40, 6, 6, 0, h * 0.5, d / 2 - 8, DARK),
      ];
    case 'upper_cabinet':
      return [
        box(w, h, d, 0, 0, 0),
        box(6, h - 20, 6, 0, 10, d / 2 + 2, DARK),
        box(12, 120, 18, -40, 30, d / 2 + 8, DARK),
        box(12, 120, 18, 40, 30, d / 2 + 8, DARK),
      ];
    case 'range_hood':
      return [
        box(w * 0.34, h * 0.6, d * 0.5, 0, h * 0.4, -d * 0.25),
        box(w, h * 0.12, d, 0, 0, 0),
        box(w * 0.8, h * 0.28, d * 0.7, 0, h * 0.12, -d * 0.15),
      ];
    case 'shower': {
      const post = (x: number, z: number) => box(30, h - 60, 30, x, 60, z);
      return [
        box(w, 60, d, 0, 0, 0, LIGHT),
        post(-w / 2 + 15, d / 2 - 15),
        post(w / 2 - 15, d / 2 - 15),
        post(w / 2 - 15, -d / 2 + 15),
        box(w, 30, 30, 0, h - 30, d / 2 - 15),
        box(30, 30, d, w / 2 - 15, h - 30, 0),
        box(24, h - 400, 24, -w / 2 + 120, 200, -d / 2 + 30, '#c8cacc'),
        cyl(100, 100, 16, -w / 2 + 120, h - 230, -d / 2 + 140, '#c8cacc'),
      ];
    }
    case 'mirror':
      return [box(w, h, d, 0, 0, 0), box(w - 60, h - 60, 4, 0, 30, d / 2 + 1, '#dde6ea')];
    case 'wall_art': {
      const cw = w - 70;
      const ch = h - 70;
      return [
        box(w, h, d, 0, 0, 0, DARK),
        box(cw, ch, 4, 0, 35, d / 2 + 1, ART[3]!),
        box(cw * 0.45, ch * 0.55, 5, -cw * 0.2, 35 + ch * 0.3, d / 2 + 2, ART[0]!),
        box(cw * 0.3, ch * 0.35, 6, cw * 0.22, 35 + ch * 0.12, d / 2 + 3, ART[2]!),
        box(cw * 0.18, ch * 0.7, 7, cw * 0.1, 35 + ch * 0.2, d / 2 + 2, ART[1]!),
      ];
    }
    case 'wall_shelf':
      return [
        box(w, 25, d, 0, 0, 0),
        box(20, 120, d * 0.7, -w / 2 + 80, -120, -d * 0.15, DARK),
        box(20, 120, d * 0.7, w / 2 - 80, -120, -d * 0.15, DARK),
        box(w * 0.08, 220, d * 0.7, -w * 0.3, 25, 0, ART[2]!),
        box(w * 0.06, 200, d * 0.7, -w * 0.22, 25, 0, ART[1]!),
        box(w * 0.07, 230, d * 0.7, -w * 0.14, 25, 0, ART[0]!),
      ];
    case 'clock':
      return [
        disc(w / 2, d, 0, h / 2, 0, DARK, 40),
        disc(w / 2 - 20, 6, 0, h / 2, d / 2, LIGHT, 40),
        box(10, h * 0.3, 4, 0, h / 2, d / 2 + 5, DARK),
        box(h * 0.22, 10, 4, h * 0.11, h / 2 - 5, d / 2 + 6, DARK),
      ];
    case 'vase': {
      const r = w / 2;
      return [
        lathe(
          [
            [r * 0.55, 0],
            [r * 0.95, h * 0.3],
            [r * 0.7, h * 0.72],
            [r * 0.38, h * 0.9],
            [r * 0.46, h],
          ],
          0,
          0,
          0,
        ),
        cyl(8, 8, h * 0.5, 0, h * 0.8, 0, '#5a4a36', 6),
        { g: new THREE.IcosahedronGeometry(r * 0.5, 0), x: 0, y: h * 1.25, z: 0, color: '#8a9b72' },
      ];
    }
    case 'bean_bag': {
      const g = new THREE.SphereGeometry(1, 24, 16);
      g.scale(w / 2, h / 2, d / 2);
      return [{ g, x: 0, y: h / 2, z: 0, color: BODY }];
    }
    case 'floor_cushion':
      return [box(w, h, d, 0, 0, 0)];
    case 'ceiling_fan': {
      const out: Part[] = [
        cyl(16, 16, h * 0.55, 0, h * 0.45, 0, DARK, 10),
        cyl(120, 100, 110, 0, h * 0.2, 0, DARK),
        cyl(100, 100, 40, 0, h * 0.12, 0, EMIT),
      ];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const r = w * 0.27;
        out.push(box(w * 0.44, 10, 130, Math.cos(a) * r, h * 0.26, Math.sin(a) * r, BODY, a));
      }
      return out;
    }
    case 'aircon':
      return [
        box(w, h, d, 0, 0, 0),
        box(w - 60, 22, 6, 0, 36, d / 2 + 1, '#c9ccce'),
        box(40, 12, 4, w / 2 - 80, h - 60, d / 2 + 2, '#7fd1a8'),
      ];
    case 'radiator': {
      const n = Math.max(3, Math.floor(w / 80));
      const out: Part[] = [box(w, 30, d * 0.5, 0, 90, 0, ACCENT), box(w, 30, d * 0.5, 0, h - 30, 0, ACCENT)];
      for (let i = 0; i < n; i++) out.push(box(w / n - 20, h - 100, d, -w / 2 + (w / n) * (i + 0.5), 100, 0));
      out.push(box(40, 90, d, -w / 2 + 60, 0, 0, DARK), box(40, 90, d, w / 2 - 60, 0, 0, DARK));
      return out;
    }
    case 'coat_rack': {
      const out: Part[] = [cyl(w * 0.35, w * 0.4, 30, 0, 0, 0), cyl(22, 22, h - 30, 0, 30, 0, BODY, 10)];
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        out.push(box(160, 18, 18, Math.cos(a) * 80, h - 180, Math.sin(a) * 80, DARK, a));
      }
      return out;
    }
    case 'crib': {
      const out: Part[] = [
        box(w - 60, 120, d - 60, 0, 300, 0, LIGHT),
        ...legs(h, 25, 50),
        box(w, 40, 40, 0, h - 40, -d / 2 + 20),
        box(w, 40, 40, 0, h - 40, d / 2 - 20),
        box(40, 40, d, -w / 2 + 20, h - 40, 0),
        box(40, 40, d, w / 2 - 20, h - 40, 0),
        box(w, 50, d, 0, 250, 0),
      ];
      const n = Math.floor((d - 100) / 90);
      for (let i = 1; i < n; i++)
        for (const sx of [-1, 1])
          out.push(box(20, h - 340, 20, sx * (w / 2 - 20), 300, -d / 2 + 50 + ((d - 100) * i) / n));
      return out;
    }
    case 'bunk_bed': {
      const up = h * 0.58;
      const out: Part[] = [
        ...legs(h, 35, 70),
        box(w, 120, d, 0, 180, 0),
        box(w - 100, 180, d - 100, 0, 300, 0, LIGHT),
        box(w, 120, d, 0, up, 0),
        box(w - 100, 160, d - 100, 0, up + 120, 0, LIGHT),
        box(40, 260, d * 0.7, w / 2 - 20, up + 120, -d * 0.1),
        box(40, 260, d, -w / 2 + 20, up + 120, 0),
      ];
      for (const z of [d / 2 - 40, d / 2 - 400]) out.push(box(40, up + 120, 40, w / 2 + 30, 0, z, ACCENT));
      for (let i = 1; i <= 4; i++)
        out.push(box(40, 30, 360, w / 2 + 30, ((up + 120) * i) / 5, d / 2 - 220, ACCENT));
      return out;
    }
    case 'books': {
      const cols = [ART[2]!, ART[1]!, ART[0]!, ART[4]!];
      return cols.map((c, i) =>
        box(
          w * (0.82 + (i % 2) * 0.15),
          h / 4,
          d * (0.85 + (i % 3) * 0.05),
          0,
          (i * h) / 4,
          0,
          c,
          (i - 1.5) * 0.08,
        ),
      );
    }
    case 'laptop': {
      const scr = new THREE.BoxGeometry(w, d * 0.9, 8);
      scr.rotateX(-0.3);
      return [
        box(w, 18, d, 0, 0, 0, '#9ea2a6'),
        { g: scr, x: 0, y: 18 + d * 0.43, z: -d / 2 - d * 0.12, color: '#20252c' },
      ];
    }
    case 'neon_sign': {
      const ring = new THREE.TorusGeometry(h * 0.3, 12, 8, 36);
      return [
        box(w, h, 10, 0, 0, -d / 2 + 5, '#1d1d20'),
        { g: ring, x: -w * 0.28, y: h / 2, z: d / 2 - 12, color: EMIT },
        box(w * 0.42, 24, 24, w * 0.12, h * 0.68, d / 2 - 12, EMIT),
        box(w * 0.3, 24, 24, w * 0.06, h * 0.46, d / 2 - 12, EMIT),
        box(w * 0.38, 24, 24, w * 0.1, h * 0.24, d / 2 - 12, EMIT),
      ];
    }
    case 'candle': {
      const spots: [number, number, number][] = [
        [-w * 0.3, 0, h * 0.8],
        [0, d * 0.1, h],
        [w * 0.3, -d * 0.1, h * 0.6],
      ];
      return spots.flatMap(([x, z, hh]) => [
        cyl(w * 0.14, w * 0.14, hh - 30, x, 0, z, BODY, 16),
        { g: new THREE.ConeGeometry(10, 34, 8), x, y: hh - 30 + 17, z, color: EMIT },
      ]);
    }
    case 'pet_bed': {
      const ring = new THREE.TorusGeometry(w * 0.36, h * 0.42, 10, 28);
      ring.rotateX(Math.PI / 2);
      ring.scale(1, 1, d / w);
      const base = cyl(w * 0.4, w * 0.4, h * 0.3, 0, 0, 0, LIGHT, 28);
      base.g.scale(1, 1, d / w);
      return [base, { g: ring, x: 0, y: h * 0.45, z: 0, color: BODY }];
    }
    case 'treadmill':
      return [
        box(w * 0.8, 180, d, 0, 0, 0, DARK),
        box(w * 0.6, 12, d * 0.82, 0, 180, d * 0.05, '#1c1c1c'),
        box(50, h - 180, 50, -w * 0.4, 180, -d / 2 + 200),
        box(50, h - 180, 50, w * 0.4, 180, -d / 2 + 200),
        box(w, 70, 260, 0, h - 90, -d / 2 + 200),
        box(30, 30, 500, -w * 0.4, h - 350, -d / 2 + 430),
        box(30, 30, 500, w * 0.4, h - 350, -d / 2 + 430),
      ];
    case 'column':
      return p.shape === 'round'
        ? [
            (() => {
              const c = cyl(w / 2, w / 2, h, 0, 0, 0, BODY, 32);
              c.g.scale(1, 1, d / w);
              return c;
            })(),
          ]
        : [box(w, h, d, 0, 0, 0)];
    case 'beam':
      return [box(w, h, d, 0, 0, 0)];
    case 'platform':
      return [box(w, h - 20, d, 0, 0, 0, ACCENT), box(w + 20, 20, d + 20, 0, h - 20, 0)];
    case 'railing': {
      const out: Part[] = [box(w, 40, Math.max(40, d), 0, h - 40, 0)];
      const n = Math.max(2, Math.round(w / 110));
      for (let i = 0; i <= n; i++)
        out.push(box(18, h - 40, 18, -w / 2 + 20 + ((w - 40) * i) / n, 0, 0, DARK));
      out.push(box(w, 20, 20, 0, 80, 0, DARK));
      return out;
    }
    case 'stairs':
      return stairsParts(String(p.shape ?? 'straight'), w, d, h, Math.max(3, Number(p.steps ?? 16)));
    case 'rug':
      return [box(w, Math.max(4, h), d, 0, 0, 0)];
    case 'plant': {
      const leaves = new THREE.IcosahedronGeometry(Math.min(w, d) * 0.55, 1);
      leaves.scale(1, (h * 0.75) / (Math.min(w, d) * 1.1), 1);
      return [
        cyl(w * 0.3, w * 0.24, h * 0.3, 0, 0, 0, DARK),
        { g: leaves, x: 0, y: h * 0.3 + h * 0.36, z: 0, color: '#6d8f5d' },
      ];
    }
    case 'mep': {
      // 水電點位（FE-DOC-05）：面板或管口，顏色依種類
      const pt = String(p.point ?? 'outlet');
      const col: Record<string, string> = {
        data: '#4f8bd6',
        tv: '#8a8f98',
        water_cold: '#3f86e0',
        water_hot: '#e0513f',
        drain: '#3a3a3a',
        gas: '#e8c23a',
      };
      if (pt === 'drain') return [cyl(w / 2, w / 2, Math.max(8, h), 0, 0, 0, col.drain)];
      if (pt.startsWith('water') || pt === 'gas')
        return [
          box(w, h, 8, 0, 0, -d / 2 + 4, '#f2f2f2'),
          cyl(w * 0.3, w * 0.3, h * 0.6, 0, h * 0.2, 0, col[pt]),
        ];
      return [
        box(w, h, d, 0, 0, 0, '#f4f4f2'),
        box(w * 0.5, h * 0.5, 3, 0, h * 0.25, d / 2, col[pt] ?? '#cfcfcf'),
      ];
    }
    default:
      return [box(w, h, d, 0, 0, 0)];
  }
}

/**
 * 樓梯（FE-PLAN-03）：原點＝底部中心、往 −Z（後方）上升。直梯；L 型（左側上行 → 後方平台 → 往 +X）；
 * U 型（左側上行 → 後方平台 → 右側往前上行）；旋轉梯（中柱＋扇形踏板）。實心踏階（階底到地面）。
 */
function stairsParts(shape: string, w: number, d: number, h: number, n: number): Part[] {
  const rise = h / n;
  const out: Part[] = [];
  const step = (x: number, z: number, sw: number, sd: number, i: number) =>
    out.push(box(sw, rise * (i + 1), sd, x, 0, z, i % 2 ? BODY : BODY));
  if (shape === 'spiral') {
    const r = Math.min(w, d) / 2;
    out.push(cyl(60, 60, h + 900, 0, 0, 0, DARK, 16));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 1.75;
      const tread = new THREE.BoxGeometry(r - 60, 40, Math.max(120, ((2 * Math.PI * r) / n) * 0.9));
      tread.translate((r - 60) / 2 + 60, 0, 0);
      tread.rotateY(-a);
      out.push({ g: tread, x: 0, y: rise * (i + 1) - 20, z: 0, color: BODY });
      // 扶手立柱
      out.push(cyl(12, 12, 900, Math.cos(a) * (r - 30), rise * (i + 1), Math.sin(a) * (r - 30), DARK, 6));
    }
    return out;
  }
  if (shape === 'l') {
    const fw = Math.min(w * 0.5, 1100);
    const n1 = Math.ceil(n / 2);
    const n2 = n - n1 - 1;
    const t1 = (d - fw) / n1;
    for (let i = 0; i < n1; i++) step(-w / 2 + fw / 2, d / 2 - t1 * (i + 0.5), fw, t1, i);
    step(-w / 2 + fw / 2, -d / 2 + fw / 2, fw, fw, n1); // 平台
    const t2 = (w - fw) / Math.max(1, n2);
    for (let i = 0; i < n2; i++) step(-w / 2 + fw + t2 * (i + 0.5), -d / 2 + fw / 2, t2, fw, n1 + 1 + i);
    return out;
  }
  if (shape === 'u') {
    const fw = Math.min((w - 100) / 2, 1100);
    const n1 = Math.ceil((n - 1) / 2);
    const n2 = n - n1 - 1;
    const run = d - fw;
    const t1 = run / n1;
    for (let i = 0; i < n1; i++) step(-w / 2 + fw / 2, d / 2 - t1 * (i + 0.5), fw, t1, i);
    step(0, -d / 2 + fw / 2, w, fw, n1); // 平台（全寬）
    const t2 = run / Math.max(1, n2);
    for (let i = 0; i < n2; i++) step(w / 2 - fw / 2, -d / 2 + fw + t2 * (i + 0.5), fw, t2, n1 + 1 + i);
    out.push(box(60, h, run, 0, 0, d / 2 - run / 2, DARK)); // 中間隔牆
    return out;
  }
  const t = d / n;
  for (let i = 0; i < n; i++) step(0, d / 2 - t * (i + 0.5), w, t, i);
  return out;
}

/** 剖面模型：分件組合＋倒角＋軟裝；未列出的類型用簡易分件並把方塊換成圓角 */
function dollhouseParts(
  type: string,
  w: number,
  d: number,
  h: number,
  p: Record<string, number | string>,
): Part[] {
  const bx = rbox(false);
  const soft = rbox(true);
  const legs = (top: number, inset = 40, s = 40, color = ACCENT) =>
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([sx, sz]) => bx(s, top, s, sx! * (w / 2 - inset), 0, sz! * (d / 2 - inset), color));
  switch (type) {
    case 'sofa': {
      // 沙發＝底座＋靠背＋扶手＋坐墊＋靠墊＋抱枕
      const arm = Math.min(180, w * 0.1);
      const seatY = 260;
      const backD = Math.min(200, d * 0.22);
      const n = w - arm * 2 > 1500 ? 3 : 2;
      const cw = (w - arm * 2) / n;
      const out: Part[] = [
        bx(w, seatY - 80, d, 0, 80, 0),
        bx(w, h - 80, backD, 0, 80, -d / 2 + backD / 2),
        soft(arm, h * 0.62 - 80, d, -w / 2 + arm / 2, 80, 0),
        soft(arm, h * 0.62 - 80, d, w / 2 - arm / 2, 80, 0),
        ...legs(80, 60, 50, DARK),
      ];
      const seatD = d - backD - 20;
      const backH = Math.max(120, h - seatY - 150 - 60);
      for (let i = 0; i < n; i++) {
        const cx = -w / 2 + arm + cw * (i + 0.5);
        out.push(soft(cw - 16, 150, seatD, cx, seatY, -d / 2 + backD + seatD / 2 + 10));
        out.push(soft(cw - 16, backH, 170, cx, seatY + 150, -d / 2 + backD + 85));
      }
      const px = w / 2 - arm - 230;
      const pz = -d / 2 + backD + 170 + 70;
      out.push(soft(360, 340, 120, -px, seatY + 150, pz, MORANDI.sage));
      out.push(soft(360, 340, 120, px, seatY + 150, pz, MORANDI.blue));
      return out;
    }
    case 'bed': {
      const mY = 300;
      const out: Part[] = [
        bx(w, mY, d, 0, 0, 0),
        soft(w - 40, 200, d - 80, 0, mY, 20, MORANDI.linen),
        // 被子（蓋住床墊下 2/3）＋床尾毯
        soft(w - 10, 50, d * 0.62, 0, mY + 180, d / 2 - d * 0.31 - 15, MORANDI.beige),
        soft(w + 10, 30, 420, 0, mY + 215, d / 2 - 250, MORANDI.sage),
        bx(w, h, 70, 0, 0, -d / 2 + 35),
      ];
      const pillows = w >= 1200 ? 2 : 1;
      const pw = pillows === 2 ? w * 0.4 : w * 0.7;
      for (let i = 0; i < pillows; i++) {
        const x = pillows === 2 ? (i ? 1 : -1) * w * 0.22 : 0;
        out.push(soft(pw, 140, 380, x, mY + 200, -d / 2 + 290, MORANDI.linen));
      }
      out.push(soft(Math.min(420, w * 0.35), 300, 110, 0, mY + 210, -d / 2 + 520, MORANDI.blue));
      return out;
    }
    case 'chair':
      return [soft(w, 50, d, 0, 430, 0), ...legs(430, 30, 30), bx(w, h - 480, 30, 0, 480, -d / 2 + 15)];
    case 'rug':
      return [soft(w, Math.max(8, h), d, 0, 0, 0)];
    case 'plant': {
      // 盆栽：陶盆＋土＋三團葉叢（矮盆栽的葉叢依高度縮小，不超過目錄高度）
      const r = Math.min(w, d, h * 0.55);
      const potH = h * 0.28;
      const leaf = (s: number, x: number, y: number, z: number, color: string): Part => {
        const g = new THREE.IcosahedronGeometry(r * s, 1);
        g.scale(1, 1.25, 1);
        return { g, x, y, z, color };
      };
      return [
        cyl(r * 0.3, r * 0.22, potH, 0, 0, 0, '#b9794f'),
        cyl(r * 0.28, r * 0.28, 10, 0, potH - 20, 0, '#4a3b2e'),
        cyl(10, 14, h * 0.3, 0, potH, 0, '#5a4a36', 8),
        leaf(0.42, 0, potH + h * 0.36, 0, '#6f8f5f'),
        leaf(0.3, r * 0.2, potH + h * 0.5, r * 0.12, '#7d9c69'),
        leaf(0.28, -r * 0.18, potH + h * 0.55, -r * 0.1, '#5f7f52'),
      ];
    }
    default: {
      // 其餘類型：沿用簡易分件，但全部改為圓角方塊
      return parts(type, w, d, h, p).map((pt) => {
        // 燈具細件（含旋轉的方塊）維持原樣；只把一般方塊換成圓角
        if (
          pt.g.type !== 'BoxGeometry' ||
          pt.color === EMIT ||
          type.startsWith('lamp') ||
          type.startsWith('light') ||
          type.startsWith('led') ||
          type === 'monitor'
        )
          return pt;
        const { width, height, depth } = (pt.g as THREE.BoxGeometry).parameters;
        pt.g.dispose();
        return bx(width, height, depth, pt.x, pt.y - height / 2, pt.z, pt.color);
      });
    }
  }
}

export interface FurnitureStyleOpts {
  style?: ViewStyle;
  /** 剖面模型：body 顏色直接烘進頂點色（instance color 維持白色） */
  bodyColor?: string;
  /** 多材質槽（v1.3，FE-PROP-05）：框架／腳（深色部件）與點綴（抱枕、把手等）的顏色 */
  frameColor?: string;
  accentColor?: string;
}

export function variantKey(
  entry: CatalogEntry | undefined,
  catalogId: string,
  params?: Record<string, unknown>,
): string {
  return entry ? `${catalogId}|${JSON.stringify(resolveParams(entry, params))}` : `${catalogId}|missing`;
}

/** 剖面模型的變體鍵（含 body 顏色，因為顏色烘在幾何裡） */
export const styledVariantKey = (base: string, opts?: FurnitureStyleOpts) =>
  (opts?.style === 'dollhouse' ? `${base}|dh|${opts.bodyColor ?? ''}` : base) +
  (opts?.frameColor || opts?.accentColor ? `|f${opts.frameColor ?? ''}|a${opts.accentColor ?? ''}` : '');

/** 建立（未縮放的）家具幾何。scale 由 instance matrix 套用。 */
export function buildFurnitureGeometry(
  entry: CatalogEntry | undefined,
  params?: Record<string, unknown>,
  opts?: FurnitureStyleOpts,
): THREE.BufferGeometry {
  const r = entry ? resolveParams(entry, params) : {};
  const num = (k: 'w' | 'd' | 'h', fb: number) => (typeof r[k] === 'number' ? (r[k] as number) : fb);
  const w = num('w', entry?.dimsMm.w ?? 500);
  const d = num('d', entry?.dimsMm.d ?? 500);
  const h = num('h', entry?.dimsMm.h ?? 500);
  const type = entry?.model.kind === 'parametric' ? entry.model.type : 'box';
  const dh = opts?.style === 'dollhouse';
  const ps = dh ? dollhouseParts(type, w, d, h, r) : parts(type, w, d, h, r);
  // 自發光部件排在最後，自成 group 1
  ps.sort((x, y) => Number(x.color === EMIT) - Number(y.color === EMIT));
  const color = new THREE.Color();
  let opaque = 0;
  const geoms = ps.map((pt) => {
    const g = (pt.g.index ? pt.g.toNonIndexed() : pt.g) as THREE.BufferGeometry;
    if (g !== pt.g) pt.g.dispose();
    g.translate(pt.x, pt.y, pt.z);
    color
      .set(
        dh && pt.color === BODY
          ? (opts?.bodyColor ?? BODY)
          : pt.color === DARK && opts?.frameColor
            ? opts.frameColor
            : pt.color === ACCENT && opts?.accentColor
              ? opts.accentColor
              : pt.color,
      )
      .convertSRGBToLinear();
    const n = g.getAttribute('position').count;
    if (pt.color !== EMIT) opaque += n;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) cols.set([color.r, color.g, color.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    for (const k of Object.keys(g.attributes))
      if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    return g;
  });
  const merged = mergeGeometries(geoms, false)!;
  geoms.forEach((g) => g.dispose());
  // group 0＝一般部件、group 1＝自發光（單一材質時 group 被忽略，行為與 P2 相同）
  const total = merged.getAttribute('position').count;
  merged.addGroup(0, opaque, 0);
  if (total > opaque) merged.addGroup(opaque, total - opaque, 1);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** 幾何是否含自發光部件 */
export const hasEmissive = (g: THREE.BufferGeometry) => g.groups.some((x) => x.materialIndex === 1);

/**
 * 開口內的門扇／窗框（僅視覺，牆洞由牆幾何處理）；style 決定造型（FE-PLAN-04）：
 * 門：single／double／unequal（子母）／sliding（兩片錯位）／folding（折疊多片）／pocket（隱藏，只留門框）／arch（無門扇）；
 * 窗：sliding（兩扇）／casement（推射，中梃）／fixed（單片大玻璃）／awning（上懸）／bay（凸窗盒）／corner。
 */
export function buildOpeningFill(
  type: 'door' | 'window' | 'passage',
  width: number,
  height: number,
  thickness: number,
  style?: string,
  openAngle = 0,
): THREE.BufferGeometry | null {
  if (type === 'passage') return null;
  const LEAF = '#b89a78';
  const FRAME = LIGHT;
  let ps: Part[];
  if (type === 'door') {
    const st = style ?? 'single';
    const frame = [
      box(40, height, thickness, -width / 2 + 20, 0, 0, FRAME),
      box(40, height, thickness, width / 2 - 20, 0, 0, FRAME),
      box(width, 40, thickness, 0, height - 40, 0, FRAME),
    ];
    const leaf = (w: number, x: number, z = 0, hinge: 'l' | 'r' = 'l'): Part[] => {
      const a = (openAngle * Math.PI) / 180;
      const g = new THREE.BoxGeometry(Math.max(1, w), height - 50, 40);
      // 以鉸鏈邊為軸旋轉
      g.translate(hinge === 'l' ? w / 2 : -w / 2, 0, 0);
      g.rotateY(hinge === 'l' ? -a : a);
      const hx = hinge === 'l' ? x - w / 2 : x + w / 2;
      const handle = box(20, 20, 60, x + (hinge === 'l' ? w / 2 - 80 : -w / 2 + 80), height * 0.47, z, DARK);
      return [{ g, x: hx, y: (height - 50) / 2, z, color: LEAF }, ...(openAngle ? [] : [handle])];
    };
    const inner = width - 80;
    if (st === 'arch' || st === 'pocket') ps = [...frame];
    else if (st === 'double')
      ps = [...frame, ...leaf(inner / 2, -inner / 4, 0, 'l'), ...leaf(inner / 2, inner / 4, 0, 'r')];
    else if (st === 'unequal')
      ps = [
        ...frame,
        ...leaf(inner * 0.66, -inner * 0.17, 0, 'l'),
        ...leaf(inner * 0.34, inner * 0.33, 0, 'r'),
      ];
    else if (st === 'sliding')
      ps = [
        ...frame,
        box(inner / 2 + 40, height - 50, 30, -inner / 4 + 20, 0, -18, LEAF),
        box(inner / 2 + 40, height - 50, 30, inner / 4 - 20, 0, 18, LEAF),
        box(inner * 0.4, height * 0.6, 32, -inner / 4 + 20, height * 0.2, -18, GLASS),
      ];
    else if (st === 'folding') {
      const k = Math.max(3, Math.round(inner / 450));
      ps = [...frame];
      for (let i = 0; i < k; i++) {
        const pw = inner / k;
        ps.push(box(pw - 6, height - 50, 30, -inner / 2 + pw * (i + 0.5), 0, i % 2 ? 10 : -10, LEAF));
      }
    } else ps = [...frame, ...leaf(inner, 0, 0, 'l')];
  } else {
    const st = style ?? 'sliding';
    const t = thickness;
    const frame = [
      box(width, 50, t, 0, 0, 0, FRAME),
      box(width, 50, t, 0, height - 50, 0, FRAME),
      box(50, height, t, -width / 2 + 25, 0, 0, FRAME),
      box(50, height, t, width / 2 - 25, 0, 0, FRAME),
    ];
    if (st === 'bay') {
      const depth = 450;
      ps = [
        ...frame,
        box(width, 60, depth + t, 0, -60, -(depth / 2), FRAME), // 窗台板（外凸）
        box(width, 60, depth + t, 0, height, -(depth / 2), FRAME),
        box(50, height, depth, -width / 2 + 25, 0, -depth / 2 - t / 2, FRAME),
        box(50, height, depth, width / 2 - 25, 0, -depth / 2 - t / 2, FRAME),
        box(width - 100, height - 100, 10, 0, 50, -depth - t / 2 + 5, GLASS),
        box(10, height - 100, depth - 60, -width / 2 + 30, 50, -depth / 2 - t / 2, GLASS),
        box(10, height - 100, depth - 60, width / 2 - 30, 50, -depth / 2 - t / 2, GLASS),
      ];
    } else if (st === 'fixed' || st === 'corner')
      ps = [...frame, box(width - 100, height - 100, 10, 0, 50, 0, GLASS)];
    else if (st === 'casement' || st === 'awning')
      ps = [
        ...frame,
        st === 'casement'
          ? box(40, height - 100, t * 0.8, 0, 50, 0, FRAME)
          : box(width - 100, 40, t * 0.8, 0, height * 0.5, 0, FRAME),
        box(width - 100, height - 100, 10, 0, 50, 0, GLASS),
      ];
    else
      ps = [
        ...frame,
        box(40, height - 100, t * 0.8, 0, 50, 0, FRAME),
        box((width - 100) / 2, height - 100, 10, -(width - 100) / 4, 50, -t * 0.15, GLASS),
        box((width - 100) / 2, height - 100, 10, (width - 100) / 4, 50, t * 0.15, GLASS),
      ];
  }
  // 玻璃排在最後並自成 group 1（剖面模型用半透明材質；單一材質時 group 會被忽略）
  ps.sort((x, y) => Number(x.color === GLASS) - Number(y.color === GLASS));
  const color = new THREE.Color();
  let opaque = 0;
  const geoms = ps.map((pt) => {
    const g = pt.g.index ? pt.g.toNonIndexed() : pt.g;
    if (g !== pt.g) pt.g.dispose();
    g.translate(pt.x, pt.y, pt.z);
    color.set(pt.color).convertSRGBToLinear();
    const n = g.getAttribute('position').count;
    if (pt.color !== GLASS) opaque += n;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) cols.set([color.r, color.g, color.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return g;
  });
  const merged = mergeGeometries(geoms, false)!;
  geoms.forEach((g) => g.dispose());
  const total = merged.getAttribute('position').count;
  merged.addGroup(0, opaque, 0);
  if (total > opaque) merged.addGroup(opaque, total - opaque, 1);
  return merged;
}
