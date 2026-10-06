import * as THREE from 'three';
import type { Material as CatalogMaterial } from '@interiorai/catalog';
import type { Tiling } from '@interiorai/scene-schema';

/**
 * 鋪貼紋理（FE-FIN-01）：依拼法產生「一個重複單元」的程序化貼圖（磚色取自底材質、逐片色差、填縫線），
 * repeat 以真實尺寸（mm）換算（UV＝平面 mm 座標）；旋轉與起鋪點用貼圖 rotation／offset。
 */
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)] as const;
};

/** 重複單元尺寸（mm） */
export function tilingUnit(t: Tiling): { w: number; h: number } {
  const g = t.grout ?? 2;
  const n = Math.max(2, Math.round(Math.max(t.tileW, t.tileH) / Math.min(t.tileW, t.tileH)));
  const W = Math.min(t.tileW, t.tileH);
  switch (t.pattern) {
    case 'running':
      return { w: t.tileW + g, h: 2 * (t.tileH + g) };
    case 'herringbone':
    case 'chevron':
      return { w: 2 * n * W, h: 2 * n * W };
    case 'basketweave':
      return { w: 2 * n * W, h: 2 * n * W };
    case 'hexagon': {
      const r = t.tileW / 2;
      return { w: Math.sqrt(3) * r, h: 3 * r };
    }
    case 'versailles':
      return { w: 3 * (t.tileW + g), h: 3 * (t.tileW + g) };
    default:
      return { w: t.tileW + g, h: t.tileH + g };
  }
}

export function tilingTexture(
  base: Pick<CatalogMaterial, 'color' | 'pattern'>,
  t: Tiling,
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const unit = tilingUnit(t);
  const S = 512;
  const sx = S / unit.w;
  const sy = S / unit.h;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  const grout = t.groutColor ?? '#bdb8ae';
  const gpx = Math.max(1, (t.grout ?? 2) * Math.min(sx, sy));
  const tone = (a: number, b: number) => shade(base.color, 0.9 + hash(a, b) * 0.16);
  const wood = base.pattern === 'wood';
  if (t.pattern === 'herringbone' || t.pattern === 'chevron' || t.pattern === 'basketweave') {
    // 逐像素：以「板寬」為單位的格子；每塊板＝n 個連續格
    const W = Math.min(t.tileW, t.tileH);
    const n = Math.max(2, Math.round(Math.max(t.tileW, t.tileH) / W));
    const img = g.createImageData(S, S);
    const plank = (gx: number, gy: number): [number, number, boolean] => {
      if (t.pattern === 'basketweave') {
        const bx = Math.floor(gx / n);
        const by = Math.floor(gy / n);
        const horiz = (bx + by) % 2 === 0;
        return horiz ? [bx * 1000 + by, gy, true] : [bx * 1000 + by, gx + 500, false];
      }
      const k = (((gx + gy) % (2 * n)) + 2 * n) % (2 * n);
      const block = Math.floor((gx + gy) / n);
      const horiz = k < n;
      return horiz ? [block, gy, true] : [block, gx + 777, false];
    };
    for (let py = 0; py < S; py++)
      for (let px = 0; px < S; px++) {
        const x = px / sx / W;
        const y = py / sy / W;
        const gx = Math.floor(x);
        const gy = Math.floor(y);
        const [pa, pb, horiz] = plank(gx, gy);
        // 與相鄰格不同板 → 邊界（填縫）
        const fx = x - gx;
        const fy = y - gy;
        const gw = gpx / sx / W;
        let edge = false;
        if (fx < gw) {
          const q = plank(gx - 1, gy);
          edge ||= q[0] !== pa || q[1] !== pb;
        }
        if (fy < gw) {
          const q = plank(gx, gy - 1);
          edge ||= q[0] !== pa || q[1] !== pb;
        }
        const i = (py * S + px) * 4;
        if (edge) {
          const gc = shade(grout, 1);
          img.data.set([gc[0], gc[1], gc[2], 255], i);
        } else {
          let [r, gg, b] = tone(pa, pb);
          if (wood) {
            const grain = 0.94 + 0.06 * Math.sin((horiz ? fy : fx) * 40 + hash(pa, pb) * 6);
            r *= grain;
            gg *= grain;
            b *= grain;
          }
          img.data.set([r, gg, b, 255], i);
        }
      }
    g.putImageData(img, 0, 0);
  } else {
    g.fillStyle = grout;
    g.fillRect(0, 0, S, S);
    const tile = (x: number, y: number, w: number, h: number, a: number, b: number) => {
      const [r, gg, bb] = tone(a, b);
      g.fillStyle = `rgb(${r},${gg},${bb})`;
      // 畫在單元內與環繞位置，確保無縫
      for (const ox of [-S, 0, S])
        for (const oy of [-S, 0, S])
          g.fillRect(x * sx + ox + gpx / 2, y * sy + oy + gpx / 2, w * sx - gpx, h * sy - gpx);
    };
    const tw = t.tileW + (t.grout ?? 2);
    const th = t.tileH + (t.grout ?? 2);
    if (t.pattern === 'running') {
      tile(0, 0, tw, th, 1, 1);
      tile(-tw / 2, th, tw, th, 2, 2);
      tile(tw / 2, th, tw, th, 3, 3);
    } else if (t.pattern === 'hexagon') {
      const r = t.tileW / 2;
      const hexAt = (cx: number, cy: number, a: number) => {
        const [R, G, B] = tone(a, a * 3);
        g.fillStyle = `rgb(${R},${G},${B})`;
        for (const ox of [-S, 0, S])
          for (const oy of [-S, 0, S]) {
            g.beginPath();
            for (let k = 0; k < 6; k++) {
              const ang = (Math.PI / 3) * k + Math.PI / 6;
              const px = (cx + Math.cos(ang) * (r - (t.grout ?? 2) / 2)) * sx + ox;
              const py = (cy + Math.sin(ang) * (r - (t.grout ?? 2) / 2)) * sy + oy;
              if (k) g.lineTo(px, py);
              else g.moveTo(px, py);
            }
            g.closePath();
            g.fill();
          }
      };
      hexAt(0, 0, 1);
      hexAt(unit.w / 2, unit.h / 2, 2);
      hexAt(unit.w, 0, 1);
      hexAt(0, unit.h, 1);
      hexAt(unit.w, unit.h, 1);
    } else if (t.pattern === 'versailles') {
      // 3×3 單元：一塊 2×2 大磚、兩塊 1×2、一塊 1×1
      const u = tw;
      tile(0, 0, 2 * u, 2 * u, 1, 1);
      tile(2 * u, 0, u, 2 * u, 2, 2);
      tile(0, 2 * u, 2 * u, u, 3, 3);
      tile(2 * u, 2 * u, u, u, 4, 4);
    } else tile(0, 0, tw, th, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.repeat.set(1 / unit.w, 1 / unit.h);
  const rot = ((t.rotationDeg ?? 0) + (t.pattern === 'diagonal' ? 45 : 0)) * (Math.PI / 180);
  tex.rotation = rot;
  if (t.offset) tex.offset.set(t.offset[0] / unit.w, t.offset[1] / unit.h);
  return tex;
}

/** 估料：塊數＝面積 ÷ 單磚面積 ×（1＋損耗）；回傳塊數與盒數（每盒 1 m²，〔假設〕） */
export function tileQuantity(areaMm2: number, t: Tiling) {
  const one = t.tileW * t.tileH;
  const pieces = Math.ceil((areaMm2 / one) * (1 + (t.waste ?? 0.08)));
  return { pieces, m2: Math.ceil(((pieces * one) / 1e6) * 10) / 10 };
}
