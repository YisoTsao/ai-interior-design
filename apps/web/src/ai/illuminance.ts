import type { Catalog } from '@interiorai/catalog';
import { detectRooms, pointInPolygon, type Vec2 } from '@interiorai/core-geometry';
import type { Level, RoomKind } from '@interiorai/scene-schema';
import { inferRoomKind } from '@interiorai/app-state';
import { fixtureLights, type LightSource } from '@interiorai/viewer-3d';

/**
 * 照度分析（FE-LGT-03）：以燈具光通量估算地板（或工作面）照度 lx。
 * 模型：點光源等向（I = Φ／4π）、聚光在光束角內均勻（I = Φ／(2π(1−cos(θ/2)))）、面光源朗伯（I₀ = Φ／π）；
 * E = I·cos(入射角)／d²（mm→m）。不含遮擋與間接光（實際值約高 20–40%），供配置比較用。
 * 建議照度參考 CNS 12112 住宅空間（範圍，lx）。
 */
export const RECOMMENDED_LUX: Record<RoomKind, [number, number]> = {
  living: [150, 300],
  dining: [200, 500],
  bedroom: [100, 200],
  kitchen: [200, 500],
  bath: [100, 200],
  study: [300, 750],
  entry: [100, 200],
  balcony: [30, 75],
  storage: [50, 100],
  other: [100, 200],
};

const intensity = (l: LightSource, cosToDir: number) => {
  if (l.kind === 'point') return l.lumens / (4 * Math.PI);
  if (l.kind === 'area') return cosToDir > 0 ? (l.lumens / Math.PI) * cosToDir : 0;
  const half = ((l.beamDeg ?? 60) / 2) * (Math.PI / 180);
  const cone = 2 * Math.PI * (1 - Math.cos(half));
  // 光束外以柔邊衰減到 0（多 15°）
  const edge = Math.cos(Math.min(Math.PI / 2, half + (15 * Math.PI) / 180));
  if (cosToDir >= Math.cos(half)) return l.lumens / cone;
  if (cosToDir <= edge) return 0;
  return ((l.lumens / cone) * (cosToDir - edge)) / (Math.cos(half) - edge);
};

/** 點 p（世界 mm，y＝量測高度）的照度 lx */
export function luxAt(lights: readonly LightSource[], p: [number, number, number]): number {
  let e = 0;
  for (const l of lights) {
    const dx = p[0] - l.position[0];
    const dy = p[1] - l.position[1];
    const dz = p[2] - l.position[2];
    const d = Math.hypot(dx, dy, dz);
    if (d < 1) continue;
    if (l.rangeMm && d > l.rangeMm) continue;
    const ux = dx / d;
    const uy = dy / d;
    const uz = dz / d;
    const cosToDir = ux * l.direction[0] + uy * l.direction[1] + uz * l.direction[2];
    const I = intensity(l, cosToDir);
    // 水平面（法向 +Y）的入射角餘弦＝−uy
    const cosInc = Math.max(0, -uy);
    e += (I * cosInc) / (d / 1000) ** 2;
  }
  return e;
}

export interface LuxResult {
  step: number;
  cells: { x: number; z: number; lux: number }[];
  rooms: {
    id: string;
    label: string | null;
    kind: RoomKind;
    avg: number;
    min: number;
    max: number;
    range: [number, number];
    ok: boolean;
  }[];
}

export function illuminance(
  level: Level,
  catalog: Catalog,
  o: { step?: number; height?: number } = {},
): LuxResult {
  const step = o.step ?? 250;
  const h = o.height ?? 0;
  const lights = fixtureLights(level, catalog).filter((l) => l.source === 'fixture');
  const det = detectRooms(level).rooms;
  const largest = det.reduce<(typeof det)[number] | null>(
    (a, b) => (!a || b.netArea > a.netArea ? b : a),
    null,
  );
  const cells: LuxResult['cells'] = [];
  const rooms: LuxResult['rooms'] = [];
  for (const d of det) {
    const xs = d.floor.map((p) => p[0]);
    const zs = d.floor.map((p) => p[1]);
    const vals: number[] = [];
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step)
      for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
        if (!pointInPolygon([x, z] as Vec2, d.floor)) continue;
        const lux = luxAt(lights, [x, h, z]);
        cells.push({ x, z, lux });
        vals.push(lux);
      }
    if (!vals.length) continue;
    const r = level.rooms.find((x) => [...x.wallIds].sort().join('|') === d.key);
    const kind = inferRoomKind(r ?? {}, d.netArea / 1e6, d === largest);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const range = RECOMMENDED_LUX[kind];
    rooms.push({
      id: r?.id ?? d.key,
      label: r?.label ?? null,
      kind,
      avg: Math.round(avg),
      min: Math.round(Math.min(...vals)),
      max: Math.round(Math.max(...vals)),
      range,
      ok: avg >= range[0] && avg <= range[1] * 1.5,
    });
  }
  return { step, cells, rooms };
}

/** 熱度圖色階：0 → 深藍、300 lx → 黃、≥ 750 → 紅 */
export function luxColor(lux: number): string {
  const t = Math.max(0, Math.min(1, Math.log10(1 + lux) / Math.log10(751)));
  const stops: [number, [number, number, number]][] = [
    [0, [20, 30, 90]],
    [0.45, [40, 150, 200]],
    [0.75, [250, 220, 60]],
    [1, [230, 60, 40]],
  ];
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1]![0]) i++;
  const [t0, c0] = stops[i]!;
  const [t1, c1] = stops[i + 1]!;
  const k = (t - t0) / (t1 - t0 || 1);
  const c = c0.map((v, j) => Math.round(v + (c1[j]! - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
