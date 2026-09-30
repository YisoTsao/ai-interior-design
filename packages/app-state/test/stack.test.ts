import { describe, expect, it } from 'vitest';
import { createCatalog, SEED_CATALOG } from '@interiorai/catalog';
import { stackElevation } from '../src/index.js';

const catalog = createCatalog(SEED_CATALOG);
const level = {
  objects: [
    { id: 'desk', catalogId: 'desk_office_1400', position: [1000, 0, 1000], rotationY: 0 },
    { id: 'rug', catalogId: 'rug_2000', position: [4000, 0, 4000], rotationY: 0 },
    { id: 'ward', catalogId: 'cabinet_wardrobe_1800', position: [8000, 0, 1000], rotationY: 0 },
  ],
} as never;

describe('stackElevation', () => {
  it('檯燈放在書桌上 → 書桌頂面高', () => {
    expect(stackElevation(level, catalog, { catalogId: 'lamp_table_a' }, [1100, 1000], 0)).toBe(750);
  });
  it('地毯不當支撐、空地 → 0', () => {
    expect(stackElevation(level, catalog, { catalogId: 'lamp_table_a' }, [4000, 4000], 0)).toBe(0);
    expect(stackElevation(level, catalog, { catalogId: 'lamp_table_a' }, [6000, 6000], 0)).toBe(0);
  });
  it('大件（沙發）不會疊；衣櫃太高不當支撐；壁掛物回傳 null', () => {
    expect(stackElevation(level, catalog, { catalogId: 'sofa_3seat_a' }, [1000, 1000], 0)).toBe(0);
    expect(stackElevation(level, catalog, { catalogId: 'plant_small' }, [8000, 1000], 0)).toBe(0);
    expect(stackElevation(level, catalog, { catalogId: 'curtain_pair' }, [1000, 1000], 0)).toBeNull();
  });
});
