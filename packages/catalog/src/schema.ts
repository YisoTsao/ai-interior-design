import { z } from 'zod';

const id = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const LicenseSchema = z.object({
  type: z.string().min(1),
  source: z.string().min(1),
  allowedUse: z.array(z.enum(['commercial', 'render', 'redistribute'])).min(1),
  attribution: z.string().optional(),
});

/** 參數化模組種類（07 §3）。幾何由 viewer-3d 依 type 生成。 */
export const PARAMETRIC_TYPES = [
  'door',
  'window',
  'cabinet',
  'sofa',
  'bed',
  'table',
  'chair',
  'desk',
  'shelf',
  'tvstand',
  'nightstand',
  'counter',
  'toilet',
  'basin',
  'bathtub',
  'fridge',
  'lamp_floor',
  'lamp_pendant',
  'rug',
  'plant',
  // 燈具（光源規格見 LightSpecSchema）與軟裝
  'lamp_table',
  'lamp_wall',
  'lamp_downlight',
  'lamp_track',
  'lamp_chandelier',
  'lamp_arc',
  'light_hex',
  'led_strip',
  'led_bar',
  'monitor',
  'curtain',
  // v1.1 擴充（ADR-023）
  'sofa_l',
  'ottoman',
  'bench',
  'stool',
  'table_round',
  'dresser',
  'tv',
  'piano',
  'fireplace',
  'washer',
  'stove',
  'sink',
  'upper_cabinet',
  'range_hood',
  'shower',
  'mirror',
  'wall_art',
  'wall_shelf',
  'clock',
  'vase',
  'bean_bag',
  'ceiling_fan',
  'aircon',
  'radiator',
  'coat_rack',
  'crib',
  'bunk_bed',
  'books',
  'laptop',
  'rug_round',
  'neon_sign',
  'candle',
  'floor_cushion',
  'pet_bed',
  'treadmill',
  // v1.2 結構元件（FE-PLAN-03）
  'column',
  'beam',
  'stairs',
  'platform',
  'railing',
  // v1.3 水電點位（FE-DOC-05）：param point 決定符號與造型
  'mep',
] as const;
/** 水電點位種類（FE-DOC-05） */
export const MEP_POINTS = [
  'outlet',
  'outlet_counter',
  'switch',
  'data',
  'tv',
  'water_cold',
  'water_hot',
  'drain',
  'gas',
  'ac',
] as const;
export type ParametricType = (typeof PARAMETRIC_TYPES)[number];

export const ParamSpecSchema = z.object({
  type: z.enum(['integer', 'enum']),
  min: z.number().optional(),
  max: z.number().optional(),
  values: z.array(z.string()).optional(),
  default: z.union([z.number(), z.string()]),
  labelKey: z.string(),
});

export const ModelSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('parametric'),
    type: z.enum(PARAMETRIC_TYPES),
    params: z.record(z.string(), ParamSpecSchema),
  }),
  z.object({ kind: z.literal('glb'), url: z.string().min(1), lod1Url: z.string().optional() }),
]);

/**
 * 光源規格（物理量）：viewer 依此產生真實光源（lm → 光度單位），並把發光部件做成自發光材質。
 * 顏色與亮度由物件參數 `color`（色溫/RGB 預設）與 `dimmer`（0–100%）決定。
 */
export const LightSpecSchema = z.object({
  kind: z.enum(['point', 'spot', 'area']),
  /** 光通量（lm，dimmer 100% 時） */
  lumens: z.number().positive(),
  /** 發光點相對物件原點（底部中心、正面朝 +Z）的位置 mm */
  offset: z.tuple([z.number(), z.number(), z.number()]),
  /** spot：光束角（度） */
  beamDeg: z.number().min(5).max(170).optional(),
  /** area：發光面尺寸 mm */
  size: z.object({ w: z.number().positive(), h: z.number().positive() }).optional(),
  /** 發光方向（物件局部座標） */
  facing: z.enum(['down', 'up', 'front']).default('down'),
  /** 是否可投射陰影（實際投影數量由 viewer 依重要度限制） */
  castShadow: z.boolean().default(false),
});
export type LightSpec = z.infer<typeof LightSpecSchema>;

/** 光色預設：色溫（K）或 RGB 氛圍色 */
export const LIGHT_COLORS = [
  '2700K',
  '3000K',
  '4000K',
  '5000K',
  '6500K',
  'amber',
  'red',
  'pink',
  'magenta',
  'purple',
  'blue',
  'cyan',
  'green',
] as const;

export const CatalogEntrySchema = z.object({
  id,
  slug: z.string().regex(/^[a-z0-9_]+$/),
  nameZh: z.string().min(1),
  nameEn: z.string().optional(),
  category: z.enum([
    'living',
    'dining',
    'bedroom',
    'kitchen',
    'bathroom',
    'office',
    'entry',
    'lighting',
    'decor',
    'openings',
    'storage',
    'structure',
    'mep',
  ]),
  tags: z.array(z.string()).default([]),
  styleTags: z.array(z.string()).default([]),
  /** 真實尺寸 mm；w=寬(x)、d=深(z)、h=高(y) */
  dimsMm: z.object({ w: z.int().positive(), d: z.int().positive(), h: z.int().positive() }),
  anchor: z.enum(['floor', 'wall', 'ceiling']),
  /** 放置時的預設離地高度 mm（壁掛物用；天花物件一律貼天花） */
  elevationMm: z.int().nonnegative().optional(),
  model: ModelSchema,
  materialSlots: z
    .array(z.object({ name: z.string(), swappable: z.boolean(), defaultMaterialId: z.string() }))
    .default([]),
  light: LightSpecSchema.optional(),
  /** 可選：P6 BOM 使用；〔假設〕價格 */
  unitPriceTwd: z.int().nonnegative().optional(),
  license: LicenseSchema.optional(),
  status: z.enum(['draft', 'review', 'published', 'retired']),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export const MaterialSchema = z.object({
  id,
  nameZh: z.string(),
  nameEn: z.string().optional(),
  category: z.enum(['floor', 'wall', 'ceiling', 'fabric', 'wood', 'metal', 'stone']),
  /** sRGB 十六進位 */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  pattern: z.enum(['plain', 'wood', 'tile', 'stone', 'image']),
  /** pattern=image：底色貼圖（dataURL 或 URL；使用者自訂材質 FE-FIN-06） */
  textureUrl: z.string().optional(),
  /** 貼圖一個重複單元的真實尺寸（mm），用於 repeat = 面尺寸 / realSize（FR-303） */
  realSizeMm: z.object({ w: z.int().positive(), h: z.int().positive() }),
  roughness: z.number().min(0).max(1),
  /** 金屬度（0 非金屬、1 金屬）；未設定＝0 */
  metalness: z.number().min(0).max(1).optional(),
  pricePerM2Twd: z.int().nonnegative().optional(),
  license: LicenseSchema,
});
export type Material = z.infer<typeof MaterialSchema>;
