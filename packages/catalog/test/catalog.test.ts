import { describe, expect, it } from 'vitest';
import {
  checkCatalog,
  createCatalog,
  objectDims,
  resolveParams,
  SEED_CATALOG,
  SEED_MATERIALS,
} from '../src/index.js';

const cat = createCatalog(SEED_CATALOG);

describe('seed catalog', () => {
  it('無 error；≥30 件 published 且皆有可商用授權（ADR-015 P2 目標）', () => {
    const errors = checkCatalog(SEED_CATALOG, SEED_MATERIALS).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
    const pub = SEED_CATALOG.filter((e) => e.status === 'published');
    expect(pub.length).toBeGreaterThanOrEqual(30);
    expect(pub.every((e) => e.license?.allowedUse.includes('commercial'))).toBe(true);
  });
  it('搜尋只回 published，支援中英文與分類', () => {
    expect(cat.search({ text: '沙發' }).map((e) => e.id)).not.toContain('sofa_vendor_x');
    expect(cat.search({ text: 'SOFA' }).length).toBeGreaterThan(0);
    expect(cat.search({ category: 'bathroom' }).every((e) => e.category === 'bathroom')).toBe(true);
    expect(cat.search().length).toBe(SEED_CATALOG.filter((e) => e.status === 'published').length);
    expect(cat.get('bed_double_150')?.nameZh).toBe('雙人床 150');
    expect(cat.all()).toHaveLength(SEED_CATALOG.length);
  });
});

describe('checkCatalog', () => {
  const base = SEED_CATALOG[8]!;
  it('published 但缺授權 / 不可商用 → error', () => {
    const i1 = checkCatalog([{ ...base, license: undefined }]);
    expect(i1.some((i) => i.severity === 'error' && i.message.includes('B5'))).toBe(true);
    const i2 = checkCatalog([{ ...base, license: { ...base.license!, allowedUse: ['render'] } }]);
    expect(i2.some((i) => i.message.includes('商用'))).toBe(true);
  });
  it('schema 錯誤、重複 id、參數預設超界、enum 預設不在選項、材質槽懸空', () => {
    expect(checkCatalog([{ id: 'x' }])[0]!.message).toMatch(/schema/);
    expect(checkCatalog([base, base]).some((i) => i.message === 'id 重複')).toBe(true);
    const door = SEED_CATALOG[0]!;
    const bad = structuredClone(door);
    if (bad.model.kind === 'parametric') {
      bad.model.params.w = { ...bad.model.params.w!, default: 5000 };
      bad.model.params.swing = { ...bad.model.params.swing!, default: 'up' };
    }
    const msgs = checkCatalog([bad])
      .map((i) => i.message)
      .join('|');
    expect(msgs).toMatch(/預設值超出範圍/);
    expect(msgs).toMatch(/不在選項內/);
    expect(checkCatalog([base], [SEED_MATERIALS[0]]).some((i) => i.message.includes('不存在的材質'))).toBe(
      true,
    );
    expect(checkCatalog([], [{ id: 'm_bad' }])[0]!.message).toMatch(/材質 schema/);
  });
  it('glb 模型與 draft 可通過（僅警告）', () => {
    const glb = {
      ...base,
      id: 'glb_x',
      slug: 'glb_x',
      model: { kind: 'glb', url: 'a.glb' },
      status: 'draft',
      license: undefined,
    };
    const iss = checkCatalog([glb]);
    expect(iss.filter((i) => i.severity === 'error')).toEqual([]);
    expect(iss.some((i) => i.severity === 'warning')).toBe(true);
  });
});

describe('params', () => {
  const wardrobe = cat.get('cabinet_wardrobe_1800')!;
  it('resolveParams 夾在範圍內、enum 驗證', () => {
    expect(resolveParams(wardrobe, { w: 99999, doors: 2.4 })).toMatchObject({ w: 3600, doors: 2, h: 2400 });
    const door = cat.get('door_single_900')!;
    expect(resolveParams(door, { swing: 'right' }).swing).toBe('right');
    expect(resolveParams(door, { swing: 'nope' }).swing).toBe('left');
    expect(resolveParams({ ...door, model: { kind: 'glb', url: 'x' } })).toEqual({});
  });
  it('objectDims 套用參數與 scale', () => {
    expect(objectDims(wardrobe, { w: 1200 }, [1, 1, 1])).toEqual({ w: 1200, d: 600, h: 2400 });
    expect(objectDims({ ...wardrobe, model: { kind: 'glb', url: 'x' } }, {}, [2, 1, 1]).w).toBe(3600);
    expect(objectDims(wardrobe).w).toBe(1800);
  });
});
