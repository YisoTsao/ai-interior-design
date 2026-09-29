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
  ]),
  tags: z.array(z.string()).default([]),
  styleTags: z.array(z.string()).default([]),
  /** 真實尺寸 mm；w=寬(x)、d=深(z)、h=高(y) */
  dimsMm: z.object({ w: z.int().positive(), d: z.int().positive(), h: z.int().positive() }),
  anchor: z.enum(['floor', 'wall', 'ceiling']),
  model: ModelSchema,
  materialSlots: z
    .array(z.object({ name: z.string(), swappable: z.boolean(), defaultMaterialId: z.string() }))
    .default([]),
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
  pattern: z.enum(['plain', 'wood', 'tile', 'stone']),
  /** 貼圖一個重複單元的真實尺寸（mm），用於 repeat = 面尺寸 / realSize（FR-303） */
  realSizeMm: z.object({ w: z.int().positive(), h: z.int().positive() }),
  roughness: z.number().min(0).max(1),
  pricePerM2Twd: z.int().nonnegative().optional(),
  license: LicenseSchema,
});
export type Material = z.infer<typeof MaterialSchema>;
