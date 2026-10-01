import { describe, expect, it } from 'vitest';
import { materialMap, SEED_CATALOG, SEED_MATERIALS, type CatalogEntry } from '@interiorai/catalog';
import {
  activeFilters,
  brandOf,
  colorFamily,
  EMPTY_FILTER,
  isCustomizable,
  matchAsset,
  OWN_BRAND,
  UPLOAD_BRAND,
} from '../src/editor/assetFilter';

const mats = materialMap(SEED_MATERIALS);
const all = SEED_CATALOG as CatalogEntry[];
const run = (p: Partial<typeof EMPTY_FILTER>) =>
  all.filter((e) => matchAsset(e, { ...EMPTY_FILTER, ...p }, mats));

describe('資產篩選（FE-AST-02）', () => {
  it('沒有條件時全部符合', () => {
    expect(run({})).toHaveLength(all.length);
    expect(activeFilters(EMPTY_FILTER)).toBe(0);
  });
  it('尺寸範圍：寬、深、高各自的上下限', () => {
    const r = run({ w: { min: 1500, max: 2200 }, h: { min: 0, max: 900 } });
    expect(r.length).toBeGreaterThan(0);
    for (const e of r) {
      expect(e.dimsMm.w).toBeGreaterThanOrEqual(1500);
      expect(e.dimsMm.w).toBeLessThanOrEqual(2200);
      expect(e.dimsMm.h).toBeLessThanOrEqual(900);
    }
    expect(activeFilters({ ...EMPTY_FILTER, w: { min: 1500, max: 2200 }, h: { min: 0, max: 900 } })).toBe(2);
  });
  it('材質：木作家具只出現木材主材質', () => {
    const r = run({ material: 'wood' });
    expect(r.length).toBeGreaterThan(0);
    for (const e of r) expect(mats.get(e.materialSlots[0]!.defaultMaterialId)?.category).toBe('wood');
  });
  it('品牌：自產／上傳；目錄的 brand 欄位優先', () => {
    const e = all[0]!;
    expect(brandOf(e)).toBe(OWN_BRAND);
    expect(brandOf({ ...e, tags: ['user-upload'] })).toBe(UPLOAD_BRAND);
    expect(brandOf({ ...e, brand: 'Acme' })).toBe('Acme');
    expect(run({ brand: OWN_BRAND })).toHaveLength(all.length);
  });
  it('可訂製：參數化且尺寸可調', () => {
    const r = run({ customizable: true });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(isCustomizable)).toBe(true);
    expect(isCustomizable({ ...all[0]!, model: { kind: 'glb', url: 'x' } })).toBe(false);
  });
  it('色系判斷', () => {
    expect(colorFamily('#ffffff')).toBe('white');
    expect(colorFamily('#111111')).toBe('black');
    expect(colorFamily('#2f6fd0')).toBe('blue');
    expect(colorFamily('#7a5537')).toBe('brown');
  });
});

import { familyOf, parseColorCsv, RAL_CARDS } from '../src/editor/colorCards';
describe('色卡（FE-FIN-05）', () => {
  it('RAL 色號格式與色碼', () => {
    expect(RAL_CARDS.length).toBeGreaterThanOrEqual(30);
    for (const c of RAL_CARDS) {
      expect(c.code).toMatch(/^RAL \d{4}$/);
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it('CSV 匯入：略過標題列、接受不含 # 的色碼、回報錯誤列', () => {
    const r = parseColorCsv('brand,code,name,hex\nAcme,A-01,霧白,#F2F0EB\nAcme,A-02,Sage,9caf88\nAcme,bad\n');
    expect(r.cards.map((c) => [c.library, c.code, c.hex])).toEqual([
      ['Acme', 'A-01', '#f2f0eb'],
      ['Acme', 'A-02', '#9caf88'],
    ]);
    expect(r.errors).toEqual([4]);
  });
  it('色系分類', () => {
    expect(familyOf('#f7f7f5')).toBe('white');
    expect(familyOf('#151515')).toBe('dark');
    expect(familyOf('#808080')).toBe('grey');
  });
});
