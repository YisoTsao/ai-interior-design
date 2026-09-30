import { describe, expect, it } from 'vitest';
import { createCatalog, SEED_CATALOG } from '@interiorai/catalog';
import type { Level } from '@interiorai/scene-schema';
import {
  areaLuminance,
  fixtureLights,
  kelvinToHex,
  lightColorHex,
  pickActive,
  pointIntensity,
  spotIntensity,
  windowLights,
  type LightSource,
} from '../src/lighting.js';
import { classifyWalls } from '../src/style.js';

const catalog = createCatalog(SEED_CATALOG);
const lvl = (objects: Level['objects'], extra: Partial<Level> = {}): Level => ({
  id: 'lvl_t',
  elevation: 0,
  height: 2800,
  walls: [],
  openings: [],
  rooms: [],
  objects,
  ...extra,
});

describe('光色', () => {
  it('色溫：低色溫偏暖、6500K 接近白', () => {
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [r27, , b27] = rgb(kelvinToHex(2700));
    expect(r27).toBe(255);
    expect(b27).toBeLessThan(180);
    const [r65, g65, b65] = rgb(kelvinToHex(6500));
    expect(Math.min(r65!, g65!, b65!)).toBeGreaterThan(235);
    expect(lightColorHex('magenta')).toBe('#ff2bd6');
    expect(lightColorHex('nope')).toBe(kelvinToHex(3000));
  });
});

describe('燈具光源', () => {
  it('發光點隨物件旋轉/位置；dimmer 調整光通量；dimmer 0 不發光', () => {
    const [l] = fixtureLights(
      lvl([
        {
          id: 'obj_wall',
          catalogId: 'lamp_wall_a',
          position: [1000, 1500, 2000],
          rotationY: Math.PI / 2,
          scale: [1, 1, 1],
          params: { dimmer: 50 },
        },
      ]),
      catalog,
    );
    // offset (0,170,90) 繞 Y 轉 90° → (+90, 170, 0)
    expect(l!.position.map(Math.round)).toEqual([1090, 1670, 2000]);
    expect(l!.lumens).toBe(200);
    expect(l!.kind).toBe('point');
    const off = fixtureLights(
      lvl([
        {
          id: 'o',
          catalogId: 'lamp_table_a',
          position: [0, 0, 0],
          rotationY: 0,
          scale: [1, 1, 1],
          params: { dimmer: 0 },
        },
      ]),
      catalog,
    );
    expect(off).toHaveLength(0);
  });

  it('崁燈向下、六角燈板朝前、顏色取自參數', () => {
    const ls = fixtureLights(
      lvl([
        { id: 'd', catalogId: 'lamp_downlight_a', position: [0, 2740, 0], rotationY: 0, scale: [1, 1, 1] },
        {
          id: 'h',
          catalogId: 'light_hex_a',
          position: [0, 1200, 0],
          rotationY: Math.PI,
          scale: [1, 1, 1],
          params: { color: 'cyan' },
        },
      ]),
      catalog,
    );
    const d = ls.find((x) => x.id === 'd')!;
    expect([d.kind, d.direction, d.ceiling]).toEqual(['spot', [0, -1, 0], true]);
    const h = ls.find((x) => x.id === 'h')!;
    expect(h.kind).toBe('area');
    expect(h.direction[2]).toBeCloseTo(-1);
    expect(h.color).toBe('#22d3ee');
  });

  it('只有燈具會產生光源', () => {
    const ls = fixtureLights(
      lvl([{ id: 's', catalogId: 'sofa_3seat_a', position: [0, 0, 0], rotationY: 0, scale: [1, 1, 1] }]),
      catalog,
    );
    expect(ls).toHaveLength(0);
  });
});

describe('窗戶光源', () => {
  it('外牆上的窗 → 朝室內的面光源；內牆上的窗略過', () => {
    const walls = [
      { id: 'w_s', a: [0, 0], b: [4000, 0], thickness: 200 },
      { id: 'w_e', a: [4000, 0], b: [4000, 3000], thickness: 200 },
      { id: 'w_n', a: [4000, 3000], b: [0, 3000], thickness: 200 },
      { id: 'w_w', a: [0, 3000], b: [0, 0], thickness: 200 },
    ] as Level['walls'];
    const openings = [
      { id: 'op_1', wallId: 'w_s', type: 'window', offset: 1000, width: 1500, height: 1200, sill: 900 },
    ] as Level['openings'];
    const l = lvl([], { walls, openings });
    const [w] = windowLights(l, classifyWalls(l));
    expect(w!.direction).toEqual([-0, 0, 1]); // 南牆 → 朝 +Z（室內）
    expect(w!.position[1]).toBe(1500);
    expect(w!.position[2]).toBeGreaterThan(0);
    expect(w!.lumens).toBeCloseTo(1.8 * 700);
  });
});

describe('光度換算與挑選', () => {
  it('mm 世界：1 m 處照度與公尺世界一致（I/d²）', () => {
    const I = pointIntensity(400 * Math.PI); // 100 cd
    expect(I / 1000 ** 2).toBeCloseTo(100);
    // 光束越窄，中心強度越高
    expect(spotIntensity(600, 30)).toBeGreaterThan(spotIntensity(600, 90));
    // 面光源：flux = π L A
    expect(areaLuminance(Math.PI, 1000, 1000)).toBeCloseTo(1);
  });

  it('固定池大小、依重要度取、陰影預算', () => {
    const mk = (i: number, kind: LightSource['kind'], lm: number, x: number): LightSource => ({
      id: `l${i}`,
      kind,
      position: [x, 1000, 0],
      direction: [0, -1, 0],
      color: '#fff',
      lumens: lm,
      castShadow: true,
      ceiling: false,
      source: 'fixture',
    });
    const all = [
      ...Array.from({ length: 30 }, (_, i) => mk(i, 'point', 500, i * 1000)),
      ...Array.from({ length: 3 }, (_, i) => mk(100 + i, 'spot', 600, 0)),
    ];
    const p = pickActive(all, [0, 1000, 0]);
    expect(p.point).toHaveLength(12);
    expect(p.point[0]!.id).toBe('l0'); // 最靠近焦點
    expect(p.point.filter((l) => l.castShadow)).toHaveLength(2);
    expect(p.spot).toHaveLength(3);
    expect(p.spot.filter((l) => l.castShadow)).toHaveLength(3);
    expect(p.area).toHaveLength(0);
  });
});
