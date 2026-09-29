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

export const CURRENT_SCHEMA_VERSION = '1.0.0';

const id = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const mm = z.int().min(-LIMITS.coord).max(LIMITS.coord);
const vec2 = z.tuple([mm, mm]);
const vec3 = z.tuple([mm, mm, mm]);
const confidence = z.number().min(0).max(1);

export const WallSchema = z.strictObject({
  id,
  a: vec2,
  b: vec2,
  thickness: z.int().min(20).max(600),
  type: z.enum(['structural', 'exterior', 'partition', 'curtain']).optional(),
  materialId: id.optional(),
  materialIdB: id.optional(),
  confidence: confidence.optional(),
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
});

export const RoomSchema = z.strictObject({
  id,
  label: z.string().optional(),
  wallIds: z.array(id).min(3),
  floorMaterialId: id.optional(),
  ceilingMaterialId: id.optional(),
  confidence: confidence.optional(),
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
  meta: MetaSchema.optional(),
});

export type Wall = z.infer<typeof WallSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type SceneObject = z.infer<typeof ObjectSchema>;
export type Level = z.infer<typeof LevelSchema>;
export type Camera = z.infer<typeof CameraSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
