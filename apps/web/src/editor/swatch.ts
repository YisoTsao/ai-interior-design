import type { Material } from '@interiorai/catalog';

/** 材質縮圖的 CSS 紋理（木紋條、磁磚格、石材斑點） */
export function swatchCss(m: Material): string {
  if (m.pattern === 'image' && m.textureUrl) return `url(${m.textureUrl}) center / cover`;
  const c = m.color;
  if (m.pattern === 'wood')
    return `repeating-linear-gradient(0deg, ${c} 0 7px, color-mix(in srgb, ${c} 82%, black) 7px 8px)`;
  if (m.pattern === 'tile')
    return `linear-gradient(${c}, ${c}) padding-box, repeating-linear-gradient(0deg, transparent 0 13px, color-mix(in srgb, ${c} 65%, black) 13px 14px), repeating-linear-gradient(90deg, ${c} 0 13px, color-mix(in srgb, ${c} 65%, black) 13px 14px)`;
  if (m.pattern === 'stone')
    return `radial-gradient(circle at 30% 40%, color-mix(in srgb, ${c} 80%, black) 0 2px, transparent 3px), radial-gradient(circle at 70% 70%, color-mix(in srgb, ${c} 85%, white) 0 3px, transparent 4px), ${c}`;
  return c;
}
