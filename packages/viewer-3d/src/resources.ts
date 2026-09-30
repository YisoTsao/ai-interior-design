import * as THREE from 'three';
import type { Material as CatalogMaterial } from '@interiorai/catalog';
import type { Appearance } from '@interiorai/scene-schema';

/** 追蹤本 viewer 建立的 GPU 資源；卸載/切換專案時一次 dispose（B5、03 §3） */
export class ResourceScope {
  private items = new Set<{ dispose(): void }>();
  track<T extends { dispose(): void }>(r: T): T {
    this.items.add(r);
    return r;
  }
  release(r: { dispose(): void }) {
    if (this.items.delete(r)) r.dispose();
  }
  disposeAll() {
    for (const r of this.items) r.dispose();
    this.items.clear();
  }
  get size() {
    return this.items.size;
  }
}

/** 決定性亂數（貼圖每次產生都一樣） */
const rand = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const hexShade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

/**
 * 剖面模型用的高品質程序化貼圖：木紋為錯縫長條地板（紋理方向一律沿 +X），
 * 磁磚有填縫與逐片色差。一個貼圖單元 = realSizeMm。
 */
function hqPatternTexture(m: CatalogMaterial): THREE.CanvasTexture | null {
  if (m.pattern === 'plain' || typeof document === 'undefined') return null;
  const S = m.pattern === 'wood' ? 1024 : 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  const rnd = rand(parseInt(m.color.slice(1), 16) || 7);
  g.fillStyle = m.color;
  g.fillRect(0, 0, S, S);
  if (m.pattern === 'wood') {
    const rows = 6; // 1200 mm / 6 = 200 mm 寬的地板條
    const rh = S / rows;
    for (let r = 0; r < rows; r++) {
      const y0 = r * rh;
      // 每列兩道接縫，錯開
      const joints = [((r * 0.37) % 1) * S, (((r * 0.37) % 1) * S + S * 0.55) % S].sort((a, b) => a - b);
      const segs: [number, number][] = [
        [joints[0]! - S, joints[0]!],
        [joints[0]!, joints[1]!],
        [joints[1]!, joints[0]! + S],
      ];
      for (const [x0, x1] of segs) {
        const tone = 0.93 + rnd() * 0.12;
        g.fillStyle = hexShade(m.color, tone);
        for (const off of [0, S, -S]) g.fillRect(x0 + off, y0, x1 - x0, rh);
        // 木紋：沿 X 的細長曲線
        for (let k = 0; k < 14; k++) {
          const yy = y0 + 3 + rnd() * (rh - 6);
          g.strokeStyle = hexShade(m.color, tone * (0.78 + rnd() * 0.16));
          g.globalAlpha = 0.35 + rnd() * 0.35;
          g.lineWidth = 0.6 + rnd() * 1.6;
          for (const off of [0, S, -S]) {
            g.beginPath();
            g.moveTo(x0 + off, yy);
            const amp = (rnd() - 0.5) * 6;
            g.bezierCurveTo(
              x0 + off + (x1 - x0) * 0.3,
              yy + amp,
              x0 + off + (x1 - x0) * 0.7,
              yy - amp,
              x1 + off,
              yy,
            );
            g.stroke();
          }
        }
        g.globalAlpha = 1;
        // 接縫
        g.fillStyle = hexShade(m.color, 0.55);
        for (const off of [0, S, -S]) g.fillRect(x0 + off - 1, y0, 2, rh);
      }
      g.fillStyle = hexShade(m.color, 0.5);
      g.fillRect(0, y0, S, 2);
    }
  } else if (m.pattern === 'tile') {
    const grout = Math.max(4, S / 90);
    g.fillStyle = hexShade(m.color, 1 + (rnd() - 0.5) * 0.06);
    g.fillRect(0, 0, S, S);
    // 輕微的表面斑點
    for (let i = 0; i < 400; i++) {
      g.fillStyle = hexShade(m.color, 0.94 + rnd() * 0.1);
      g.globalAlpha = 0.4;
      g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 4, 2 + rnd() * 4);
    }
    g.globalAlpha = 1;
    g.fillStyle = hexShade(m.color, 0.68);
    g.fillRect(0, 0, S, grout / 2);
    g.fillRect(0, S - grout / 2, S, grout / 2);
    g.fillRect(0, 0, grout / 2, S);
    g.fillRect(S - grout / 2, 0, grout / 2, S);
  } else {
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = hexShade(m.color, 0.7 + rnd() * 0.6);
      g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 5, 2 + rnd() * 4);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1 / m.realSizeMm.w, 1 / m.realSizeMm.h);
  tex.anisotropy = 8;
  return tex;
}

/** 程序化貼圖：UV 以 mm 為單位，repeat = 1 / realSize → 貼圖重複率隨面積自動正確（FR-303） */
function patternTexture(m: CatalogMaterial): THREE.CanvasTexture | null {
  if (m.pattern === 'plain' || typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = m.color;
  g.fillRect(0, 0, 256, 256);
  const shade = (k: number) => {
    const n = parseInt(m.color.slice(1), 16);
    const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  };
  if (m.pattern === 'wood') {
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = shade(0.85 + ((i * 37) % 20) / 100);
      g.lineWidth = 1 + (i % 3);
      g.beginPath();
      g.moveTo(0, (i * 6.4) % 256);
      g.bezierCurveTo(80, ((i * 6.4) % 256) + 4, 170, ((i * 6.4) % 256) - 4, 256, (i * 6.4) % 256);
      g.stroke();
    }
    g.strokeStyle = shade(0.6);
    g.lineWidth = 3;
    g.strokeRect(0, 0, 256, 256);
  } else if (m.pattern === 'tile') {
    g.strokeStyle = shade(0.75);
    g.lineWidth = 4;
    g.strokeRect(2, 2, 252, 252);
  } else {
    for (let i = 0; i < 500; i++) {
      g.fillStyle = shade(0.7 + ((i * 53) % 60) / 100);
      g.fillRect((i * 97) % 256, (i * 61) % 256, 2 + (i % 4), 2 + (i % 3));
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1 / m.realSizeMm.w, 1 / m.realSizeMm.h);
  tex.anisotropy = 4;
  return tex;
}

export interface MaterialCacheOpts {
  /** 剖面模型：高品質貼圖、牆面 roughness 固定 */
  hq?: boolean;
  wallRoughness?: number;
  /** 夜間氛圍：地板更光滑（反射燈光） */
  floorRoughness?: number;
}

/** 以 materialId 取得共用材質（同一 scope 內快取；B5：材質以 id 引用） */
export class MaterialCache {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  constructor(
    private scope: ResourceScope,
    private lib: Map<string, CatalogMaterial>,
    private opts: MaterialCacheOpts = {},
  ) {}
  get(id: string | undefined, fallback = '#d9d6cf'): THREE.MeshStandardMaterial {
    const key = id ?? `__${fallback}`;
    let m = this.cache.get(key);
    if (m) return m;
    const def = id ? this.lib.get(id) : undefined;
    const tex = def ? (this.opts.hq ? hqPatternTexture(def) : patternTexture(def)) : null;
    if (tex) this.scope.track(tex);
    const wallish = !def || def.category === 'wall';
    m = this.scope.track(
      new THREE.MeshStandardMaterial({
        color: tex ? '#ffffff' : (def?.color ?? fallback),
        map: tex,
        roughness:
          this.opts.floorRoughness !== undefined && def?.category === 'floor'
            ? Math.min(def.roughness, this.opts.floorRoughness)
            : this.opts.wallRoughness !== undefined && wallish && def?.pattern !== 'tile'
              ? this.opts.wallRoughness
              : (def?.roughness ?? 0.85),
        metalness: def?.metalness ?? 0,
        side: THREE.FrontSide,
      }),
    );
    this.cache.set(key, m);
    return m;
  }
  /**
   * 套用外觀覆寫的衍生材質（ADR-023）：貼圖共用、只換底色／粗糙度／金屬度／透明度。
   * 無覆寫時回傳共用材質本身。
   */
  styled(id: string | undefined, fallback: string, a: Appearance | undefined): THREE.MeshStandardMaterial {
    const base = this.get(id, fallback);
    if (
      !a ||
      (a.color === undefined &&
        a.roughness === undefined &&
        a.metalness === undefined &&
        a.opacity === undefined)
    )
      return base;
    const key = `${id ?? `__${fallback}`}|${a.color ?? ''}|${a.roughness ?? ''}|${a.metalness ?? ''}|${a.opacity ?? ''}`;
    let m = this.cache.get(key);
    if (m) return m;
    m = this.scope.track(base.clone());
    // 有貼圖時貼圖本身帶底色 → 以 color 乘上去作為「染色」；純色材質直接換色
    if (a.color) m.color.set(a.color);
    if (a.roughness !== undefined) m.roughness = a.roughness;
    if (a.metalness !== undefined) m.metalness = a.metalness;
    if (a.opacity !== undefined && a.opacity < 1) {
      m.transparent = true;
      m.opacity = a.opacity;
      m.depthWrite = false;
    }
    this.cache.set(key, m);
    return m;
  }
  /** 材質庫中的物理參數（家具頂點色材質用） */
  surface(id: string | undefined): { roughness: number; metalness: number } {
    const def = id ? this.lib.get(id) : undefined;
    return { roughness: def?.roughness ?? 0.8, metalness: def?.metalness ?? 0 };
  }
  colorOf(id: string | undefined, fallback = '#d9d6cf'): THREE.Color {
    return new THREE.Color(id ? (this.lib.get(id)?.color ?? fallback) : fallback);
  }
}
