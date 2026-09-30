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

/** FE-PLAN-02：三點弧牆 */
test('弧形牆：三點 → 多段牆沿圓弧', async ({ page }) => {
  await newBlankProject(page);
  await page.getByTestId('tool-arc').click();
  await clickWorld(page, [0, 0]);
  await clickWorld(page, [4000, 0]);
  await clickWorld(page, [2000, 1500]);
  const walls = (await lv(page)).walls;
  expect(walls.length).toBeGreaterThan(6);
  expect(Math.max(...walls.flatMap((w: any) => [w.a[1], w.b[1]]))).toBeGreaterThan(1400);
});

/** FE-FIN-02／03／04、FE-PROP-04／05：護牆板、頂角線、天花跌級、貼圖參數、框架材質 */
test('牆面造型、天花、貼圖參數、框架材質', async ({ page }) => {
  test.setTimeout(120_000);
  await newSampleProject(page);
  const wall = (await lv(page)).walls[0];
  await page.evaluate((id) => (window as any).__editor.store.getState().select([id]), wall.id);
  await page.getByTestId('section-finish').locator('summary').click();
  await page.getByTestId('finish-wainscot').click();
  await page.getByTestId('finish-crown').click();
  await page.getByTestId('section-uv').locator('summary').click();
  let w = (await lv(page)).walls.find((x: any) => x.id === wall.id);
  expect(w.wainscot).toMatchObject({ height: 900, style: 'panel' });
  expect(w.crown).toMatchObject({ profile: 'cove' });
  // 房間天花：間接燈槽
  const room = (await lv(page)).rooms[0];
  await page.evaluate((id) => (window as any).__editor.store.getState().select([id]), room.id);
  await page.getByTestId('section-ceiling').locator('summary').click();
  await page.getByTestId('ceiling-type').selectOption('cove');
  const r = (await lv(page)).rooms.find((x: any) => x.id === room.id);
  expect(r.ceiling).toMatchObject({ type: 'cove', coveKelvin: 2700 });
  // 3D：牆飾與天花網格存在
  await page.getByTestId('view-3d').click();
  await ready3d(page);
  await page.getByTestId('toggle-ceiling').click();
  await page.waitForTimeout(500);
  const kinds = await page.evaluate(() => (window as any).__editor.viewer3d().kinds());
  expect(kinds.ceiling).toBeGreaterThanOrEqual(4);
  // 家具框架材質
  const sofa = (await lv(page)).objects.find((o: any) => o.catalogId === 'sofa_3seat_a');
  await page.evaluate((id) => (window as any).__editor.store.getState().select([id]), sofa.id);
  await page.evaluate(() =>
    (document.querySelector('[data-testid=mat-slot-frame-metal_brushed_brass]') as HTMLInputElement).click(),
  );
  const s2 = (await lv(page)).objects.find((o: any) => o.id === sofa.id);
  expect(s2.materialOverrides.frame).toBe('metal_brushed_brass');
  w = (await lv(page)).walls.find((x: any) => x.id === wall.id);
  expect(w.wainscot).toBeTruthy();
});
