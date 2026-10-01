import { expect, test, type Page } from '@playwright/test';
import { newBlankProject, newSampleProject } from './helpers';

const lv = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    return s.scene.levels.find((l: any) => l.id === s.levelId);
  });

/** FE-AST-08：廚房 L 型自動配置；一次 undo */
test('廚房自動配置（L 型）', async ({ page }) => {
  await newBlankProject(page);
  // 以工具畫一個 3.6 × 3 m 房間
  await page.getByTestId('tool-rect').click();
  const a = await page.evaluate(() => (window as any).__editor.plan2d().worldToClient([0, 0]));
  const b = await page.evaluate(() => (window as any).__editor.plan2d().worldToClient([3600, 3000]));
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  await page.mouse.move(b[0], b[1], { steps: 6 });
  await page.mouse.up();
  const room = (await lv(page)).rooms[0];
  await page.evaluate((id) => (window as any).__editor.store.getState().select([id]), room.id);
  await page.getByTestId('section-kitchen').locator('summary').click();
  await page.getByTestId('kitchen-shape').selectOption('L');
  await page.getByTestId('kitchen-run').click();
  const objs = (await lv(page)).objects;
  const ids = objs.map((o: any) => o.catalogId);
  expect(ids).toEqual(expect.arrayContaining(['sink_900', 'stove_600', 'fridge_a', 'range_hood_900']));
  await page.keyboard.press('Control+z');
  expect((await lv(page)).objects.length).toBe(0);
});

/** FE-AST-07：訂製櫃設計器 */
test('訂製櫃設計器：分欄、格位、把手 → 參數', async ({ page }) => {
  await newSampleProject(page);
  const ward = (await lv(page)).objects.find((o: any) => o.catalogId === 'cabinet_wardrobe_1800');
  await page.evaluate((id) => (window as any).__editor.store.getState().select([id]), ward.id);
  await page.getByTestId('open-cabinet-designer').click();
  await page.getByTestId('cabinet-add-col').click();
  await page.getByTestId('cabinet-cell-0-0').selectOption('d');
  await page.getByTestId('cabinet-apply').click();
  const o = (await lv(page)).objects.find((x: any) => x.id === ward.id);
  expect(o.params.x_layout.split('|')).toHaveLength(4);
  expect(o.params.x_layout.startsWith('d,')).toBe(true);
  expect(o.params.x_handle).toBe('bar');
  await page.getByTestId('view-3d').click();
  await page.waitForFunction(() => (window as any).__editor.viewer3d()?.info().calls > 0, null, {
    timeout: 60_000,
  });
});

/** FE-UX-03／07：自訂快捷鍵、調整面板寬度 */
test('自訂快捷鍵與面板調寬', async ({ page }) => {
  await newSampleProject(page);
  await page.locator('#canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('?');
  await page.getByTestId('keymap-editor').locator('summary').click();
  await page.getByTestId('rebind-w').click();
  await page.keyboard.press('b');
  await page.keyboard.press('Escape');
  await page.locator('#canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('b');
  await expect.poll(() => page.evaluate(() => (window as any).__editor.store.getState().tool)).toBe('wall');
  await page.keyboard.press('Escape');
  await page.keyboard.press('w');
  await expect.poll(() => page.evaluate(() => (window as any).__editor.store.getState().tool)).toBe('select');
  // 面板調寬
  const h = (await page.getByTestId('resize-left').boundingBox())!;
  const before = (await page.locator('aside').first().boundingBox())!.width;
  await page.mouse.move(h.x + 2, h.y + 200);
  await page.mouse.down();
  await page.mouse.move(h.x + 102, h.y + 200, { steps: 5 });
  await page.mouse.up();
  const after = (await page.locator('aside').first().boundingBox())!.width;
  expect(after - before).toBeGreaterThan(80);
  await page.evaluate(() => localStorage.removeItem('keymap'));
});
