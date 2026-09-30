import { expect, test, type Page } from '@playwright/test';
import { clickWorld, newSampleProject } from './helpers';

const lv = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    return s.scene.levels.find((l: any) => l.id === s.levelId);
  });

/** FE-DOC-05／03：放置水電點位（貼牆、離地高）；施工圖集含水電圖與立面 */
test('水電點位與施工圖集', async ({ page }) => {
  await newSampleProject(page);
  await page.getByTestId('asset-search').fill('插座');
  await page.getByTestId('asset-mep_outlet').click();
  await clickWorld(page, [3000, 150]);
  await expect
    .poll(async () => (await lv(page)).objects.filter((o: any) => o.catalogId === 'mep_outlet').length)
    .toBe(1);
  const o = (await lv(page)).objects.find((x: any) => x.catalogId === 'mep_outlet');
  expect(o.position[1]).toBe(300);
  await page.getByTestId('open-export').click();
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByTestId('export-drawings').click(),
  ]);
  await popup.waitForLoadState();
  const html = await popup.content();
  expect(html).toContain('水電點位圖');
  expect(html).toMatch(/立面/);
  expect((html.match(/class="page"|class=page/g) ?? []).length).toBeGreaterThan(8);
  await popup.close();
});

/** FE-SHR-03：釘選留言、回覆、解決 */
test('留言：釘選、回覆、解決', async ({ page }) => {
  await newSampleProject(page);
  await page.getByTestId('open-comments').click();
  await page.getByTestId('comment-add').click();
  await expect(page.getByTestId('comment-overlay')).toBeVisible();
  const box = (await page.getByTestId('plan2d').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const dlg = page.getByRole('dialog');
  await dlg.locator('input').fill('這面牆改成玻璃隔間？');
  await dlg.locator('input').press('Enter');
  await expect(page.getByTestId('comment-thread')).toHaveCount(1);
  await page.getByTestId('comment-reply').fill('可以，改用黑框玻璃');
  await page.getByTestId('comment-reply').press('Enter');
  await expect(page.getByTestId('comment-thread')).toContainText('黑框玻璃');
  await page.getByTestId('comment-resolve').click();
  await expect(page.getByTestId('comment-thread')).toHaveCount(0);
  const meta = await page.evaluate(() => (window as any).__editor.store.getState().scene.meta.comments);
  expect(meta[0].resolved).toBe(true);
  expect(meta[0].replies).toHaveLength(1);
});

/** FE-MOB-01／02：手機寬度——專案列表、編輯器面板預設收合、觸控目標 ≥ 44 px、分享頁 */
test.describe('手機', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('專案列表與編輯器在手機可用', async ({ page }) => {
    await newSampleProject(page);
    await expect(page.locator('aside')).toHaveCount(0);
    const b = await page.getByTestId('view-3d').boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(44);
    await page.goto('/');
    await expect(page.getByTestId('project-card').first()).toBeVisible();
    const card = (await page.getByTestId('project-card').first().boundingBox())!;
    expect(card.width).toBeLessThanOrEqual(390);
  });
});
