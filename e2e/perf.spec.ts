import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { newBlankProject } from './helpers';

/**
 * B8 效能量測（軟性指標，ADR-011：記錄即通過；未達標寫入 PROGRESS「未達標清單」）。
 * 場景：5 房間 + 200 件家具。結果寫入 e2e/results/perf.json。
 */
test('200 家具、5 房間：3D 編輯 FPS 與 draw calls', async ({ page }) => {
  test.setTimeout(300_000);
  await newBlankProject(page);
  await page.evaluate(() => {
    const ed = (window as any).__editor;
    const s = ed.store.getState();
    const L = s.levelId;
    const cmds: any[] = [];
    // 5 間 4m×4m 房間排成一列
    const scene = structuredClone(s.scene);
    const lvl = scene.levels[0];
    let id = 0;
    const w = (a: number[], b: number[]) =>
      lvl.walls.push({
        id: `w_p${id++}`,
        a,
        b,
        thickness: 120,
        materialId: 'mat_paint_white',
        materialIdB: 'mat_paint_white',
      });
    for (let r = 0; r <= 5; r++) w([r * 4000, 0], [r * 4000, 4000]);
    for (let r = 0; r < 5; r++) {
      w([r * 4000, 0], [(r + 1) * 4000, 0]);
      w([(r + 1) * 4000, 4000], [r * 4000, 4000]);
    }
    const kinds = [
      'sofa_3seat_a',
      'chair_dining_a',
      'table_side_a',
      'plant_a',
      'nightstand_a',
      'lamp_floor_a',
      'chair_office_a',
      'table_coffee_a',
    ];
    for (let i = 0; i < 200; i++) {
      const room = i % 5;
      const k = Math.floor(i / 5);
      lvl.objects.push({
        id: `obj_p${i}`,
        catalogId: kinds[i % kinds.length],
        position: [room * 4000 + 500 + (k % 6) * 550, 0, 500 + Math.floor(k / 6) * 450],
        rotationY: 0,
        scale: [1, 1, 1],
      });
    }
    void cmds;
    void L;
    s.load({ projectId: s.projectId, projectName: 'perf', scene });
  });
  await page.getByTestId('view-3d').click();
  await page.waitForFunction(() => (window as any).__editor.viewer3d()?.info().calls > 0, null, {
    timeout: 240_000,
  });
  const r = await page.evaluate(() => (window as any).__editor.viewer3d().bench(4000));
  const env = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const d = c?.getExtension('WEBGL_debug_renderer_info');
    return {
      ua: navigator.userAgent,
      gpu: d ? c!.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown',
      dpr: devicePixelRatio,
    };
  });
  mkdirSync('e2e/results', { recursive: true });
  writeFileSync(
    'e2e/results/perf.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        scene: '5 rooms, 200 objects',
        ...r,
        env,
        budget: { fps: 50, drawCalls: 300 },
      },
      null,
      2,
    ),
  );
  console.log('perf', JSON.stringify(r));
  // 軟性：只驗證量測有效；是否達標由 PROGRESS 記錄
  expect(r.frames).toBeGreaterThan(10);
  expect(r.drawCalls).toBeGreaterThan(0);
});
