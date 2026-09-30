import type { Material as CatalogMaterial } from '@interiorai/catalog';
import { detectRooms, pointInPolygon, wallLength, type Vec2 } from '@interiorai/core-geometry';
import type { Level, Room } from '@interiorai/scene-schema';

/**
 * 3D 視覺風格（只影響呈現，不改 Scene）：
 * - simple：P2 原本的簡易模式
 * - dollhouse：等角建築剖面模型（低矮剖面牆、暖光、柔和陰影、AO、木桌底座）
 */
export type ViewStyle = 'simple' | 'dollhouse';

export const DOLLHOUSE = {
  /** 剖面牆高度 mm（靠近相機的外牆與所有內牆） */
  cutHeight: 350,
  elevationDeg: 35,
  azimuthDeg: 45,
  fovDeg: 22,
  minElevationDeg: 20,
  maxElevationDeg: 70,
  /** 底板外擴 mm 與厚度 mm */
  boardMargin: 1500,
  boardThickness: 80,
  exposure: 1.1,
  wallRoughness: 0.9,
  capColor: '#ebe8e2',
  glassColor: '#cfe6f2',
  glassOpacity: 0.25,
} as const;

/**
 * 夜間氛圍（images1）：燈具是主要光源、自發光部件 bloom、光滑深色木地板反射燈光、
 * 依建物外框的圓角底座＋黃色底部光暈、深灰暈影背景；遠側外牆與內牆全高、近側外牆只留牆腳。
 */
export const NIGHT = {
  /** 物理光度 → 顯示值的比例（曝光固定 1.0，讓 bloom 門檻與背景都在顯示範圍） */
  photometricScale: 0.03,
  /** 自發光材質亮度倍率（顯示值 > bloom 門檻才會發光） */
  emissive: 3.2,
  hemi: { sky: '#aab4d6', ground: '#20180f', intensity: 0.22 },
  envIntensity: 0.08,
  background: { center: '#86868a', edge: '#3a3a3d' },
  ground: '#4a4a4d',
  lipHeight: 100,
  plinth: { margin: 160, radius: 420, height: 230, color: '#d6d5d1', gap: 110 },
  underglow: { color: '#ffb020', strength: 3.5, spread: 650, decal: 2.2 },
  bloom: { strength: 0.55, radius: 0.35, threshold: 1.0 },
  floorRoughness: 0.14,
  window: { color: '#e4ecff', emissive: 1.6 },
} as const;

/** 視角預設：四個等角方位＋近俯視（仰角受 OrbitControls 上限約束） */
export type ViewPreset = 'iso-se' | 'iso-sw' | 'iso-nw' | 'iso-ne' | 'top';
export const VIEW_PRESETS: Record<ViewPreset, { azimuthDeg: number; elevationDeg: number }> = {
  'iso-se': { azimuthDeg: 45, elevationDeg: DOLLHOUSE.elevationDeg },
  'iso-sw': { azimuthDeg: -45, elevationDeg: DOLLHOUSE.elevationDeg },
  'iso-nw': { azimuthDeg: -135, elevationDeg: DOLLHOUSE.elevationDeg },
  'iso-ne': { azimuthDeg: 135, elevationDeg: DOLLHOUSE.elevationDeg },
  top: { azimuthDeg: 45, elevationDeg: DOLLHOUSE.maxElevationDeg },
};

/** 方位角 0 = 相機在 +Z 方向；45° = +X+Z。回傳「目標 → 相機」單位向量 */
export function presetDirection(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

/** 讓半徑 r 的球完整入鏡所需的相機距離 */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.1, aspect));
  return radius / Math.sin(Math.min(vFov, hFov) / 2);
}

// ── 房間類型 → 地板 ──────────────────────────────────────────────

export type RoomKind = 'living' | 'bedroom' | 'bath' | 'kitchen' | 'other';

const KIND_WORDS: [RoomKind, RegExp][] = [
  ['bath', /浴|廁|衛|洗手|bath|toilet|wc|washroom|shower/i],
  ['kitchen', /廚|kitchen|pantry/i],
  ['bedroom', /臥|房間|睡|bed|guest|kid|nursery/i],
  ['living', /客|廳|餐|走道|玄關|書房|起居|living|lounge|dining|hall|corridor|entry|foyer|study/i],
];

/** 由房間名稱推斷類型（Room schema 沒有類型欄位；只用於視覺） */
export function roomKind(label: string | undefined): RoomKind {
  if (!label) return 'other';
  for (const [k, re] of KIND_WORDS) if (re.test(label)) return k;
  return 'other';
}

const lic: CatalogMaterial['license'] = {
  type: 'CC0-1.0',
  source: 'self-procedural',
  allowedUse: ['commercial', 'render', 'redistribute'],
};
/** 風格專用的程序化地板材質（不進資產庫、不寫入 Scene） */
export const STYLE_MATERIALS: CatalogMaterial[] = [
  {
    id: 'style_floor_walnut',
    nameZh: '深棕木地板',
    category: 'floor',
    color: '#7a5537',
    pattern: 'wood',
    realSizeMm: { w: 1200, h: 1200 },
    roughness: 0.5,
    license: lic,
  },
  {
    id: 'style_floor_lightwood',
    nameZh: '淺色木地板',
    category: 'floor',
    color: '#c9a882',
    pattern: 'wood',
    realSizeMm: { w: 1200, h: 1200 },
    roughness: 0.55,
    license: lic,
  },
  {
    id: 'style_tile_bath',
    nameZh: '衛浴白磁磚',
    category: 'floor',
    color: '#e6e4df',
    pattern: 'tile',
    realSizeMm: { w: 300, h: 300 },
    roughness: 0.3,
    license: lic,
  },
  {
    id: 'style_tile_kitchen',
    nameZh: '廚房淺磁磚',
    category: 'floor',
    color: '#ddd5c8',
    pattern: 'tile',
    realSizeMm: { w: 600, h: 600 },
    roughness: 0.35,
    license: lic,
  },
  {
    id: 'style_board_wood',
    nameZh: '木桌底板',
    category: 'wood',
    color: '#b08862',
    pattern: 'wood',
    realSizeMm: { w: 3000, h: 3000 },
    roughness: 0.6,
    license: lic,
  },
];

const KIND_FLOOR: Record<RoomKind, string> = {
  living: 'style_floor_walnut',
  bedroom: 'style_floor_lightwood',
  bath: 'style_tile_bath',
  kitchen: 'style_tile_kitchen',
  other: 'style_floor_walnut',
};

/**
 * 剖面模型的地板材質：使用者明確換過的地板材質優先（尊重資料）；
 * 仍是系統預設（或未設定）時，依房間類型套用風格材質表。
 */
export function dollhouseFloorMaterial(
  room: Pick<Room, 'label' | 'floorMaterialId'> | undefined,
  defaultId: string,
) {
  if (room?.floorMaterialId && room.floorMaterialId !== defaultId) return room.floorMaterialId;
  return KIND_FLOOR[roomKind(room?.label)];
}

// ── 剖面牆：判斷哪些牆降低 ────────────────────────────────────────

export interface WallSide {
  /** 外牆：只有一側是房間；outward 為朝外的單位法線 */
  exterior: boolean;
  outward?: Vec2;
}

/** 以牆兩側取樣點是否落在房間內判斷內/外牆（與牆方向、繞序無關） */
export function classifyWalls(level: Pick<Level, 'walls'>): Map<string, WallSide> {
  const floors = detectRooms(level).rooms.map((r) => r.floor);
  const inside = (p: Vec2) => floors.some((f) => pointInPolygon(p, f));
  const out = new Map<string, WallSide>();
  for (const w of level.walls) {
    const L = wallLength(w);
    if (L < 1) {
      out.set(w.id, { exterior: false });
      continue;
    }
    const d: Vec2 = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
    const n: Vec2 = [-d[1], d[0]];
    const off = w.thickness / 2 + 60;
    let left = false;
    let right = false;
    for (const t of [0.2, 0.5, 0.8]) {
      const m: Vec2 = [w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t];
      left ||= inside([m[0] + n[0] * off, m[1] + n[1] * off]);
      right ||= inside([m[0] - n[0] * off, m[1] - n[1] * off]);
    }
    if (left !== right) out.set(w.id, { exterior: true, outward: left ? [-n[0], -n[1]] : n });
    else out.set(w.id, { exterior: false });
  }
  return out;
}

/**
 * 保持全高的牆 id：只有「背對相機」的外牆。其餘（靠近相機的外牆、內牆、獨立牆）都降為剖面高度。
 * camDir：目標 → 相機的水平方向。prev 用於遲滯，避免相機沿牆方向時閃爍。
 */
export function fullHeightWalls(
  sides: Map<string, WallSide>,
  camDir: Vec2,
  prev?: ReadonlySet<string>,
  hysteresis = 0.08,
): Set<string> {
  const l = Math.hypot(camDir[0], camDir[1]) || 1;
  const c: Vec2 = [camDir[0] / l, camDir[1] / l];
  const out = new Set<string>();
  for (const [id, s] of sides) {
    if (!s.exterior || !s.outward) continue;
    const dp = s.outward[0] * c[0] + s.outward[1] * c[1];
    const full = dp < -hysteresis ? true : dp > hysteresis ? false : prev ? prev.has(id) : dp < 0;
    if (full) out.add(id);
  }
  return out;
}

/**
 * 剖面模型的家具主色：保留色相，壓低飽和度、拉高明度 → 莫蘭迪色調
 * （ACES 會再推高飽和，原始材質色在此風格下偏艷）。
 */
export function mutedColor(hex: string, maxSat = 0.2, minLight = 0.55): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let sat = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  const S = Math.min(sat, maxSat);
  const L = Math.max(l, minLight);
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  const hue = (t: number) => {
    t = (t + 1) % 1;
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(v * 255);
  };
  const out = (hue(h + 1 / 3) << 16) | (hue(h) << 8) | hue(h - 1 / 3);
  return `#${out.toString(16).padStart(6, '0')}`;
}

export const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));
