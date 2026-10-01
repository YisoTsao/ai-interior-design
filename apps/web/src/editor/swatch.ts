import type { Material } from '@interiorai/catalog';
import { drawWallpaper } from '@interiorai/viewer-3d';

const wallpaperUrls = new Map<string, string>();
/** 壁紙縮圖：用與 3D 相同的花紋繪製（快取） */
function wallpaperSwatch(m: Material): string {
  let u = wallpaperUrls.get(m.id);
  if (!u && typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    drawWallpaper(c.getContext('2d')!, 96, m.motif ?? 'stripe', m.color, m.accent ?? m.color);
    u = c.toDataURL('image/png');
    wallpaperUrls.set(m.id, u);
  }
  return u ? `url(${u}) center / 48px 48px repeat` : m.color;
}

/** 材質縮圖的 CSS 紋理（木紋條、磁磚格、石材斑點） */
export function swatchCss(m: Material): string {
  if (m.pattern === 'image' && m.textureUrl) return `url(${m.textureUrl}) center / cover`;
  if (m.pattern === 'wallpaper') return wallpaperSwatch(m);
  const c = m.color;
  if (m.pattern === 'wood')
    return `repeating-linear-gradient(0deg, ${c} 0 7px, color-mix(in srgb, ${c} 82%, black) 7px 8px)`;
  if (m.pattern === 'tile')
    return `linear-gradient(${c}, ${c}) padding-box, repeating-linear-gradient(0deg, transparent 0 13px, color-mix(in srgb, ${c} 65%, black) 13px 14px), repeating-linear-gradient(90deg, ${c} 0 13px, color-mix(in srgb, ${c} 65%, black) 13px 14px)`;
  if (m.pattern === 'stone')
    return `radial-gradient(circle at 30% 40%, color-mix(in srgb, ${c} 80%, black) 0 2px, transparent 3px), radial-gradient(circle at 70% 70%, color-mix(in srgb, ${c} 85%, white) 0 3px, transparent 4px), ${c}`;
  return c;
}
