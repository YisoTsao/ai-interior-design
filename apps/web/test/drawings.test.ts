import { describe, expect, it } from 'vitest';
import { materialMap } from '@interiorai/catalog';
import { addObject, createEditorStore } from '@interiorai/app-state';
import { buildSampleScene } from '../src/sample';
import { catalog, materials } from '../src/catalogData';
import { drawingSet, roomElevations } from '../src/export/drawings';

describe('施工圖集', () => {
  const scene0 = buildSampleScene({ living: '客餐廳', bed1: '主臥', bed2: '次臥' });
  const st = createEditorStore({ scene: scene0 });
  const L = st.getState().levelId;
  st.getState().exec(
    addObject(L, { catalogId: 'mep_outlet', position: [100, 300, 3000], rotationY: Math.PI / 2 }),
  );
  st.getState().exec(
    addObject(L, { catalogId: 'mep_switch', position: [100, 1200, 1200], rotationY: Math.PI / 2 }),
  );
  const scene = st.getState().scene;
  const lv = scene.levels[0]!;
  it('立面：每個房間的每面牆一張，含門窗；插座離地高正確', () => {
    const els = roomElevations(lv, catalog);
    expect(els.length).toBeGreaterThanOrEqual(12);
    expect(els.some((e) => e.openings.some((o) => o.type === 'window' && o.y0 > 0))).toBe(true);
    const outlet = els.flatMap((e) => e.objects).find((o) => o.mep && o.point === 'outlet');
    expect(outlet?.y0).toBe(300);
  });
  it('圖集 HTML：封面＋平面／家具／地坪／天花／水電／立面頁', () => {
    const html = drawingSet(
      lv,
      catalog,
      materialMap(materials),
      {
        t: (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k),
        nameOf: (id) => id,
        matName: (id) => id,
        date: '2026-10-01',
      },
      '範例',
    );
    const pages = html.match(/<section class=page>/g)?.length ?? 0;
    expect(pages).toBeGreaterThanOrEqual(5 + 12);
    expect(html).toContain('drawings.mep');
    expect(html).toContain('>P<');
    expect(html).toContain('C1');
  });
});
