import * as THREE from 'three';
import type { Material as CatalogMaterial } from '@interiorai/catalog';

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

/** 以 materialId 取得共用材質（同一 scope 內快取；B5：材質以 id 引用） */
export class MaterialCache {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  constructor(
    private scope: ResourceScope,
    private lib: Map<string, CatalogMaterial>,
  ) {}
  get(id: string | undefined, fallback = '#d9d6cf'): THREE.MeshStandardMaterial {
    const key = id ?? `__${fallback}`;
    let m = this.cache.get(key);
    if (m) return m;
    const def = id ? this.lib.get(id) : undefined;
    const tex = def ? patternTexture(def) : null;
    if (tex) this.scope.track(tex);
    m = this.scope.track(
      new THREE.MeshStandardMaterial({
        color: tex ? '#ffffff' : (def?.color ?? fallback),
        map: tex,
        roughness: def?.roughness ?? 0.85,
        side: THREE.FrontSide,
      }),
    );
    this.cache.set(key, m);
    return m;
  }
  colorOf(id: string | undefined, fallback = '#d9d6cf'): THREE.Color {
    return new THREE.Color(id ? (this.lib.get(id)?.color ?? fallback) : fallback);
  }
}
