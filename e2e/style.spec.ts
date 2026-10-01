import { expect, test, type Page } from '@playwright/test';
import { level, newSampleProject } from './helpers';

const ready = (page: Page) =>
  page.waitForFunction(() => (window as any).__editor.viewer3d()?.info().calls > 0, null, {
    timeout: 60_000,
  });

/**
 * 等角剖面模型風格（isometric-dollhouse-style）：
 * 剖面牆、視角預設、自動軟裝、切回簡易模式。截圖存 e2e/results/ 供與參考圖並排比對。
 */
test('剖面模型：剖面牆隨視角改變、可切回簡易模式', async ({ page }) => {
  test.setTimeout(180_000);
  await newSampleProject(page);
  // 日光模式的剖面規則（夜間氛圍另見 lighting.spec）
  await page.evaluate(() => {
    localStorage.setItem('viewStyle', 'dollhouse');
    localStorage.setItem('lighting', 'day');
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).__editor);
  await page.getByTestId('view-3d').click();
  await ready(page);
  await expect(page.getByTestId('viewer3d')).toHaveAttribute('data-style', 'dollhouse');

  expect(await page.evaluate(() => (window as any).__editor.viewer3d().style())).toBe('dollhouse');

  // 預設東南等角：仰角 35°、fov 22
  const cam = await page.evaluate(() => (window as any).__editor.viewer3d().currentCamera());
  expect(cam.fovDeg).toBe(22);
  const [dx, dy, dz] = [0, 1, 2].map((i) => cam.position[i] - cam.target[i]);
  expect((Math.atan2(dy!, Math.hypot(dx!, dz!)) * 180) / Math.PI).toBeCloseTo(35, 0);

  // 剖面牆（日／夜同一規則）：相機在 +X+Z 側 → 只有近側 z=8400 與 x=9000 的外牆降低；
  // 內牆與遠側 z=0、x=0 外牆保持全高
  const cutSE: string[] = await page.evaluate(() => (window as any).__editor.viewer3d().cutWalls());
  const walls = (await level(page)).scene.levels[0].walls as { id: string; a: number[]; b: number[] }[];
  const find = (f: (w: { a: number[]; b: number[] }) => boolean) => walls.find(f)!.id;
  const farZ = find((w) => w.a[1] === 0 && w.b[1] === 0);
  const farX = find((w) => w.a[0] === 0 && w.b[0] === 0);
  expect(cutSE).not.toContain(farZ);
  expect(cutSE).not.toContain(farX);
  const near = walls
    .filter((w) => (w.a[1] === 8400 && w.b[1] === 8400) || (w.a[0] === 9000 && w.b[0] === 9000))
    .map((w) => w.id);
  expect([...cutSE].sort()).toEqual([...near].sort());

  await page.waitForTimeout(800);
  await page.getByTestId('viewer3d').screenshot({ path: 'e2e/results/style-dollhouse-se.png' });

  // 視角預設：西北（相機在 −X−Z 側）→ z=0、x=0 外牆改為剖面
  await page.getByTestId('view-preset').selectOption('iso-nw');
  await expect
    .poll(() => page.evaluate(() => (window as any).__editor.viewer3d().cutWalls()))
    .toEqual(expect.arrayContaining([farZ, farX]));
  await page.waitForTimeout(800);
  await page.getByTestId('viewer3d').screenshot({ path: 'e2e/results/style-dollhouse-nw.png' });

  // 自動點綴軟裝：單一 undo 步驟
  const before = (await level(page)).objects;
  await page.getByTestId('auto-decorate').click();
  const after = (await level(page)).objects;
  expect(after).toBeGreaterThan(before);
  await page.getByTestId('view-preset').selectOption('iso-se');
  await page.waitForTimeout(800);
  await page.getByTestId('viewer3d').screenshot({ path: 'e2e/results/style-dollhouse-decor.png' });
  await page.getByTestId('undo').click();
  expect((await level(page)).objects).toBe(before);

  // 切回簡易模式：P2 原本的相機與全高牆
  await page.getByTestId('view-style').selectOption('simple');
  await expect(page.getByTestId('viewer3d')).toHaveAttribute('data-style', 'simple');
  await ready(page);
  const simple = await page.evaluate(() => {
    const v = (window as any).__editor.viewer3d();
    return { style: v.style(), cut: v.cutWalls(), fov: v.currentCamera().fovDeg };
  });
  expect(simple).toEqual({ style: 'simple', cut: [], fov: 50 });
  await page.waitForTimeout(500);
  await page.getByTestId('viewer3d').screenshot({ path: 'e2e/results/style-simple.png' });
});
