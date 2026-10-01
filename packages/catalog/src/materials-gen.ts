import type { Material } from './schema.js';

/**
 * 擴充材質庫（FE-FIN-07）：以參數表產生約 190 種程序化材質（塗料、木地板、地磚、石材、壁磚、布料、皮革、金屬、木皮、天花）。
 * 自產（色碼＋貼圖尺寸＋粗糙度），授權同 OWN_LICENSE；價格為〔假設〕參考價。
 */
const OWN: Material['license'] = {
  type: 'proprietary-own',
  source: 'InteriorAI 自產程序化材質',
  allowedUse: ['commercial', 'render', 'redistribute'],
};
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
const mk = (
  prefix: string,
  en: string,
  zh: string,
  category: Material['category'],
  color: string,
  pattern: Material['pattern'],
  size: [number, number],
  roughness: number,
  extra: Partial<Material> = {},
): Material => ({
  id: `${prefix}_${slug(en)}`,
  nameZh: zh,
  nameEn: en,
  category,
  color,
  pattern,
  realSizeMm: { w: size[0], h: size[1] },
  roughness,
  license: OWN,
  ...extra,
});

const PAINTS: [string, string, string][] = [
  ['Cloud White', '雲朵白', '#F4F2EC'],
  ['Ivory', '象牙白', '#EFE8D8'],
  ['Linen', '亞麻', '#E6DCCB'],
  ['Oat', '燕麥', '#DCCFB8'],
  ['Milk Tea', '奶茶', '#CDB9A0'],
  ['Mushroom', '蘑菇灰', '#B9ADA0'],
  ['Greige', '灰米', '#B3ABA0'],
  ['Pebble', '卵石灰', '#A9A6A0'],
  ['Stone Grey', '石灰', '#8F8D88'],
  ['Graphite', '石墨', '#4A4B4D'],
  ['Charcoal', '炭黑', '#2F3032'],
  ['Sage', '鼠尾草', '#A7B5A0'],
  ['Eucalyptus', '尤加利', '#8FA597'],
  ['Olive', '橄欖綠', '#7A7B55'],
  ['Forest', '森林綠', '#3F5A4A'],
  ['Mint', '薄荷', '#BFD8CC'],
  ['Mist Blue', '霧藍', '#A9B8C4'],
  ['Denim', '丹寧藍', '#5D7896'],
  ['Navy', '海軍藍', '#2F3E55'],
  ['Teal', '藍綠', '#3E6E73'],
  ['Terracotta', '陶土橘', '#C4775A'],
  ['Clay', '陶土粉', '#C99A83'],
  ['Ochre', '赭黃', '#C99A45'],
  ['Mustard', '芥末黃', '#D2A942'],
  ['Butter', '奶油黃', '#EFDDA5'],
  ['Blush', '腮紅粉', '#E4C3BD'],
  ['Dusty Rose', '乾燥玫瑰', '#C29593'],
  ['Burgundy', '酒紅', '#6E2E34'],
  ['Lavender', '薰衣草', '#B9AFCB'],
  ['Plum', '梅子紫', '#5E4659'],
  ['Cocoa', '可可', '#6B4E3D'],
  ['Caramel', '焦糖', '#A56C3F'],
];
const WOODS: [string, string, string, number][] = [
  ['Natural Oak', '原色橡木', '#C8A77E', 3200],
  ['White-washed Oak', '白洗橡木', '#DCCBB1', 3600],
  ['Smoked Oak', '煙燻橡木', '#8C6A4A', 4200],
  ['Grey Oak', '灰橡木', '#A89C8C', 3800],
  ['Walnut', '胡桃木', '#6E4B32', 4800],
  ['Teak', '柚木', '#9C6B3E', 5200],
  ['Maple', '楓木', '#D9BE95', 3400],
  ['Ash', '白蠟木', '#D3BF9E', 3300],
  ['Cherry', '櫻桃木', '#A0583A', 4600],
  ['Hickory', '山核桃', '#B8875A', 3900],
  ['Wenge', '雞翅木', '#4A3528', 5600],
  ['Beech', '櫸木', '#D1A57A', 3100],
  ['Bamboo', '竹地板', '#D7B77F', 2600],
  ['Acacia', '相思木', '#8E5B34', 3500],
  ['Pine', '松木', '#DDB984', 2400],
  ['Ebony Stain', '黑檀染色', '#2E2520', 4400],
];
const PLANKS: [string, string, [number, number]][] = [
  ['Plank', '長條', [1200, 190]],
  ['Wide Plank', '寬板', [1900, 240]],
];
const FLOOR_TILES: [string, string, string, number][] = [
  ['White Porcelain', '白色拋光磚', '#EEEDE9', 0.2],
  ['Warm Beige', '暖米色', '#DDD2C0', 0.45],
  ['Light Grey', '淺灰', '#C9C7C2', 0.45],
  ['Cement Grey', '水泥灰', '#9E9C97', 0.6],
  ['Charcoal', '炭灰', '#4B4A47', 0.55],
  ['Sand', '沙色', '#CDBB9D', 0.6],
  ['Terracotta', '陶磚', '#B5673F', 0.75],
  ['Slate', '板岩', '#5C6166', 0.7],
];
const TILE_SIZES: [number, number][] = [
  [300, 300],
  [600, 600],
  [800, 800],
  [600, 1200],
];
const STONES: [string, string, string, number, number][] = [
  ['Carrara Marble', '卡拉拉白大理石', '#E9E7E3', 0.2, 7200],
  ['Calacatta Marble', '卡拉卡塔大理石', '#F0ECE4', 0.18, 9800],
  ['Nero Marquina', '黑白根', '#1F1F21', 0.2, 8800],
  ['Emperador', '咖啡網紋', '#6D4E3B', 0.22, 8200],
  ['Travertine', '洞石', '#D9C9AE', 0.55, 6400],
  ['Grey Granite', '灰花崗岩', '#8D8B88', 0.35, 4200],
  ['Black Granite', '黑花崗岩', '#26262A', 0.25, 5200],
  ['Quartz White', '白色石英石', '#F2F1EE', 0.15, 6800],
  ['Terrazzo Warm', '暖色磨石子', '#D5CBBE', 0.4, 4600],
  ['Terrazzo Grey', '灰色磨石子', '#B4B2AE', 0.4, 4600],
  ['Limestone', '石灰岩', '#D8D0C0', 0.6, 5600],
  ['Onyx Honey', '蜂蜜縞瑪瑙', '#D8A866', 0.15, 12800],
];
const WALL_TILES: [string, string, string, [number, number], number][] = [
  ['Subway White', '地鐵白磚', '#F1F0EC', [150, 75], 0.2],
  ['Subway Sage', '地鐵磚 鼠尾草', '#A9B7A4', [150, 75], 0.2],
  ['Zellige Green', '手工磚 綠', '#4F7A66', [100, 100], 0.15],
  ['Zellige Blue', '手工磚 藍', '#3E6A8C', [100, 100], 0.15],
  ['Zellige White', '手工磚 白', '#EDE8DD', [100, 100], 0.15],
  ['Glossy Black', '亮面黑磚', '#1E1E20', [200, 100], 0.1],
  ['Hex Mosaic White', '六角馬賽克 白', '#EFEFEB', [50, 50], 0.3],
  ['Hex Mosaic Grey', '六角馬賽克 灰', '#9C9C99', [50, 50], 0.3],
  ['Penny Round', '圓形馬賽克', '#E0DDD5', [30, 30], 0.25],
  ['Large Slab Grey', '大板 灰', '#A6A4A0', [1200, 600], 0.4],
  ['Terracotta Split', '劈離磚', '#A55D3B', [240, 60], 0.7],
  ['Pink Blush', '粉色釉面磚', '#E7C9C3', [150, 150], 0.2],
];
const FABRICS: [string, string, string, number][] = [
  ['Natural Linen', '天然亞麻', '#D8CFBF', 0.95],
  ['Oatmeal Boucle', '燕麥圈圈紗', '#E1D7C6', 0.98],
  ['Cream Boucle', '奶油圈圈紗', '#EEE7DA', 0.98],
  ['Grey Wool', '灰羊毛', '#8F8D8A', 0.95],
  ['Charcoal Felt', '炭灰毛氈', '#46474A', 0.95],
  ['Navy Velvet', '海軍藍絨布', '#2D3950', 0.75],
  ['Emerald Velvet', '祖母綠絨布', '#1F5C4A', 0.75],
  ['Mustard Velvet', '芥末黃絨布', '#C69A3A', 0.75],
  ['Blush Velvet', '粉色絨布', '#D9ACA3', 0.75],
  ['Terracotta Linen', '陶土亞麻', '#B86D4F', 0.95],
  ['Olive Canvas', '橄欖帆布', '#6E6F48', 0.9],
  ['Sky Cotton', '天藍棉', '#A9BFD4', 0.95],
  ['Black Leather', '黑色皮革', '#1D1C1C', 0.45],
  ['Tan Leather', '棕褐皮革', '#A06A42', 0.45],
  ['Chocolate Leather', '巧克力皮革', '#4A3024', 0.45],
  ['White Leather', '白色皮革', '#ECE8E1', 0.4],
  ['Rattan', '藤編', '#C9A26B', 0.8],
  ['Jute', '黃麻', '#B59A6E', 0.95],
];
const METALS: [string, string, string, number, number][] = [
  ['Polished Chrome', '亮面鉻', '#D9DBDE', 0.08, 1],
  ['Brushed Nickel', '拉絲鎳', '#B8B6B0', 0.3, 1],
  ['Brushed Brass', '拉絲黃銅', '#B79355', 0.3, 1],
  ['Antique Bronze', '古銅', '#6E5234', 0.45, 1],
  ['Copper', '紅銅', '#B8734A', 0.25, 1],
  ['Gunmetal', '槍灰', '#4D5054', 0.35, 1],
  ['Matte White Steel', '霧白烤漆鐵', '#EDEDEA', 0.5, 0.3],
  ['Rose Gold', '玫瑰金', '#C99A87', 0.2, 1],
];
const VENEERS: [string, string, string][] = [
  ['Oak Veneer', '橡木木皮', '#C49C6E'],
  ['Walnut Veneer', '胡桃木皮', '#6A4630'],
  ['Ash Veneer', '白蠟木皮', '#D0BB98'],
  ['Teak Veneer', '柚木木皮', '#94643A'],
  ['Black Oak Veneer', '黑橡木皮', '#2F2A26'],
  ['White Lacquer', '白色烤漆', '#F2F1ED'],
  ['Sage Lacquer', '鼠尾草烤漆', '#9FAF9A'],
  ['Navy Lacquer', '海軍藍烤漆', '#2E3B52'],
];
const CEILINGS: [string, string, string][] = [
  ['Matte White Ceiling', '霧白天花', '#F7F6F2'],
  ['Warm White Ceiling', '暖白天花', '#F3EEE3'],
  ['Wood Slat Ceiling', '木格柵天花', '#B58A5E'],
  ['Black Ceiling', '黑色天花', '#2A2A2C'],
];

const WALLPAPERS: [string, string, NonNullable<Material['motif']>, string, string][] = [
  ['Wallpaper Stripe Sage', '壁紙 寬條紋 鼠尾草', 'stripe', '#e7e9df', '#b9c4ac'],
  ['Wallpaper Stripe Navy', '壁紙 寬條紋 深藍', 'stripe', '#f1eee6', '#34465f'],
  ['Wallpaper Pinstripe Grey', '壁紙 細條紋 灰', 'pinstripe', '#eeeeec', '#a9a9a6'],
  ['Wallpaper Pinstripe Gold', '壁紙 細條紋 金', 'pinstripe', '#f4efe2', '#c2a15f'],
  ['Wallpaper Check Beige', '壁紙 格紋 米', 'check', '#efe7d9', '#d3c3a6'],
  ['Wallpaper Check Blue', '壁紙 格紋 藍', 'check', '#eef1f5', '#9fb2c9'],
  ['Wallpaper Damask Ivory', '壁紙 大馬士革 象牙', 'damask', '#efe9dc', '#d6c9ab'],
  ['Wallpaper Damask Charcoal', '壁紙 大馬士革 炭灰', 'damask', '#3d3e42', '#5b5c61'],
  ['Wallpaper Geometric Mint', '壁紙 幾何 薄荷', 'geometric', '#e9f0eb', '#9cc2ae'],
  ['Wallpaper Geometric Terracotta', '壁紙 幾何 陶土', 'geometric', '#f3e8de', '#c98a68'],
  ['Wallpaper Herringbone Oat', '壁紙 人字 燕麥', 'herringbone', '#ece4d6', '#cdbfa6'],
  ['Wallpaper Herringbone Slate', '壁紙 人字 石板', 'herringbone', '#d9dcdf', '#8f979f'],
  ['Wallpaper Floral Blush', '壁紙 花卉 粉', 'floral', '#f6ece8', '#d6a2a0'],
  ['Wallpaper Floral Green', '壁紙 花卉 綠', 'floral', '#eef1e8', '#7f9a6d'],
  ['Wallpaper Dots Cream', '壁紙 圓點 奶油', 'dots', '#f5efe2', '#d9c49a'],
  ['Wallpaper Dots Graphite', '壁紙 圓點 石墨', 'dots', '#e4e5e7', '#5d6168'],
];

export const GENERATED_MATERIALS: Material[] = [
  ...PAINTS.map(([en, zh, c]) =>
    mk('paint', en, `${zh}漆`, 'wall', c, 'plain', [1000, 1000], 0.9, { pricePerM2Twd: 380 }),
  ),
  ...WOODS.flatMap(([en, zh, c, price]) =>
    PLANKS.map(([pe, pz, size]) =>
      mk('wood', `${en} ${pe}`, `${zh}${pz}`, 'floor', c, 'wood', size, 0.5, { pricePerM2Twd: price }),
    ),
  ),
  ...FLOOR_TILES.flatMap(([en, zh, c, r]) =>
    TILE_SIZES.map(([w, h]) =>
      mk('tile', `${en} ${w}x${h}`, `${zh} ${w / 10}×${h / 10}`, 'floor', c, 'tile', [w, h], r, {
        pricePerM2Twd: Math.round(1600 + (w * h) / 600),
      }),
    ),
  ),
  ...STONES.map(([en, zh, c, r, price]) =>
    mk('stone', en, zh, 'stone', c, 'stone', [800, 800], r, { pricePerM2Twd: price }),
  ),
  ...WALL_TILES.map(([en, zh, c, size, r]) =>
    mk('walltile', en, zh, 'wall', c, 'tile', size, r, { pricePerM2Twd: 2200 }),
  ),
  ...FABRICS.map(([en, zh, c, r]) => mk('fabric', en, zh, 'fabric', c, 'plain', [300, 300], r)),
  ...METALS.map(([en, zh, c, r, m]) =>
    mk('metal', en, zh, 'metal', c, 'plain', [500, 500], r, { metalness: m }),
  ),
  ...VENEERS.map(([en, zh, c]) =>
    mk(
      'veneer',
      en,
      zh,
      'wood',
      c,
      en.includes('Lacquer') ? 'plain' : 'wood',
      [1200, 300],
      en.includes('Lacquer') ? 0.25 : 0.55,
    ),
  ),
  // 壁紙（FE-FIN-02）：8 種花紋 × 2 組配色；標準捲寬 53 cm 為一個重複單元
  ...WALLPAPERS.map(([en, zh, motif, bg, accent]) =>
    mk('wallpaper', en.replace(/^Wallpaper /, ''), zh, 'wall', bg, 'wallpaper', [530, 530], 0.85, {
      nameEn: en,
      motif,
      accent,
      pricePerM2Twd: 650,
    }),
  ),
  ...CEILINGS.map(([en, zh, c]) =>
    mk('ceiling', en, zh, 'ceiling', c, en.includes('Slat') ? 'wood' : 'plain', [1000, 1000], 0.9, {
      pricePerM2Twd: 900,
    }),
  ),
];
