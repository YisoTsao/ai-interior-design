import { expect, test, type Page } from '@playwright/test';
import { level, newSampleProject } from './helpers';

/**
 * 前台 11 規格 P2（第九批）：RND-06 漫遊影片、DOC-06 圖紙版面、RND-02 全屋全景與熱點、PRJ-05 戶型庫、
 * AST-09 以圖找物、AI-04 虛擬清空、AI-05 文字生成、MOB-03 AR、MOB-04 RoomPlan 掃描匯入。
 */
const ready3d = (page: Page) =>
  page.waitForFunction(() => (window as any).__editor?.viewer3d()?.info().calls > 0, null, {
    timeout: 60_000,
  });

test('RND-06 漫遊影片：兩個書籤 → 預覽 → 錄影', async ({ page }) => {
  test.setTimeout(120_000);
  await newSampleProject(page);
  await page.getByTestId('view-3d').click();
  await ready3d(page);
  await page.getByTestId('bookmarks-open').click();
  await page.getByTestId('bookmark-save').click();
  await page.getByTestId('view-preset').selectOption('iso-nw');
  await page.waitForTimeout(400);
  await page.getByTestId('bookmark-save').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('open-walkthrough').click();
  await page.getByTestId('walk-seg').fill('0.5');
  await page.getByTestId('walk-preview').click();
  await expect(page.getByTestId('walk-preview')).toBeVisible({ timeout: 10_000 });
  const recordable = await page.getByTestId('walk-record').isEnabled();
  if (recordable) {
    await page.getByTestId('walk-record').click();
    await expect(page.getByTestId('walk-result').locator('video')).toBeVisible({ timeout: 20_000 });
  }
});

test('DOC-06 圖紙版面：A3 雙圖、平面 1:100、圖簽', async ({ page }) => {
  await newSampleProject(page);
  await page.getByTestId('view-3d').click();
  await ready3d(page);
  await page.getByTestId('open-layout').click();
  await page.getByTestId('layout-tpl-two').click();
  await page.getByTestId('layout-src-0').selectOption('plan');
  await page.getByTestId('layout-scale-0').selectOption('100');
  const doc = page.frameLocator('[data-testid=layout-preview]');
  await expect(doc.locator('.sheet')).toHaveAttribute('data-paper', 'A3-landscape');
  await expect(doc.locator('.tb')).toContainText('1:100');
  await expect(doc.locator('.vp img')).toHaveCount(2);
  await page.getByTestId('layout-dialog').screenshot({ path: 'e2e/results/batch-c-layout.png' });
});

test('PRJ-05 戶型庫：篩選 → 預覽 → 建立專案', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('wizard-tab-library').click();
  await page.getByTestId('floorplan-bed').selectOption('3');
  const items = page.getByTestId('floorplan-list').locator('button');
  await expect(items).toHaveCount(4);
  await items.nth(2).click();
  await expect(page.getByTestId('floorplan-preview').locator('img')).toBeVisible();
  await page.getByTestId('wizard-create').click();
  await page.waitForFunction(() => (window as any).__editor);
  const l = await level(page);
  expect(l.walls).toBeGreaterThan(6);
  expect(l.objects).toBe(0);
  expect(l.rooms).toBeGreaterThanOrEqual(5);
});

test('AST-09 以圖找物、AI-05 文字生成、MOB-03 AR', async ({ page }) => {
  test.setTimeout(120_000);
  await newSampleProject(page);
  // 以圖找物：用一張棕色沙發縮圖當查詢
  await page.getByTestId('open-image-search').click();
  await page.getByTestId('image-search-file').setInputFiles('e2e/fixtures/models/wood.png');
  await expect(page.getByTestId('image-search-results').locator('button')).toHaveCount(12, {
    timeout: 60_000,
  });
  await page.keyboard.press('Escape');

  // 文字生成：材質
  await page.getByTestId('open-text-gen').click();
  await page.getByTestId('text-gen-input').fill('鼠尾草綠條紋壁紙');
  await expect(page.getByTestId('text-gen-material')).toContainText('stripe');
  await page.getByTestId('text-gen-save').click();
  await expect(page.getByTestId('text-gen')).toContainText(/已加入|Added/);
  // 文字生成：家具
  await page.getByTestId('text-gen-tab-furniture').click();
  await page.getByTestId('text-gen-input').fill('灰色三人沙發 寬 200 公分');
  await expect(page.getByTestId('text-gen-furniture')).toContainText('沙發');
  const before = (await level(page)).objects;
  await page.getByTestId('text-gen-place').click();
  expect((await level(page)).objects).toBe(before + 1);
  const placed = await page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    return s.scene.levels[0].objects.find((o: any) => o.id === s.selection[0]);
  });
  expect(placed.appearance.color).toBe('#9a9a96');
  await page.keyboard.press('Escape');

  // AR：桌機（無 WebXR）→ 提示＋USDZ 下載
  await page
    .getByRole('button', { name: /」詳情$|details/i })
    .first()
    .click();
  const dl = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByTestId('asset-ar').click();
  expect((await dl).suggestedFilename()).toMatch(/\.usdz$/);
  await expect(page.getByTestId('ar-msg')).toBeVisible();
});

test('AI-04 虛擬清空（照片）', async ({ page }) => {
  await newSampleProject(page);
  await page.getByTestId('open-photo-style').click();
  await page.getByTestId('photo-file').setInputFiles('images2.jpeg');
  await expect(page.getByTestId('photo-stage')).toBeVisible();
  await page.getByTestId('photo-brush').click();
  const mb = (await page.getByTestId('photo-mask').boundingBox())!;
  await page.mouse.move(mb.x + mb.width * 0.5, mb.y + mb.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(mb.x + mb.width * 0.6, mb.y + mb.height * 0.7, { steps: 6 });
  await page.mouse.up();
  await page.getByTestId('photo-clear').click();
  await expect(page.getByTestId('photo-results').locator('button')).toHaveCount(1, { timeout: 30_000 });
});

test('MOB-04 RoomPlan 掃描 → 校正頁 → 3D；RND-02 分享頁全屋全景熱點', async ({ page, context }) => {
  test.setTimeout(150_000);
  await page.goto('/');
  await page.getByTestId('import-plan').click();
  await page.getByTestId('import-file').setInputFiles('e2e/fixtures/roomplan.json');
  await page.waitForURL(/\/import\//);
  await expect(page.getByTestId('plan-engine')).toContainText(/RoomPlan/);
  await page.getByTestId('scale-confirm').click();
  await page.getByTestId('build-3d').click();
  await page.waitForURL(/\/p\/.+\/edit\?view=3d/);
  await ready3d(page);
  const l = await level(page);
  expect(l.walls).toBeGreaterThanOrEqual(5);
  expect(l.openings).toBe(3);
  expect(l.rooms).toBe(2);
  // 分享頁：全屋全景＋熱點
  await page.getByTestId('open-share').click();
  await expect(page.getByTestId('share-url')).toHaveValue(/view#s=/);
  const url = await page.getByTestId('share-url').inputValue();
  const view = await context.newPage();
  await view.goto(url);
  await view.waitForFunction(
    () => (window as any).__share && document.querySelector('[data-testid=viewer3d] canvas'),
  );
  await view.waitForTimeout(1500);
  await view.getByTestId('share-pano').click();
  await expect(view.getByTestId('pano-viewer')).toBeVisible({ timeout: 30_000 });
  await expect(view.locator('[data-testid^="pano-hotspot-"]')).toHaveCount(1);
  const from = await view.getByTestId('pano-room').getAttribute('data-room');
  await view.locator('[data-testid^="pano-hotspot-"]').first().dispatchEvent('click');
  await expect(view.getByTestId('pano-room')).not.toHaveAttribute('data-room', from ?? '');
});
