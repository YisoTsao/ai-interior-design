import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCatalog, SEED_CATALOG } from '@interiorai/catalog';
import type { Level, Wall } from '@interiorai/scene-schema';
import { buildFurnitureGeometry, buildOpeningFill, styledVariantKey } from '../src/furniture.js';
import {
  classifyWalls,
  cutawayWallHeight,
  DOLLHOUSE,
  dollhouseFloorMaterial,
  fitDistance,
  fullHeightWalls,
  mutedColor,
  presetDirection,
  roomKind,
  VIEW_PRESETS,
} from '../src/style.js';
import { buildWallGeometry } from '../src/walls3d.js';

const wall = (id: string, a: [number, number], b: [number, number], thickness = 100): Wall => ({
  id,
  a,
  b,
  thickness,
});
// 兩間房：x=0..4000 與 4000..8000，中間一道內牆
const twoRooms = (): Level => ({
  id: 'lvl_t',
  elevation: 0,
  height: 2800,
  walls: [
    wall('w_s', [0, 0], [8000, 0]),
    wall('w_e', [8000, 0], [8000, 3000]),
    wall('w_n', [8000, 3000], [0, 3000]),
    wall('w_w', [0, 3000], [0, 0]),
    wall('w_mid', [4000, 0], [4000, 3000]),
  ],
  openings: [],
  rooms: [],
  objects: [],
});

describe('roomKind / 地板材質表', () => {
  it.each([
    ['客廳', 'living'],
    ['主臥', 'bedroom'],
    ['衛浴', 'bath'],
    ['廚房', 'kitchen'],
    ['Living room', 'living'],
    ['Bathroom', 'bath'],
    [undefined, 'other'],
    ['儲藏室', 'other'],
  ] as const)('%s → %s', (label, kind) => expect(roomKind(label)).toBe(kind));

  it('使用者換過的地板優先；預設地板依房型套用', () => {
    expect(
      dollhouseFloorMaterial({ label: '客廳', floorMaterialId: 'mat_tile_grey60' }, 'mat_wood_oak'),
    ).toBe('mat_tile_grey60');
    expect(dollhouseFloorMaterial({ label: '客廳', floorMaterialId: 'mat_wood_oak' }, 'mat_wood_oak')).toBe(
      'style_floor_walnut',
    );
    expect(dollhouseFloorMaterial({ label: '衛浴' }, 'mat_wood_oak')).toBe('style_tile_bath');
    expect(dollhouseFloorMaterial({ label: '臥室' }, 'mat_wood_oak')).toBe('style_floor_lightwood');
  });
});

describe('剖面牆判定', () => {
  it('外牆有朝外法線；共用牆為內牆（與牆方向無關）', () => {
    const lv = twoRooms();
    lv.walls[0] = wall('w_s', [8000, 0], [0, 0]); // 反向
    const s = classifyWalls(lv);
    expect(s.get('w_mid')).toEqual({ exterior: false });
    const out = (id: string) => s.get(id)!.outward!.map((v) => Math.round(v) + 0);
    expect(out('w_s')).toEqual([0, -1]);
    expect(out('w_n')).toEqual([0, 1]);
    expect(out('w_e')).toEqual([1, 0]);
    expect(out('w_w')).toEqual([-1, 0]);
  });

  it('相機在 +X+Z：南(-Z)與西(-X)外牆全高，其餘降低', () => {
    const s = classifyWalls(twoRooms());
    const full = fullHeightWalls(s, [1, 1]);
    expect([...full].sort()).toEqual(['w_s', 'w_w']);
  });

  it('遲滯：相機幾乎沿牆方向時維持前一狀態', () => {
    const s = classifyWalls(twoRooms());
    // 相機方向 (1, 0.05)：北牆 outward (0,1) 的點積 0.05 在遲滯區間內
    expect(fullHeightWalls(s, [1, 0.05], new Set(['w_n'])).has('w_n')).toBe(true);
    expect(fullHeightWalls(s, [1, 0.05], new Set()).has('w_n')).toBe(false);
  });

  it('剖面高度的牆：頂在剖面高度、高於牆頂的開口被略過', () => {
    const lv = twoRooms();
    lv.openings = [
      { id: 'op_win', wallId: 'w_s', type: 'window', offset: 1000, width: 1200, height: 1200, sill: 900 },
      { id: 'op_door', wallId: 'w_s', type: 'door', offset: 5000, width: 900, height: 2100, sill: 0 },
    ];
    const g = buildWallGeometry(lv, lv.walls[0]!, 350);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBe(350);
    // 窗整個在剖面以上 → 不影響；門仍留開口（有 jamb 面：法線沿牆方向）
    const nor = g.getAttribute('normal');
    let jambs = 0;
    for (let i = 0; i < nor.count; i++)
      if (Math.abs(nor.getX(i)) > 0.99 && Math.abs(nor.getY(i)) < 0.01) jambs++;
    // 轉角端面為斜接（非軸向）→ 只有門的兩個 jamb，每面 6 頂點
    expect(jambs).toBe(2 * 6);
    // 預設高度不變
    const full = buildWallGeometry(lv, lv.walls[0]!);
    full.computeBoundingBox();
    expect(full.boundingBox!.max.y).toBe(2800);
  });
});

describe('相機預設', () => {
  it('方位角 45° 仰角 35°', () => {
    const [x, y, z] = presetDirection(45, 35);
    expect(x).toBeCloseTo(z);
    expect(Math.asin(y) * (180 / Math.PI)).toBeCloseTo(35);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1);
  });
  it('所有預設仰角在 20°~70°', () => {
    for (const p of Object.values(VIEW_PRESETS)) {
      expect(p.elevationDeg).toBeGreaterThanOrEqual(20);
      expect(p.elevationDeg).toBeLessThanOrEqual(70);
    }
  });
  it('窄畫面需要拉更遠', () => {
    expect(fitDistance(5000, 22, 0.5)).toBeGreaterThan(fitDistance(5000, 22, 2));
  });
});

describe('剖面模型家具', () => {
  const catalog = createCatalog(SEED_CATALOG);
  const sofa = catalog.all().find((e) => e.model.kind === 'parametric' && e.model.type === 'sofa')!;

  it('沙發分件較多（坐墊/靠墊/抱枕）且 body 顏色烘進頂點色', () => {
    const simple = buildFurnitureGeometry(sofa);
    const dh = buildFurnitureGeometry(sofa, undefined, { style: 'dollhouse', bodyColor: '#ff0000' });
    expect(dh.getAttribute('position').count).toBeGreaterThan(simple.getAttribute('position').count);
    const col = dh.getAttribute('color');
    const red = new THREE.Color('#ff0000').convertSRGBToLinear();
    let reds = 0;
    for (let i = 0; i < col.count; i++)
      if (Math.abs(col.getX(i) - red.r) < 1e-4 && col.getY(i) < 1e-4) reds++;
    expect(reds).toBeGreaterThan(0);
    // 尺寸不變（只改視覺）
    simple.computeBoundingBox();
    dh.computeBoundingBox();
    const s1 = simple.boundingBox!.getSize(new THREE.Vector3());
    const s2 = dh.boundingBox!.getSize(new THREE.Vector3());
    expect(Math.abs(s2.x - s1.x)).toBeLessThan(1);
    expect(Math.abs(s2.z - s1.z)).toBeLessThan(1);
  });

  it('所有目錄品項都能產生剖面模型幾何，且高度不超過簡易模式', () => {
    for (const e of catalog.all()) {
      const g = buildFurnitureGeometry(e, undefined, { style: 'dollhouse', bodyColor: '#cccccc' });
      const s = buildFurnitureGeometry(e);
      g.computeBoundingBox();
      s.computeBoundingBox();
      expect(g.boundingBox!.max.y, e.id).toBeLessThanOrEqual(Math.max(s.boundingBox!.max.y, e.dimsMm.h) + 1);
      expect(g.getAttribute('position').count, e.id).toBeGreaterThan(0);
    }
  });

  it('變體鍵：剖面模型含顏色，簡易模式不變', () => {
    expect(styledVariantKey('k')).toBe('k');
    expect(styledVariantKey('k', { style: 'dollhouse', bodyColor: '#abc' })).toBe('k|dh|#abc');
  });

  it('窗的玻璃自成 group 1；門只有 group 0', () => {
    const win = buildOpeningFill('window', 1200, 1200, 80)!;
    expect(win.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
    const door = buildOpeningFill('door', 900, 2100, 80)!;
    expect(door.groups.map((g) => g.materialIndex)).toEqual([0]);
  });
});

describe('mutedColor', () => {
  const hsl = (hex: string) => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
  it('保留色相、壓低飽和、不變暗', () => {
    const src = '#c07030';
    const out = mutedColor(src);
    expect(hsl(out).h).toBeCloseTo(hsl(src).h, 2);
    expect(hsl(out).s).toBeLessThanOrEqual(0.21);
    expect(hsl(out).l).toBeGreaterThanOrEqual(0.54);
  });
  it('已經低飽和的顏色幾乎不變', () => {
    expect(mutedColor('#d9d6cf')).toBe('#d9d6cf');
  });
});

describe('cutawayWallHeight（日／夜同一規則）', () => {
  it('內牆與獨立牆全高', () => {
    expect(cutawayWallHeight(2800, { exterior: false }, false)).toBe(2800);
    expect(cutawayWallHeight(2800, undefined, false)).toBe(2800);
  });
  it('靠近相機的外牆降為牆腳，背對相機的外牆全高', () => {
    const ext = { exterior: true, outward: [1, 0] as [number, number] };
    expect(cutawayWallHeight(2800, ext, false)).toBe(DOLLHOUSE.cutHeight);
    expect(cutawayWallHeight(2800, ext, true)).toBe(2800);
  });
  it('矮牆不會被拉高', () => {
    expect(cutawayWallHeight(60, { exterior: true, outward: [0, 1] }, false)).toBe(60);
  });
});
