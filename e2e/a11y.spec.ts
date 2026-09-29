import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { newSampleProject } from './helpers';

/** P2 Gate：axe 無 serious/critical 問題（畫布本身不在 axe 範圍，等價操作見物件清單/屬性面板） */
const serious = (r: Awaited<ReturnType<AxeBuilder['analyze']>>) =>
  r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`);

test('專案列表頁', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('new-project')).toBeVisible();
  expect(serious(await new AxeBuilder({ page }).analyze())).toEqual([]);
});

test('編輯器（2D，選取牆）', async ({ page }) => {
  await newSampleProject(page);
  await page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    s.select([s.scene.levels[0].walls[0].id]);
  });
  await expect(page.getByTestId('inspector-wall')).toBeVisible();
  expect(serious(await new AxeBuilder({ page }).exclude('canvas').analyze())).toEqual([]);
});

test('鍵盤等價路徑：從物件清單選取家具並用屬性面板修改', async ({ page }) => {
  await newSampleProject(page);
  await page.getByTestId('tab-outline').click();
  const outline = page.getByTestId('outline');
  const first = outline
    .getByRole('button')
    .filter({ hasText: /沙發|sofa/i })
    .first();
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('inspector-object')).toBeVisible();
  await page.getByTestId('obj-rot').fill('90');
  await page.getByTestId('obj-rot').press('Enter');
  const rot = await page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    return s.scene.levels[0].objects.find((o: any) => o.id === s.selection[0]).rotationY;
  });
  expect(rot).toBeCloseTo(Math.PI / 2, 5);
});
