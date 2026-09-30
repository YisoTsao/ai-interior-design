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
/** 剖面模型的莫蘭迪軟裝色（低飽和） */
const MORANDI = { sage: '#a3b09a', blue: '#9aa8b5', beige: '#d9cdb8', grey: '#b3aea7', linen: '#efebe3' };

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color = BODY): Part => ({
  g: new THREE.BoxGeometry(Math.max(1, w), Math.max(1, h), Math.max(1, d)),
  x,
  y: y + h / 2,
  z,
  color,
});
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
        cyl(w * 0.35, w * 0.5, 300, 0, h - 300, 0, LIGHT),
      ];
    case 'lamp_pendant':
      return [cyl(4, 4, h * 0.5, 0, h * 0.5, 0, DARK), cyl(w * 0.15, w * 0.5, h * 0.5, 0, 0, 0)];
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
    default:
      return [box(w, h, d, 0, 0, 0)];
  }
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
      // 盆栽：陶盆＋土＋三團葉叢
      const r = Math.min(w, d);
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
        if (pt.g.type !== 'BoxGeometry') return pt;
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
  opts?.style === 'dollhouse' ? `${base}|dh|${opts.bodyColor ?? ''}` : base;

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
  const color = new THREE.Color();
  const geoms = ps.map((pt) => {
    const g = (pt.g.index ? pt.g.toNonIndexed() : pt.g) as THREE.BufferGeometry;
    if (g !== pt.g) pt.g.dispose();
    g.translate(pt.x, pt.y, pt.z);
    color.set(dh && pt.color === BODY ? (opts?.bodyColor ?? BODY) : pt.color).convertSRGBToLinear();
    const n = g.getAttribute('position').count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) cols.set([color.r, color.g, color.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    for (const k of Object.keys(g.attributes))
      if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    return g;
  });
  const merged = mergeGeometries(geoms, false)!;
  geoms.forEach((g) => g.dispose());
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** 開口內的門扇/窗框（僅視覺，幾何挖洞由 CSG 處理） */
export function buildOpeningFill(
  type: 'door' | 'window' | 'passage',
  width: number,
  height: number,
  thickness: number,
): THREE.BufferGeometry | null {
  if (type === 'passage') return null;
  const ps: Part[] =
    type === 'door'
      ? [
          box(width - 20, height - 10, 40, 0, 0, 0, '#b89a78'),
          box(20, 20, 60, width / 2 - 90, height * 0.47, 0, DARK),
        ]
      : [
          box(width, 50, thickness, 0, 0, 0, LIGHT),
          box(width, 50, thickness, 0, height - 50, 0, LIGHT),
          box(50, height, thickness, -width / 2 + 25, 0, 0, LIGHT),
          box(50, height, thickness, width / 2 - 25, 0, 0, LIGHT),
          box(width - 100, height - 100, 10, 0, 50, 0, GLASS),
        ];
  // 玻璃排在最後並自成 group 1（剖面模型用半透明材質；單一材質時 group 會被忽略）
  ps.sort((x, y) => Number(x.color === GLASS) - Number(y.color === GLASS));
  const color = new THREE.Color();
  let opaque = 0;
  const geoms = ps.map((pt) => {
    const g = pt.g.toNonIndexed();
    pt.g.dispose();
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
