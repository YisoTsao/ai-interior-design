import { expect, test, type Page } from '@playwright/test';
import { newSampleProject } from './helpers';

const ready = (page: Page) =>
  page.waitForFunction(() => (window as any).__editor.viewer3d()?.info().calls > 0, null, {
    timeout: 60_000,
  });

async function open3d(page: Page, lighting: 'night' | 'day') {
  await page.evaluate((l) => {
    localStorage.setItem('viewStyle', 'dollhouse');
    localStorage.setItem('lighting', l);
  }, lighting);
  await page.reload();
  await page.waitForFunction(() => (window as any).__editor);
  await page.getByTestId('view-3d').click();
  await ready(page);
  await expect(page.getByTestId('viewer3d')).toHaveAttribute('data-lighting', lighting);
}

/**
 * 夜間氛圍（images1）：燈具是實際光源（固定池、陰影預算）、窗戶是面光源；
 * 日光模式沒有燈具光源；G-buffer 不受光線模式影響（AI 渲染輸入一致）。
 */
test('夜間氛圍：燈具光源、窗光、與日光模式切換；G-buffer 與光線模式無關', async ({ page }) => {
  test.setTimeout(180_000);
  await newSampleProject(page);
  await open3d(page, 'night');
  const stats = await page.evaluate(() => (window as any).__editor.viewer3d().lights());
  expect(stats.total).toBeGreaterThanOrEqual(12);
  expect(stats.point).toBeGreaterThan(0);
  expect(stats.spot).toBeGreaterThan(0);
  expect(stats.area).toBeGreaterThan(0);
  expect(stats.shadows).toBeLessThanOrEqual(5);
  const gNight = await page.evaluate(() => {
    const v = (window as any).__editor.viewer3d();
    v.viewPreset('iso-se');
    const g = v.gbuffer({ width: 256, height: 192, clay: true });
    return {
      color: Array.from(g.color.data as Uint8Array).filter((_, i) => i % 97 === 0),
      ids: Object.keys(g.idMap).length,
    };
  });
  await page.waitForTimeout(1200);
  await page.getByTestId('viewer3d').screenshot({ path: 'e2e/results/lighting-night-se.png' });
  await page.evaluate(() => (window as any).__editor.viewer3d().viewPreset('iso-nw'));
  await page.waitForTimeout(1200);
  await page.getByTestId('viewer3d').screenshot({ path: 'e2e/results/lighting-night-nw.png' });

  await page.getByTestId('view-lighting').selectOption('day');
  await expect(page.getByTestId('viewer3d')).toHaveAttribute('data-lighting', 'day');
  await ready(page);
  expect(await page.evaluate(() => (window as any).__editor.viewer3d().lights().total)).toBe(0);
  const gDay = await page.evaluate(() => {
    const v = (window as any).__editor.viewer3d();
    v.viewPreset('iso-se');
    const g = v.gbuffer({ width: 256, height: 192, clay: true });
    return {
      color: Array.from(g.color.data as Uint8Array).filter((_, i) => i % 97 === 0),
      ids: Object.keys(g.idMap).length,
    };
  });
  await page.waitForTimeout(800);
  await page.getByTestId('viewer3d').screenshot({ path: 'e2e/results/lighting-day-se.png' });
  // 兩種模式可見的幾何不同（夜間內牆全高、底座不同），idMap 數量不必相同
  expect(gDay.ids).toBeGreaterThan(10);
  expect(gNight.ids).toBeGreaterThan(10);
  // 夜間與日光的牆高不同（夜間內牆全高）→ clay 會有差異；但光線不進 G-buffer：平均亮度相近
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  expect(Math.abs(mean(gDay.color) - mean(gNight.color))).toBeLessThan(25);
});
