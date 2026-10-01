import type { updateWall } from '@interiorai/app-state';
import type { Wall } from '@interiorai/scene-schema';

type Patch = Parameters<typeof updateWall>[2];

/**
 * 背景牆模板（FE-FIN-02）：一鍵套用到選取牆的 A 或 B 面（單一 undo）。
 * 由既有欄位組成——牆面材質（含壁紙）、護牆板／腰牆、頂角線——所以套用後每一項都還能個別再調。
 */
export const FEATURE_WALLS = [
  'marbleTv',
  'walnutSlat',
  'classicPanel',
  'twoTone',
  'wallpaperAccent',
  'zellige',
] as const;
export type FeatureWall = (typeof FEATURE_WALLS)[number];

/** 縮圖用主色（底色、上半部花色） */
export const FEATURE_WALL_SWATCH: Record<FeatureWall, [string, string]> = {
  marbleTv: ['#e9e6e1', '#d7d2c9'],
  walnutSlat: ['#5b4130', '#7a5a43'],
  classicPanel: ['#efe9dc', '#e2d9c6'],
  twoTone: ['#5b6e5a', '#e7e1d4'],
  wallpaperAccent: ['#f0ebe0', '#d6c9ab'],
  zellige: ['#3f7a64', '#5c9a80'],
};

export function featureWallPatch(kind: FeatureWall, side: 'A' | 'B', w: Pick<Wall, 'wainscot'>): Patch {
  const mat = (id: string): Patch => (side === 'A' ? { materialId: id } : { materialIdB: id });
  // 另一面已有護牆板時保留（sides 改成兩面都有或只剩另一面）
  const keepOther = w.wainscot && w.wainscot.sides !== side ? w.wainscot : undefined;
  const wainscot = (x: NonNullable<Wall['wainscot']>): Patch => ({
    wainscot: keepOther ? { ...x, sides: 'both' } : x,
  });
  const noWainscot: Patch = {
    wainscot: keepOther ? { ...keepOther, sides: side === 'A' ? 'B' : 'A' } : undefined,
  };
  switch (kind) {
    case 'marbleTv':
      return { ...mat('stone_calacatta_marble'), ...noWainscot, crown: undefined };
    case 'walnutSlat':
      return {
        ...mat('veneer_walnut_veneer'),
        ...wainscot({ height: 2000, style: 'beadboard', sides: side, materialId: 'veneer_walnut_veneer' }),
        crown: undefined,
      };
    case 'classicPanel':
      return {
        ...mat('paint_ivory'),
        ...wainscot({ height: 900, style: 'panel', sides: side, color: '#efe9dc' }),
        crown: { height: 120, profile: 'cove' },
        baseboardProfile: 'cove',
      };
    case 'twoTone':
      return {
        ...mat('paint_linen'),
        ...wainscot({ height: 1000, style: 'flat', sides: side, color: '#5b6e5a' }),
        crown: undefined,
      };
    case 'wallpaperAccent':
      return {
        ...mat('wallpaper_damask_ivory'),
        ...wainscot({ height: 900, style: 'panel', sides: side, color: '#f0ebe0' }),
        crown: { height: 80, profile: 'flat' },
      };
    case 'zellige':
      return { ...mat('walltile_zellige_green'), ...noWainscot, crown: undefined };
  }
}
