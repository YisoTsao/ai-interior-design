import { expect, test, type Page } from '@playwright/test';
import { newSampleProject } from './helpers';

const objects = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    return s.scene.levels.find((l: any) => l.id === s.levelId).objects.length as number;
  });

async function fromTemplate(page: Page, id: string, furnish: boolean) {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('wizard-tab-template').click();
  await page.getByTestId(`tpl-${id}`).click();
  if (!furnish) await page.getByTestId('tpl-furnish').uncheck();
  await page.getByTestId('wizard-name').fill(`E2E ${id}`);
  await page.getByTestId('wizard-create').click();
  await page.waitForFunction(
    () => (window as any).__editor && document.querySelector('[data-testid=plan2d]'),
  );
}

/** FE-PRJ-01／03：精靈 → 範本（已佈置）→ 專案列表顯示坪數、房數、縮圖；搜尋與清單版面 */
test('新建精靈：三房範本自動佈置；列表顯示摘要、縮圖、搜尋', async ({ page }) => {
  test.setTimeout(120_000);
  await fromTemplate(page, 'threeBed', true);
  expect(await objects(page)).toBeGreaterThan(25);
  // 存檔後擷取縮圖
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 15_000 });
  await page.waitForTimeout(1500);
  await page.goto('/');
  const card = page.getByTestId('project-card').filter({ hasText: 'E2E threeBed' });
  await expect(card.getByTestId('project-stats')).toContainText('6');
  await expect(card.getByTestId('project-thumb')).toBeVisible();
  await page.getByTestId('project-search').fill('zzz-none');
  await expect(page.getByTestId('project-card')).toHaveCount(0);
  await page.getByTestId('project-search').fill('threeBed');
  await expect(page.getByTestId('project-card')).toHaveCount(1);
  await page.getByTestId('layout-list').click();
  await expect(page.getByTestId('project-list')).toHaveAttribute('data-layout', 'list');
});

/** FE-AI-02：三種風格提案 → 套用 → 一次復原 */
test('AI 自動佈置：三個提案、套用、單一 undo', async ({ page }) => {
  await fromTemplate(page, 'twoBed', false);
  expect(await objects(page)).toBe(0);
  await page.getByTestId('open-furnish').click();
  await page.getByTestId('furnish-generate').click();
  await expect(page.locator('[data-testid^=furnish-variant-]')).toHaveCount(3);
  await page.getByTestId('furnish-variant-1').click();
  await page.getByTestId('furnish-apply').click();
  const n = await objects(page);
  expect(n).toBeGreaterThan(15);
  await page.keyboard.press('Control+z');
  expect(await objects(page)).toBe(0);
});

/** FE-AI-03：對話 → 差異預覽 → 確認後才修改 */
test('AI 助理：提案顯示差異，按套用才修改場景', async ({ page }) => {
  await newSampleProject(page);
  const before = await objects(page);
  await page.getByTestId('open-assistant').click();
  await page.getByTestId('assistant-input').fill('在客餐廳加一盆植物');
  await page.getByTestId('assistant-input').press('Enter');
  const prop = page.getByTestId('assistant-proposal').first();
  await expect(prop).toBeVisible();
  expect(await objects(page)).toBe(before);
  await prop.getByTestId('assistant-apply').click();
  expect(await objects(page)).toBe(before + 1);
});

/** FE-DOC-01／02：報價明細、折扣、CSV 匯出 */
test('報價：總計、折扣即時更新、匯出 CSV', async ({ page }) => {
  await newSampleProject(page);
  await page.getByTestId('open-quote').click();
  const total = page.getByTestId('quote-total');
  const num = async () => Number((await total.innerText()).replace(/[^\d]/g, ''));
  const t0 = await num();
  expect(t0).toBeGreaterThan(10_000);
  await page.getByTestId('quote-discount').fill('10000');
  await page.getByTestId('quote-discount').blur();
  await expect.poll(num).toBeLessThan(t0);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('quote-csv').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.csv$/);
  await page.getByTestId('quote-tab-rooms').click();
  await expect(page.getByTestId('quote-rooms').locator('li')).toHaveCount(3);
});

/** FE-RND-02／04：截圖、720° 全景進圖庫並以全景檢視器開啟 */
test('圖庫：截圖與 720° 全景', async ({ page }) => {
  test.setTimeout(120_000);
  await newSampleProject(page);
  await page.getByTestId('view-3d').click();
  await page.waitForFunction(() => (window as any).__editor.viewer3d()?.info().calls > 0, null, {
    timeout: 60_000,
  });
  await page.getByTestId('open-gallery').click();
  await page.getByTestId('gallery-snap').click();
  await expect(page.getByTestId('gallery-grid').locator('li')).toHaveCount(1);
  await page.getByTestId('gallery-pano').click();
  await expect(page.getByTestId('pano-viewer')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('pano-viewer').locator('canvas')).toBeVisible();
});

/** FE-SHR-01：分享連結 → 唯讀檢視（2D／3D），不能修改 */
test('分享連結：唯讀檢視頁', async ({ page }) => {
  test.setTimeout(120_000);
  await newSampleProject(page);
  await page.getByTestId('open-share').click();
  const url = page.getByTestId('share-url');
  await expect(url).toHaveValue(/\/view#s=/);
  const link = await url.inputValue();
  await page.goto(link);
  await expect(page.getByTestId('share-view')).toBeVisible();
  await expect(page.getByTestId('viewer3d')).toBeVisible();
  const ok = await page.evaluate(() => {
    const s = (window as any).__share?.getState?.();
    return s ? s.exec({ id: 'x', label: 'x', do: () => {} }) : false;
  });
  expect(ok).toBe(false);
});

/** FE-UX-01：導覽可從「？」重看，逐步到完成 */
test('新手導覽：逐步完成', async ({ page }) => {
  await newSampleProject(page);
  await expect(page.getByTestId('tour')).toHaveCount(0); // 自動化測試不自動顯示
  await page.getByTestId('open-tour').click();
  for (let i = 0; i < 7; i++) await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour')).toHaveCount(0);
});
