import type { CatalogEntry, Material } from './schema.js';

/** 自產參數化模組：專案自有，可商用（登記於 docs/licenses.md） */
export const OWN_LICENSE = {
  type: 'proprietary-own',
  source: 'InteriorAI 自產參數化模組',
  allowedUse: ['commercial', 'render', 'redistribute'],
} as const satisfies CatalogEntry['license'];

const int = (min: number, max: number, def: number, labelKey: string) =>
  ({ type: 'integer', min, max, default: def, labelKey }) as const;

type P = CatalogEntry['model'] & { kind: 'parametric' };
const pm = (type: P['type'], params: P['params'] = {}): P => ({ kind: 'parametric', type, params });
const sizeParams = (w: number, d: number, h: number) => ({
  w: int(Math.round(w * 0.5), Math.round(w * 2), w, 'param.width'),
  d: int(Math.round(d * 0.5), Math.round(d * 2), d, 'param.depth'),
  h: int(Math.round(h * 0.5), Math.round(h * 2), h, 'param.height'),
});

function e(
  slug: string,
  nameZh: string,
  nameEn: string,
  category: CatalogEntry['category'],
  dims: [number, number, number],
  model: P,
  opts: Partial<CatalogEntry> = {},
): CatalogEntry {
  const [w, d, h] = dims;
  const params = Object.keys(model.params).length ? model.params : sizeParams(w, d, h);
  return {
    id: slug,
    slug,
    nameZh,
    nameEn,
    category,
    tags: [],
    styleTags: ['modern'],
    dimsMm: { w, d, h },
    anchor: 'floor',
    model: { ...model, params },
    materialSlots: [{ name: 'body', swappable: true, defaultMaterialId: 'mat_wood_oak' }],
    license: OWN_LICENSE,
    status: 'published',
    ...opts,
  };
}

export const SEED_CATALOG: CatalogEntry[] = [
  // 門窗（依附牆）
  e(
    'door_single_900',
    '單開門 90',
    'Single door 90',
    'openings',
    [900, 40, 2100],
    pm('door', {
      w: int(600, 1200, 900, 'param.width'),
      h: int(1800, 2400, 2100, 'param.height'),
      swing: { type: 'enum', values: ['left', 'right'], default: 'left', labelKey: 'param.swing' },
    }),
    { anchor: 'wall', tags: ['door', '門'] },
  ),
  e(
    'door_double_1500',
    '雙開門 150',
    'Double door 150',
    'openings',
    [1500, 40, 2100],
    pm('door', {
      w: int(1200, 2000, 1500, 'param.width'),
      h: int(1800, 2400, 2100, 'param.height'),
      swing: { type: 'enum', values: ['double'], default: 'double', labelKey: 'param.swing' },
    }),
    { anchor: 'wall', tags: ['door', '門'] },
  ),
  e(
    'window_1200',
    '窗 120',
    'Window 120',
    'openings',
    [1200, 80, 1200],
    pm('window', {
      w: int(400, 3000, 1200, 'param.width'),
      h: int(400, 2400, 1200, 'param.height'),
      sill: int(0, 1500, 900, 'param.sill'),
      panes: int(1, 4, 2, 'param.panes'),
    }),
    { anchor: 'wall', tags: ['window', '窗'] },
  ),
  e(
    'window_1800',
    '落地窗 180',
    'Floor window 180',
    'openings',
    [1800, 80, 2100],
    pm('window', {
      w: int(600, 4000, 1800, 'param.width'),
      h: int(1000, 2600, 2100, 'param.height'),
      sill: int(0, 600, 0, 'param.sill'),
      panes: int(1, 6, 3, 'param.panes'),
    }),
    { anchor: 'wall', tags: ['window', '窗'] },
  ),
  // 系統櫃
  e(
    'cabinet_wardrobe_1800',
    '系統衣櫃 180',
    'Wardrobe 180',
    'storage',
    [1800, 600, 2400],
    pm('cabinet', {
      w: int(400, 3600, 1800, 'param.width'),
      d: int(300, 700, 600, 'param.depth'),
      h: int(600, 2700, 2400, 'param.height'),
      doors: int(0, 6, 3, 'param.doors'),
      shelves: int(0, 8, 4, 'param.shelves'),
    }),
    { tags: ['衣櫃', 'wardrobe'] },
  ),
  e(
    'cabinet_shoe_1200',
    '鞋櫃 120',
    'Shoe cabinet 120',
    'entry',
    [1200, 380, 1100],
    pm('cabinet', {
      w: int(400, 2400, 1200, 'param.width'),
      d: int(300, 450, 380, 'param.depth'),
      h: int(600, 2400, 1100, 'param.height'),
      doors: int(0, 4, 2, 'param.doors'),
      shelves: int(0, 8, 4, 'param.shelves'),
    }),
    { tags: ['鞋櫃'] },
  ),
  e(
    'cabinet_book_900',
    '書櫃 90',
    'Bookcase 90',
    'office',
    [900, 350, 2000],
    pm('cabinet', {
      w: int(400, 2400, 900, 'param.width'),
      d: int(250, 450, 350, 'param.depth'),
      h: int(600, 2400, 2000, 'param.height'),
      doors: int(0, 4, 0, 'param.doors'),
      shelves: int(1, 8, 5, 'param.shelves'),
    }),
    { tags: ['書櫃', 'bookcase'] },
  ),
  e(
    'cabinet_sideboard_1600',
    '餐邊櫃 160',
    'Sideboard 160',
    'dining',
    [1600, 450, 850],
    pm('cabinet', {
      w: int(600, 2400, 1600, 'param.width'),
      d: int(350, 600, 450, 'param.depth'),
      h: int(600, 1200, 850, 'param.height'),
      doors: int(0, 6, 4, 'param.doors'),
      shelves: int(0, 3, 1, 'param.shelves'),
    }),
  ),
  // 客廳
  e('sofa_3seat_a', '三人沙發', '3-seat sofa', 'living', [2100, 900, 820], pm('sofa'), {
    tags: ['沙發', 'sofa'],
    unitPriceTwd: 28000,
  }),
  e('sofa_2seat_a', '雙人沙發', '2-seat sofa', 'living', [1600, 880, 820], pm('sofa'), {
    tags: ['沙發', 'sofa'],
  }),
  e('armchair_a', '單椅', 'Armchair', 'living', [800, 820, 800], pm('sofa'), { tags: ['單椅'] }),
  e('table_coffee_a', '茶几', 'Coffee table', 'living', [1100, 600, 420], pm('table'), { tags: ['茶几'] }),
  e('table_side_a', '邊几', 'Side table', 'living', [450, 450, 550], pm('table'), { tags: ['邊几'] }),
  e('tvstand_1800', '電視櫃 180', 'TV stand 180', 'living', [1800, 420, 500], pm('tvstand'), {
    tags: ['電視櫃'],
  }),
  e('rug_2000', '地毯 200×140', 'Rug 200x140', 'decor', [2000, 1400, 10], pm('rug'), {
    tags: ['地毯'],
    materialSlots: [{ name: 'body', swappable: true, defaultMaterialId: 'mat_fabric_beige' }],
  }),
  // 餐廳
  e('table_dining_4', '四人餐桌', 'Dining table 4', 'dining', [1400, 800, 750], pm('table'), {
    tags: ['餐桌'],
  }),
  e('table_dining_6', '六人餐桌', 'Dining table 6', 'dining', [1800, 900, 750], pm('table'), {
    tags: ['餐桌'],
  }),
  e('chair_dining_a', '餐椅', 'Dining chair', 'dining', [450, 520, 820], pm('chair'), {
    tags: ['餐椅', 'chair'],
  }),
  // 臥室
  e('bed_double_150', '雙人床 150', 'Double bed 150', 'bedroom', [1600, 2100, 1000], pm('bed'), {
    tags: ['床', 'bed'],
  }),
  e('bed_queen_180', '加大雙人床 180', 'Queen bed 180', 'bedroom', [1900, 2150, 1050], pm('bed'), {
    tags: ['床', 'bed'],
  }),
  e('bed_single_90', '單人床 90', 'Single bed 90', 'bedroom', [1000, 2000, 900], pm('bed'), {
    tags: ['床', 'bed'],
  }),
  e('nightstand_a', '床頭櫃', 'Nightstand', 'bedroom', [450, 400, 500], pm('nightstand'), {
    tags: ['床頭櫃'],
  }),
  e('desk_dresser_a', '梳妝台', 'Dresser', 'bedroom', [1000, 450, 760], pm('desk'), { tags: ['梳妝台'] }),
  // 書房
  e('desk_office_1400', '辦公桌 140', 'Desk 140', 'office', [1400, 700, 750], pm('desk'), {
    tags: ['書桌', 'desk'],
  }),
  e('chair_office_a', '辦公椅', 'Office chair', 'office', [600, 600, 1100], pm('chair'), {
    tags: ['辦公椅'],
  }),
  e('shelf_open_800', '開放層架', 'Open shelf', 'office', [800, 300, 1800], pm('shelf'), { tags: ['層架'] }),
  // 廚房
  e('counter_base_600', '廚具下櫃 60', 'Base cabinet 60', 'kitchen', [600, 600, 850], pm('counter'), {
    tags: ['廚具'],
  }),
  e('counter_base_900', '廚具下櫃 90', 'Base cabinet 90', 'kitchen', [900, 600, 850], pm('counter'), {
    tags: ['廚具'],
  }),
  e('fridge_a', '冰箱', 'Refrigerator', 'kitchen', [700, 700, 1800], pm('fridge'), { tags: ['冰箱'] }),
  e('island_1500', '中島', 'Kitchen island', 'kitchen', [1500, 900, 900], pm('counter'), { tags: ['中島'] }),
  // 衛浴
  e('toilet_a', '馬桶', 'Toilet', 'bathroom', [380, 700, 780], pm('toilet'), { tags: ['馬桶'] }),
  e('basin_a', '洗手台', 'Basin', 'bathroom', [600, 480, 850], pm('basin'), { tags: ['洗手台'] }),
  e('bathtub_1600', '浴缸 160', 'Bathtub 160', 'bathroom', [1600, 750, 560], pm('bathtub'), {
    tags: ['浴缸'],
  }),
  // 燈具與裝飾
  e('lamp_floor_a', '立燈', 'Floor lamp', 'lighting', [400, 400, 1600], pm('lamp_floor'), { tags: ['燈'] }),
  e('lamp_pendant_a', '吊燈', 'Pendant lamp', 'lighting', [500, 500, 400], pm('lamp_pendant'), {
    anchor: 'ceiling',
    tags: ['燈'],
  }),
  e('plant_a', '盆栽', 'Plant', 'decor', [450, 450, 1200], pm('plant'), { tags: ['植物'] }),
  // 草稿示範：授權未確認 → 不得 published（07、B5）
  e(
    'sofa_vendor_x',
    '廠商沙發（授權未確認）',
    'Vendor sofa (unverified)',
    'living',
    [2200, 950, 850],
    pm('sofa'),
    { status: 'draft', license: undefined },
  ),
];

const OWN = OWN_LICENSE;
export const SEED_MATERIALS: Material[] = [
  {
    id: 'mat_paint_white',
    nameZh: '白色乳膠漆',
    nameEn: 'White paint',
    category: 'wall',
    color: '#F2F0EB',
    pattern: 'plain',
    realSizeMm: { w: 1000, h: 1000 },
    roughness: 0.9,
    pricePerM2Twd: 350,
    license: OWN,
  },
  {
    id: 'mat_paint_sage',
    nameZh: '鼠尾草綠漆',
    nameEn: 'Sage paint',
    category: 'wall',
    color: '#A7B5A0',
    pattern: 'plain',
    realSizeMm: { w: 1000, h: 1000 },
    roughness: 0.9,
    pricePerM2Twd: 380,
    license: OWN,
  },
  {
    id: 'mat_paint_grey',
    nameZh: '暖灰漆',
    nameEn: 'Warm grey paint',
    category: 'wall',
    color: '#B9B4AB',
    pattern: 'plain',
    realSizeMm: { w: 1000, h: 1000 },
    roughness: 0.9,
    pricePerM2Twd: 380,
    license: OWN,
  },
  {
    id: 'mat_tile_white',
    nameZh: '白色壁磚 30×60',
    nameEn: 'White tile 30x60',
    category: 'wall',
    color: '#EDEDEA',
    pattern: 'tile',
    realSizeMm: { w: 600, h: 300 },
    roughness: 0.4,
    pricePerM2Twd: 1800,
    license: OWN,
  },
  {
    id: 'mat_wood_oak',
    nameZh: '淺橡木地板',
    nameEn: 'Light oak floor',
    category: 'floor',
    color: '#C8A77E',
    pattern: 'wood',
    realSizeMm: { w: 1200, h: 190 },
    roughness: 0.6,
    pricePerM2Twd: 3200,
    license: OWN,
  },
  {
    id: 'mat_wood_walnut',
    nameZh: '胡桃木地板',
    nameEn: 'Walnut floor',
    category: 'floor',
    color: '#6E4B32',
    pattern: 'wood',
    realSizeMm: { w: 1200, h: 190 },
    roughness: 0.55,
    pricePerM2Twd: 4200,
    license: OWN,
  },
  {
    id: 'mat_tile_grey60',
    nameZh: '灰色地磚 60×60',
    nameEn: 'Grey tile 60x60',
    category: 'floor',
    color: '#A9A8A3',
    pattern: 'tile',
    realSizeMm: { w: 600, h: 600 },
    roughness: 0.5,
    pricePerM2Twd: 2200,
    license: OWN,
  },
  {
    id: 'mat_stone_terrazzo',
    nameZh: '磨石子',
    nameEn: 'Terrazzo',
    category: 'floor',
    color: '#D5D0C6',
    pattern: 'stone',
    realSizeMm: { w: 800, h: 800 },
    roughness: 0.45,
    pricePerM2Twd: 3800,
    license: OWN,
  },
  {
    id: 'mat_ceiling_white',
    nameZh: '天花板白',
    nameEn: 'Ceiling white',
    category: 'ceiling',
    color: '#FAFAF7',
    pattern: 'plain',
    realSizeMm: { w: 1000, h: 1000 },
    roughness: 0.95,
    license: OWN,
  },
  {
    id: 'mat_fabric_beige',
    nameZh: '米色布',
    nameEn: 'Beige fabric',
    category: 'fabric',
    color: '#D8CBB5',
    pattern: 'plain',
    realSizeMm: { w: 300, h: 300 },
    roughness: 0.95,
    license: OWN,
  },
  {
    id: 'mat_fabric_charcoal',
    nameZh: '炭灰布',
    nameEn: 'Charcoal fabric',
    category: 'fabric',
    color: '#4A4B4F',
    pattern: 'plain',
    realSizeMm: { w: 300, h: 300 },
    roughness: 0.95,
    license: OWN,
  },
  {
    id: 'mat_metal_black',
    nameZh: '黑鐵',
    nameEn: 'Black metal',
    category: 'metal',
    color: '#2B2B2B',
    pattern: 'plain',
    realSizeMm: { w: 500, h: 500 },
    roughness: 0.4,
    license: OWN,
  },
];
