import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { newSampleProject } from './helpers';

const st = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    return {
      tool: s.tool as string,
      place: s.placeCatalogId as string | null,
      objects: s.scene.levels.find((l: any) => l.id === s.levelId).objects as any[],
      env: s.scene.environment ?? {},
      meta: s.scene.meta ?? {},
      past: s.history.past.length as number,
    };
  });
const ready3d = (page: Page) =>
  page.waitForFunction(() => (window as any).__editor.viewer3d()?.info().calls > 0, null, {
    timeout: 60_000,
  });

/** FE-PRJ-02／06：標籤、垃圾桶與還原；匯出專案檔再匯入 */
test('專案列表：標籤篩選、垃圾桶還原、專案檔匯出與匯入', async ({ page }) => {
  test.setTimeout(120_000);
  await newSampleProject(page);
  await page.goto('/');
  const card = page.getByTestId('project-card').first();
  await card.getByTestId('project-tag-edit').click();
  await page.getByRole('dialog').locator('input').fill('客戶甲, 北歐');
  await page.getByRole('dialog').locator('input').press('Enter');
  await expect(card.getByTestId('project-tags')).toContainText('客戶甲');
  const n = await page.getByTestId('project-card').count();
  // 匯出
  const [dl] = await Promise.all([page.waitForEvent('download'), card.getByTestId('project-export').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.interiorai$/);
  const path = await dl.path();
  // 刪除 → 垃圾桶 → 還原
  await card.getByTestId('project-delete').click();
  await expect(page.getByTestId('project-card')).toHaveCount(n - 1);
  await page.getByTestId('projects-trash').click();
  await page.getByTestId('project-restore').first().click();
  await page.getByRole('radiogroup').getByRole('button').first().click();
  await expect(page.getByTestId('project-card')).toHaveCount(n);
  // 匯入 → 多一個專案
  await page
    .getByTestId('project-file-input')
    .setInputFiles({ name: 'x.interiorai', mimeType: 'application/gzip', buffer: readFileSync(path!) });
  await expect(page.getByTestId('project-card')).toHaveCount(n + 1);
});

/** FE-UX-02／03／04／07：指令面板、快捷鍵一覽、歷史跳回、面板收合 */
test('指令面板、快捷鍵、歷史面板、收合面板', async ({ page }) => {
  await newSampleProject(page);
  await page.locator('#canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill('多邊形');
  await page.getByTestId('palette-input').press('Enter');
  await expect.poll(async () => (await st(page)).tool).toBe('polygon');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill('雙人床');
  await page.getByTestId('palette-input').press('Enter');
  await expect.poll(async () => (await st(page)).place).toMatch(/^bed_/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  // 歷史：做三個動作 → 點「開始」全部復原 → 點最後一步全部重做
  await page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    const lv = s.scene.levels[0];
    s.select([lv.objects[0].id]);
  });
  const rot0 = (await st(page)).objects[0].rotationY;
  for (let i = 0; i < 3; i++) await page.keyboard.press('e');
  expect((await st(page)).past).toBe(3);
  await page.getByTestId('open-history').click();
  await expect(page.getByTestId('history-step')).toHaveCount(4);
  await page.getByTestId('history-step').first().click();
  expect((await st(page)).objects[0].rotationY).toBeCloseTo(rot0);
  await page.getByTestId('history-step').last().click();
  expect((await st(page)).past).toBe(3);
  await page.keyboard.press('Escape');
  await page.keyboard.press('\\');
  await expect(page.getByTestId('toggle-left')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('aside')).toHaveCount(0);
});

/** FE-DOC-04／FE-RND-07／08：DXF、SVG、GLB、4K、俯視平面圖 */
test('匯出：DXF／SVG（2D）、GLB／4K／俯視圖（3D）', async ({ page }) => {
  test.setTimeout(120_000);
  await newSampleProject(page);
  await page.getByTestId('open-export').click();
  for (const [id, ext] of [
    ['dxf', 'dxf'],
    ['svg', 'svg'],
  ] as const) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId(`export-${id}`).click()]);
    expect(dl.suggestedFilename()).toMatch(new RegExp(`\\.${ext}$`));
  }
  await page.keyboard.press('Escape');
  await page.getByTestId('view-3d').click();
  await ready3d(page);
  await page.getByTestId('open-export').click();
  const [glb] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-glb').click()]);
  const buf: Buffer = readFileSync(await glb.path());
  expect(buf.subarray(0, 4).toString()).toBe('glTF');
  expect(buf.length).toBeGreaterThan(50_000);
  await page.getByRole('button', { name: /4K/ }).click();
  const [shot] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-shot').click()]);
  const png: Buffer = readFileSync(await shot.path());
  expect(png.readUInt32BE(16)).toBe(3840);
  expect(png.readUInt32BE(20)).toBe(2160);
  const [top] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-topplan').click(),
  ]);
  expect(top.suggestedFilename()).toMatch(/-top\.png$/);
});

/** FE-V3D-06／FE-LGT-02／FE-PRJ-07：日照模擬、燈光方案、專案屬性 */
test('日照模擬改變太陽；燈光方案一次套用；專案屬性', async ({ page }) => {
  await newSampleProject(page);
  await page.evaluate(() => localStorage.setItem('lighting', 'day'));
  await page.reload();
  await page.waitForFunction(() => (window as any).__editor);
  await page.getByTestId('sun-city').selectOption('tokyo');
  const env = (await st(page)).env;
  expect(env.sunElevationDeg).toBeGreaterThan(2);
  expect((await st(page)).meta.site.lat).toBeCloseTo(35.68);
  await page.getByTestId('sun-date').fill('2026-12-21');
  const winter = (await st(page)).env;
  expect(winter.sunElevationDeg).toBeLessThan(env.sunElevationDeg);
  await page.getByTestId('light-preset-cozy').click();
  const lights = (await st(page)).objects.filter((o) => o.light);
  expect(lights.length).toBeGreaterThan(5);
  expect(lights.every((o) => o.light.kelvin === 2700)).toBe(true);
  await page.getByTestId('open-info').click();
  await page.getByTestId('info-client').fill('王小姐');
  await page.getByTestId('info-budget').click();
  expect((await st(page)).meta.project.client).toBe('王小姐');
});
