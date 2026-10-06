import { expect, test, type Page } from '@playwright/test';
import { level, newSampleProject } from './helpers';

const ready = (page: Page) =>
  page.waitForFunction(() => (window as any).__editor.viewer3d()?.info().calls > 0, null, {
    timeout: 60_000,
  });
const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    return {
      scene: s.scene,
      level: s.scene.levels.find((l: any) => l.id === s.levelId),
      selection: s.selection,
    };
  });

/**
 * ADR-023：夜間窗戶＝天空亮度、燈具／牆的屬性面板、環境曝光、上傳 GLB、物件清單隱藏。
 */
test('夜間窗戶為夜空亮度；燈光與牆屬性可調並可 undo', async ({ page }) => {
  test.setTimeout(180_000);
  await newSampleProject(page);
  await page.evaluate(() => {
    localStorage.setItem('viewStyle', 'dollhouse');
    localStorage.setItem('lighting', 'night');
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).__editor);
  await page.getByTestId('view-3d').click();
  await ready(page);

  // 窗戶不再是 700 lm/m² 的發光板：預設城市夜空 0.5 cd/m²，遠暗於燈具
  const lights = await page.evaluate(() => (window as any).__editor.viewer3d().lights());
  expect(lights.windowLuminance).toBeLessThanOrEqual(1);
  expect(lights.ambient).toBeGreaterThan(0);

  // 未選取 → 場景面板：曝光補償
  await expect(page.getByTestId('inspector-scene')).toBeVisible();
  await page.getByTestId('env-exposure-input').fill('1');
  await page.getByTestId('env-exposure-input').press('Enter');
  expect((await state(page)).scene.environment).toEqual({ exposureEv: 1 });

  // 燈具：光通量、色溫、俯仰角
  const lampId = (await state(page)).level.objects.find((o: any) => o.catalogId === 'lamp_floor_a').id;
  await page.evaluate((id) => (window as any).__editor.store.getState().select([id]), lampId);
  await expect(page.getByTestId('section-light')).toBeVisible();
  await page.getByTestId('light-lumens-input').fill('2000');
  await page.getByTestId('light-lumens-input').press('Enter');
  await page.getByTestId('light-kelvin-input').fill('2200');
  await page.getByTestId('light-kelvin-input').press('Enter');
  const lamp = (await state(page)).level.objects.find((o: any) => o.id === lampId);
  expect(lamp.light).toEqual({ lumens: 2000, kelvin: 2200 });
  await page.getByTestId('undo').click();
  expect((await state(page)).level.objects.find((o: any) => o.id === lampId).light).toEqual({ lumens: 2000 });

  // 牆：個別牆高＋踢腳板
  const wallId = (await state(page)).level.walls[0].id;
  await page.evaluate((id) => (window as any).__editor.store.getState().select([id]), wallId);
  await expect(page.getByTestId('inspector-wall')).toBeVisible();
  await page.getByTestId('wall-baseboard-input').fill('100');
  await page.getByTestId('wall-baseboard-input').press('Enter');
  expect((await state(page)).level.walls[0].baseboard).toBe(100);
  await page.waitForTimeout(800);
  await page.getByTestId('viewer3d').screenshot({ path: 'e2e/results/properties-night.png' });
});

test('上傳 GLB 模型 → 資產庫「我的上傳」→ 放入場景；物件清單可隱藏', async ({ page }) => {
  test.setTimeout(180_000);
  await newSampleProject(page);
  await page.getByTestId('upload-open').click();
  await page.getByTestId('upload-file').setInputFiles('e2e/fixtures/test-box.glb');
  await expect(page.getByTestId('upload-name')).toHaveValue('test-box');
  await page.getByTestId('upload-name').fill('測試櫃');
  await expect(page.getByTestId('upload-save')).toBeDisabled();
  await page.getByTestId('upload-license').check();
  await page.getByTestId('upload-save').click();
  await expect(page.getByTestId('upload-dialog')).toBeHidden();

  await page.getByTestId('assets-mine').click();
  const card = page.locator('[data-testid^="asset-ua_"]');
  await expect(card).toHaveCount(1);
  const id = (await card.getAttribute('data-testid'))!.slice('asset-'.length);

  // 用 2D 放置工具放入（點選資產 → 點畫布）
  const before = (await level(page)).objects;
  await card.click();
  const box = await page.getByTestId('plan2d').boundingBox();
  await page.mouse.click(box!.x + box!.width * 0.35, box!.y + box!.height * 0.45);
  expect((await level(page)).objects).toBe(before + 1);
  const placed = (await state(page)).level.objects.find((o: any) => o.catalogId === id);
  expect(placed).toBeTruthy();

  await page.getByTestId('view-3d').click();
  await ready(page);
  const ids = await page.evaluate(() =>
    Object.values((window as any).__editor.viewer3d().gbuffer({ width: 256, height: 192 }).idMap).map(
      (x: any) => x.id,
    ),
  );
  expect(ids).toContain(placed.id);

  // 物件清單：眼睛按鈕隱藏
  await page.getByTestId('tab-outline').click();
  await page
    .getByTestId('outline')
    .getByRole('button', { name: /隱藏 測試櫃|Hide 測試櫃|隱藏 test/ })
    .click();
  expect((await state(page)).level.objects.find((o: any) => o.id === placed.id).appearance).toEqual({
    hidden: true,
  });
});
