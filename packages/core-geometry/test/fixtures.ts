import type { Level, Wall } from '@interiorai/scene-schema';

export const wall = (
  id: string,
  a: [number, number],
  b: [number, number],
  thickness = 100,
  extra: Partial<Wall> = {},
): Wall => ({
  id,
  a,
  b,
  thickness,
  ...extra,
});
export const level = (walls: Wall[], extra: Partial<Level> = {}): Level => ({
  id: 'lvl_t',
  elevation: 0,
  height: 2800,
  walls,
  openings: [],
  rooms: [],
  objects: [],
  ...extra,
});
/** 逆時針矩形房間（中心線） */
export const rect = (x0: number, y0: number, x1: number, y1: number, t = 100, prefix = 'w'): Wall[] => [
  wall(`${prefix}_s`, [x0, y0], [x1, y0], t),
  wall(`${prefix}_e`, [x1, y0], [x1, y1], t),
  wall(`${prefix}_n`, [x1, y1], [x0, y1], t),
  wall(`${prefix}_w`, [x0, y1], [x0, y0], t),
];
