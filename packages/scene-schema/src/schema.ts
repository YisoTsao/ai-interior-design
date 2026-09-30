import { z } from 'zod';

/** 座標範圍與數量上限（〔假設〕，ADR-013）。與 scene.schema.json 必須一致，test/equivalence 會檢查。 */
export const LIMITS = {
  coord: 1_000_000,
  wallsPerLevel: 5000,
  openingsPerLevel: 10000,
  objectsPerLevel: 5000,
  roomsPerLevel: 1000,
  cameras: 100,
  minWallLength: 100,
} as const;

export const CURRENT_SCHEMA_VERSION = '1.2.0';

const id = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const mm = z.int().min(-LIMITS.coord).max(LIMITS.coord);
const vec2 = z.tuple([mm, mm]);
const vec3 = z.tuple([mm, mm, mm]);
const confidence = z.number().min(0).max(1);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * 外觀覆寫（v1.1，ADR-023）：只影響呈現、不影響幾何與碰撞；未設定＝沿用材質／目錄預設。
 * color 取代材質底色（貼圖紋理保留）；opacity 對門窗套用在玻璃。
 */
export const AppearanceSchema = z.strictObject({
  color: hex.optional(),
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  opacity: z.number().min(0.05).max(1).optional(),
  castShadow: z.boolean().optional(),
  hidden: z.boolean().optional(),
});

/**
 * 燈具光源覆寫（v1.1，ADR-023）：物理量。未設定＝目錄 light 規格／物件參數 color、dimmer。
 * tiltDeg/panDeg：光束相對燈具的俯仰／水平轉角；rangeMm：衰減截止距離（0＝物理無限）。
 */
export const LightOverrideSchema = z.strictObject({
  on: z.boolean().optional(),
  lumens: z.number().min(0).max(200_000).optional(),
  kelvin: z.int().min(1000).max(12_000).optional(),
  color: hex.optional(),
  beamDeg: z.number().min(5).max(170).optional(),
  penumbra: z.number().min(0).max(1).optional(),
  tiltDeg: z.number().min(-180).max(180).optional(),
  panDeg: z.number().min(-180).max(180).optional(),
  castShadow: z.boolean().optional(),
  shadowSoftness: z.number().min(0).max(20).optional(),
  rangeMm: z.int().min(0).max(100_000).optional(),
});

/** 門窗樣式（v1.2，FE-PLAN-04）：決定 2D 符號與 3D 門扇／窗框造型 */
export const OPENING_STYLES = [
  'single',
  'double',
  'unequal',
  'sliding',
  'folding',
  'pocket',
  'casement',
  'fixed',
  'awning',
  'bay',
  'corner',
  'arch',
] as const;

/** 鋪貼設計（v1.2，FE-FIN-01）：磚尺寸、拼法、縫寬與縫色、旋轉、起鋪點、波打線 */
export const TilingSchema = z.strictObject({
  pattern: z.enum([
    'straight',
    'running',
    'diagonal',
    'herringbone',
    'chevron',
    'basketweave',
    'hexagon',
    'versailles',
  ]),
  tileW: z.int().min(20).max(3000),
  tileH: z.int().min(20).max(3000),
  grout: z.int().min(0).max(30).optional(),
  groutColor: hex.optional(),
  rotationDeg: z.number().min(-180).max(180).optional(),
  offset: z.tuple([z.int().min(-10000).max(10000), z.int().min(-10000).max(10000)]).optional(),
  /** 波打線（沿房間周邊的收邊帶）寬度 mm 與材質 */
  borderWidth: z.int().min(0).max(1500).optional(),
  borderMaterialId: id.optional(),
  /** 損耗率（估料用，0–0.5） */
  waste: z.number().min(0).max(0.5).optional(),
});

/** 場景環境（v1.1）：室外天空、曝光、環境光、太陽；夜間天空亮度依物理量（cd/m²）對應 */
export const EnvironmentSchema = z.strictObject({
  sky: z.enum(['moonless', 'moonlit', 'city', 'dusk']).optional(),
  exposureEv: z.number().min(-6).max(6).optional(),
  ambient: z.number().min(0).max(4).optional(),
  sunAzimuthDeg: z.number().min(-180).max(180).optional(),
  sunElevationDeg: z.number().min(2).max(90).optional(),
  sunIntensity: z.number().min(0).max(10).optional(),
});

export const WallSchema = z.strictObject({
  id,
  a: vec2,
  b: vec2,
  thickness: z.int().min(20).max(600),
  type: z.enum(['structural', 'exterior', 'partition', 'curtain']).optional(),
  materialId: id.optional(),
  materialIdB: id.optional(),
  confidence: confidence.optional(),
  /** 個別牆高（mm）；未設定＝樓層高 */
  height: z.int().min(100).max(6000).optional(),
  /** 踢腳板高度（mm；0＝無） */
  baseboard: z.int().min(0).max(300).optional(),
  appearance: AppearanceSchema.optional(),
  appearanceB: AppearanceSchema.optional(),
  /** 牆面鋪貼（v1.2；A／B 面，例：浴室壁磚） */
  tilingA: TilingSchema.optional(),
  tilingB: TilingSchema.optional(),
});

export const OpeningSchema = z.strictObject({
  id,
  wallId: id,
  type: z.enum(['door', 'window', 'passage']),
  /** 從牆 a 端沿牆到開口起點的距離（mm） */
  offset: z.int().min(0),
  width: z.int().min(200),
  height: z.int().min(200),
  sill: z.int().min(0).optional(),
  swing: z.enum(['left', 'right', 'double', 'sliding', 'none']).optional(),
  confidence: confidence.optional(),
  appearance: AppearanceSchema.optional(),
  style: z.enum(OPENING_STYLES).optional(),
  /** 門扇開啟角度（度，3D 呈現；0＝關閉） */
  openAngle: z.number().min(0).max(180).optional(),
});

export const RoomSchema = z.strictObject({
  id,
  label: z.string().optional(),
  wallIds: z.array(id).min(3),
  floorMaterialId: id.optional(),
  ceilingMaterialId: id.optional(),
  confidence: confidence.optional(),
  floorAppearance: AppearanceSchema.optional(),
  ceilingAppearance: AppearanceSchema.optional(),
  floorTiling: TilingSchema.optional(),
  /** 房間用途（v1.2；影響自動佈置、照度建議與房名） */
  kind: z
    .enum(['living', 'dining', 'bedroom', 'kitchen', 'bath', 'study', 'entry', 'balcony', 'storage', 'other'])
    .optional(),
});

export const ObjectSchema = z.strictObject({
  id,
  catalogId: id,
  /** [x, y, z] mm；y 為離地高度 */
  position: vec3,
  rotationY: z.number(),
  scale: z.tuple([z.number().gt(0), z.number().gt(0), z.number().gt(0)]).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  materialOverrides: z.record(z.string(), id).optional(),
  locked: z.boolean().optional(),
  roomId: id.optional(),
  /** 使用者自訂名稱 */
  name: z.string().max(60).optional(),
  appearance: AppearanceSchema.optional(),
  light: LightOverrideSchema.optional(),
  /** 群組（v1.2，FE-PLAN-07）：同 groupId 的物件一起選取／移動 */
  groupId: id.optional(),
  /** 左右鏡像（v1.2） */
  mirrored: z.boolean().optional(),
});

export const AnnotationSchema = z.looseObject({
  id,
  type: z.enum(['dimension', 'text', 'note']),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const LevelSchema = z.strictObject({
  id,
  name: z.string().optional(),
  elevation: mm,
  height: z.int().min(1800).max(6000),
  /** 樓板厚 mm（v1.2，樓層堆疊用） */
  slabThickness: z.int().min(0).max(1000).optional(),
  walls: z.array(WallSchema).max(LIMITS.wallsPerLevel),
  openings: z.array(OpeningSchema).max(LIMITS.openingsPerLevel),
  rooms: z.array(RoomSchema).max(LIMITS.roomsPerLevel),
  objects: z.array(ObjectSchema).max(LIMITS.objectsPerLevel),
  annotations: z.array(AnnotationSchema).optional(),
});

/** 命名視角書籤；視埠相機為 UI 暫態，不入 Scene（ADR-001） */
export const CameraSchema = z.strictObject({
  id,
  name: z.string().optional(),
  position: vec3,
  target: vec3,
  fovDeg: z.number().min(10).max(120),
});

export const MetaSchema = z.looseObject({
  createdBy: z.string().optional(),
  source: z.enum(['manual', 'import-vector', 'import-raster', 'template']).optional(),
  scale: z
    .looseObject({ method: z.enum(['dimension_ocr', 'user', 'dxf_units', 'unknown']).optional() })
    .optional(),
});

export const SceneSchema = z.strictObject({
  schemaVersion: z.string().regex(/^1\.\d+\.\d+$/),
  units: z.literal('mm'),
  levels: z.array(LevelSchema).min(1),
  cameras: z.array(CameraSchema).max(LIMITS.cameras).optional(),
  environment: EnvironmentSchema.optional(),
  meta: MetaSchema.optional(),
});

export type Wall = z.infer<typeof WallSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type SceneObject = z.infer<typeof ObjectSchema>;
export type Level = z.infer<typeof LevelSchema>;
export type Camera = z.infer<typeof CameraSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Appearance = z.infer<typeof AppearanceSchema>;
export type LightOverride = z.infer<typeof LightOverrideSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;
export type Tiling = z.infer<typeof TilingSchema>;
export type OpeningStyle = (typeof OPENING_STYLES)[number];
export type RoomKind = NonNullable<Room['kind']>;
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
