/** PlanResult 契約（與 cv-service／docs/specs/openapi.yaml 的 PlanResult 一致，06 §1） */
export type Vec2 = [number, number];

export interface WallOut {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  confidence: number;
}
export interface OpeningOut {
  id: string;
  wallId: string;
  type: 'door' | 'window' | 'passage';
  offset: number;
  width: number;
  height: number;
  sill: number;
  swing?: 'left' | 'right' | 'none' | null;
  confidence: number;
}
export interface RoomOut {
  polygon: Vec2[];
  label?: string | null;
  labelSource?: 'ocr' | 'vlm' | 'heuristic' | 'text';
  confidence: number;
}
export interface LabelOut {
  text: string;
  position: Vec2;
}
export interface PlanResult {
  source: 'vector' | 'raster';
  units: 'mm' | 'px';
  scale: {
    mmPerPx: number | null;
    method: 'dimension_ocr' | 'user' | 'dxf_units' | 'unknown';
    confidence: number;
    suggestedMmPerPx?: number | null;
  };
  walls: WallOut[];
  openings: OpeningOut[];
  rooms: RoomOut[];
  labels: LabelOut[];
  image: Record<string, unknown> | null;
  warnings: { code: string; message: string }[];
}

export class PlanParseError extends Error {
  constructor(
    readonly code: 'UPLOAD_REJECTED' | 'PARSE_FAILED',
    message: string,
  ) {
    super(message);
  }
}
