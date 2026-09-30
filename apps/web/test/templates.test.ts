import { describe, expect, it } from 'vitest';
import { detectRooms } from '@interiorai/core-geometry';
import { validateScene } from '@interiorai/scene-schema';
import { buildTemplateScene, TEMPLATE_IDS, templateInfo } from '../src/templates';

describe('範本庫', () => {
  for (const id of TEMPLATE_IDS)
    it(`${id}：合法場景、房間全部命名與設定用途、已佈置家具`, () => {
      const scene = buildTemplateScene(id, { names: (k) => k, style: 'nordic' });
      expect(validateScene(scene).ok).toBe(true);
      const lv = scene.levels[0]!;
      expect(detectRooms(lv).rooms.length).toBe(templateInfo(id).rooms);
      expect(lv.rooms.every((r) => r.label && r.kind)).toBe(true);
      expect(lv.openings.filter((o) => o.type === 'door').length).toBeGreaterThanOrEqual(2);
      expect(lv.objects.length).toBeGreaterThan(templateInfo(id).rooms * 2);
    });
  it('空房範本（不佈置）', () => {
    const scene = buildTemplateScene('twoBed', { names: (k) => k, furnish: false, height: 3000 });
    expect(scene.levels[0]!.objects).toHaveLength(0);
    expect(scene.levels[0]!.height).toBe(3000);
  });
});
