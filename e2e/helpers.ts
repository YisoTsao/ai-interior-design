import { expect, type Page } from '@playwright/test';

type Vec2 = [number, number];

/** 經由 window.__editor 取得畫布座標（03 §9：E2E 以測試鉤子輔助畫布操作） */
export async function worldToClient(page: Page, p: Vec2): Promise<Vec2> {
  return page.evaluate((pt) => (window as any).__editor.plan2d().worldToClient(pt), p);
}

export async function level(page: Page) {
  return page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    const l = s.scene.levels.find((x: any) => x.id === s.levelId);
    return {
      walls: l.walls.length,
      openings: l.openings.length,
      objects: l.objects.length,
      rooms: l.rooms.length,
      scene: s.scene,
    };
  });
}

export async function newBlankProject(page: Page) {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('wizard-create').click();
  await page.waitForFunction(
    () => (window as any).__editor && document.querySelector('[data-testid=plan2d]'),
    null,
    { timeout: 30_000 },
  );
}

export async function newSampleProject(page: Page) {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('wizard-tab-template').click();
  await page.getByTestId('tpl-sample').click();
  await page.getByTestId('wizard-create').click();
  await page.waitForFunction(
    () => (window as any).__editor && document.querySelector('[data-testid=plan2d]'),
    null,
    { timeout: 30_000 },
  );
}

/** 在 2D 畫布上依世界座標點擊 */
export async function clickWorld(page: Page, p: Vec2, opts: { dbl?: boolean } = {}) {
  const [x, y] = await worldToClient(page, p);
  if (opts.dbl) await page.mouse.dblclick(x, y);
  else await page.mouse.click(x, y);
}

export async function flushSave(page: Page) {
  await page.evaluate(() => (window as any).__editor.flush());
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
}
