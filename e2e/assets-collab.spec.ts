import { expect, test, type Page } from '@playwright/test';
import { clickWorld, newBlankProject, newSampleProject } from './helpers';

const lv = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    return s.scene.levels.find((l: any) => l.id === s.levelId);
  });
const ready3d = (page: Page) =>
  page.waitForFunction(() => (window as any).__editor.viewer3d()?.info().calls > 0, null, {
    timeout: 60_000,
  });

/** FE-AST-05／06：資產詳情以選定材質放置；套組一鍵放置為同一群組 */
test('資產詳情＋材質放置；套組', async ({ page }) => {
  await newBlankProject(page);
  await page.getByTestId('info-sofa_3seat_a').click();
  await expect(page.getByTestId('model-preview').locator('canvas')).toBeVisible();
  await page.getByTestId('detail-mat-fabric_emerald_velvet').click();
  await page.getByTestId('asset-detail-place').click();
  await clickWorld(page, [0, 0]);
  await expect.poll(async () => (await lv(page)).objects.length).toBe(1);
  await expect
    .poll(async () => JSON.stringify((await lv(page)).objects[0].materialOverrides ?? {}))
    .toContain('fabric_emerald_velvet');
  await page.getByTestId('assets-sets').click();
  await page.getByTestId('set-dining4').click();
  const objs = (await lv(page)).objects;
  expect(objs.length).toBe(1 + 6);
  const g = new Set(objs.slice(1).map((o: any) => o.groupId));
  expect(g.size).toBe(1);
});

/** FE-FIN-05／06：色卡套用到牆；上傳自訂材質 */
test('色卡與自訂材質', async ({ page }) => {
  await newSampleProject(page);
  const wall = (await lv(page)).walls[0];
  await page.evaluate((id) => (window as any).__editor.store.getState().select([id]), wall.id);
  await page.getByTestId('inspector-wall').getByTestId('color-cards').first().click();
  await page.getByTestId('color-S0502-Y').click();
  const w = (await lv(page)).walls.find((x: any) => x.id === wall.id);
  expect([w.appearance?.color, w.appearanceB?.color]).toContain('#f2efe4');
  await page.getByTestId('tab-materials').click();
  await page.getByTestId('material-upload-open').click();
  await page.getByTestId('material-file').setInputFiles('fixtures/plans/synth-filled.png');
  await page.getByTestId('material-name').fill('測試磁磚');
  await page.getByTestId('material-save').click();
  await expect(page.locator('[data-testid^=paint-um_]')).toHaveCount(1);
});

/** FE-AI-06：情境板萃取色盤與推薦 */
test('風格探索：色盤、風格、推薦', async ({ page }) => {
  await newSampleProject(page);
  await page.getByTestId('open-mood').click();
  await page.getByTestId('mood-file').setInputFiles('fixtures/plans/synth-filled.png');
  await expect(page.getByTestId('mood-palette').locator('button').first()).toBeVisible();
  await expect(page.getByTestId('mood-styles').locator('li')).toHaveCount(4);
  await expect(page.getByTestId('mood-recs').locator('li')).toHaveCount(12);
});

/** FE-RND-05／FE-SHR-04：圖片後製另存；版本儲存、比較、還原 */
test('後製另存；版本比較與還原', async ({ page }) => {
  await newSampleProject(page);
  await page.getByTestId('open-gallery').click();
  await page.getByTestId('gallery-snap').click();
  await page.getByTestId('gallery-grid').locator('li button').first().click();
  await page.getByTestId('photo-edit').click();
  await page.getByTestId('photo-watermark').fill('INTERIOR AI');
  await page.getByTestId('photo-crop').selectOption('1:1');
  await page.getByTestId('photo-save').click();
  await page.getByRole('button', { name: /返回|Back/ }).click();
  await expect(page.getByTestId('gallery-grid').locator('li')).toHaveCount(2);
  await page.keyboard.press('Escape');

  await page.getByTestId('open-versions').click();
  await page.getByTestId('version-name').fill('初稿');
  await page.getByTestId('version-save').click();
  await expect(page.getByTestId('version-row').filter({ hasText: '初稿' })).toHaveCount(1);
  const o = (await lv(page)).objects[0];
  await page.evaluate((id) => {
    const s = (window as any).__editor.store.getState();
    s.exec({
      id: 'm',
      label: 'command.transformObject',
      do: (d: any) => {
        const t = d.levels[0].objects.find((x: any) => x.id === id);
        t.position = [t.position[0] + 500, t.position[1], t.position[2]];
      },
    });
  }, o.id);
  const row = page.getByTestId('version-row').filter({ hasText: '初稿' });
  await row.getByTestId('version-compare').click();
  await expect(row.getByTestId('version-diff')).toContainText(/移動 1|moved 1/);
  await row.getByTestId('version-restore').click();
  const back = (await lv(page)).objects.find((x: any) => x.id === o.id);
  expect(back.position[0]).toBe(o.position[0]);
});

/** FE-SHR-02、FE-LGT-03、FE-V3D-07：簡報模式、照度熱度圖、剖切 */
test('簡報模式、照度分析、剖切', async ({ page }) => {
  test.setTimeout(120_000);
  await newSampleProject(page);
  await page.getByTestId('section-lux').locator('summary').click();
  await page.getByTestId('lux-toggle').click();
  await expect(page.getByTestId('lux-table').locator('tbody tr')).toHaveCount(3);
  await page.getByTestId('lux-toggle').click();
  await page.getByTestId('view-3d').click();
  await ready3d(page);
  await page.getByTestId('view-section').selectOption('h');
  await expect.poll(() => page.evaluate(() => (window as any).__editor.viewer3d().clipPlanes())).toBe(1);
  await page.getByTestId('view-section').selectOption('none');
  await expect.poll(() => page.evaluate(() => (window as any).__editor.viewer3d().clipPlanes())).toBe(0);
  // 兩個相機書籤 → 簡報
  for (const p of ['iso-se', 'iso-nw']) {
    await page.evaluate((pp) => {
      const e = (window as any).__editor;
      e.viewer3d().viewPreset(pp);
      const cam = e.viewer3d().currentCamera();
      e.store.getState().exec({
        id: `c${pp}`,
        label: 'command.saveCamera',
        do: (d: any) => {
          d.cameras = [...(d.cameras ?? []), { id: `cam_${pp.replace('-', '')}`, name: pp, ...cam }];
        },
      });
    }, p);
  }
  await page.getByTestId('open-present').click();
  await expect(page.getByTestId('presentation')).toBeVisible();
  await expect(page.getByTestId('present-title')).toContainText('1 / 2');
  await page.getByTestId('present-next').click();
  await expect(page.getByTestId('present-title')).toContainText('2 / 2');
  await page.getByTestId('present-exit').click();
  await expect(page.getByTestId('presentation')).toHaveCount(0);
  await expect(page.getByTestId('open-present')).toBeVisible();
});
