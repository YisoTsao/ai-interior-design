import { expect, test } from '@playwright/test';
import { clickWorld, flushSave, level, newBlankProject, worldToClient } from './helpers';

/**
 * P2 Gate E2E：建牆 → 放門 → 放家具 → Undo/Redo → 存檔 → 重載一致。
 * 全部以真實滑鼠/鍵盤操作畫布（座標由測試鉤子換算）。
 */
test('建牆→放門→放家具→Undo/Redo→存檔→重載一致', async ({ page }) => {
  await newBlankProject(page);

  // 1) 畫牆工具：連續點 4 點，點回起點封閉 → 4 面牆 + 1 房間
  await page.getByTestId('tool-wall').click();
  for (const p of [
    [0, 0],
    [4000, 0],
    [4000, 3000],
    [0, 3000],
    [0, 0],
  ] as [number, number][])
    await clickWorld(page, p);
  await expect.poll(async () => (await level(page)).walls).toBe(4);
  expect((await level(page)).rooms).toBe(1);

  // 2) 門工具：點南牆中段 → 1 個開口
  await page.keyboard.press('d');
  await clickWorld(page, [2000, 0]);
  await expect.poll(async () => (await level(page)).openings).toBe(1);

  // 3) 從資產庫放沙發
  await page.getByTestId('asset-search').fill('三人沙發');
  await page.getByTestId('asset-sofa_3seat_a').click();
  await clickWorld(page, [2000, 1500]);
  await expect.poll(async () => (await level(page)).objects).toBe(1);
  await expect(page.getByTestId('inspector-object')).toBeVisible();

  // 4) 屬性面板數值輸入：X = 2500（Enter 提交為一個 Command）
  await page.getByTestId('obj-x').fill('2500');
  await page.getByTestId('obj-x').press('Enter');
  await expect.poll(async () => (await level(page)).scene.levels[0].objects[0].position[0]).toBe(2500);

  // 5) Undo/Redo（鍵盤）
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page
    .locator('body')
    .click({ position: { x: 5, y: 5 }, force: true })
    .catch(() => {});
  await page
    .getByTestId('plan2d')
    .focus()
    .catch(() => {});
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(async () => (await level(page)).scene.levels[0].objects[0]?.position[0]).toBe(2000);
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(async () => (await level(page)).objects).toBe(0);
  await page.keyboard.press(`${mod}+Shift+z`);
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect.poll(async () => (await level(page)).scene.levels[0].objects[0]?.position[0]).toBe(2500);

  // 6) 存檔 → 重載 → 場景一致
  await flushSave(page);
  const before = (await level(page)).scene;
  await page.reload();
  await page.waitForFunction(
    () => (window as any).__editor && document.querySelector('[data-testid=plan2d]'),
  );
  expect((await level(page)).scene).toEqual(before);
});

test('拖曳牆角連動相鄰牆；標註雙擊輸入長度', async ({ page }) => {
  await newBlankProject(page);
  await page.getByTestId('tool-rect').click();
  const [x0, y0] = await worldToClient(page, [0, 0]);
  const [x1, y1] = await worldToClient(page, [4000, 3000]);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await level(page)).walls).toBe(4);

  // 選取南牆，拖曳 (4000,0) 端點到 (5000,0)
  await page.keyboard.press('v');
  await clickWorld(page, [2000, 0]);
  const [hx, hy] = await worldToClient(page, [4000, 0]);
  const [tx, ty] = await worldToClient(page, [5000, 0]);
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 8 });
  await page.mouse.up();
  const walls = (await level(page)).scene.levels[0].walls as { a: number[]; b: number[] }[];
  const has = (p: number[]) =>
    walls.filter((w) => (w.a[0] === p[0] && w.a[1] === p[1]) || (w.b[0] === p[0] && w.b[1] === p[1])).length;
  expect(has([5000, 0])).toBe(2); // 南牆與東牆一起移動
  expect(has([4000, 0])).toBe(0);

  // 屬性面板修改牆長（保持相鄰牆角度）
  await page.getByTestId('wall-length').fill('600');
  await page.getByTestId('wall-length').press('Enter');
  await expect
    .poll(async () => {
      const ws = (await level(page)).scene.levels[0].walls as { a: number[]; b: number[] }[];
      return ws.some((w) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) === 6000);
    })
    .toBe(true);
});

test('3D 檢視可載入並與 2D 選取同步；切換專案後資源釋放', async ({ page }) => {
  await newBlankProject(page);
  await page.getByTestId('tool-rect').click();
  const [x0, y0] = await worldToClient(page, [0, 0]);
  const [x1, y1] = await worldToClient(page, [4000, 3000]);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 6 });
  await page.mouse.up();
  await page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    s.select([s.scene.levels[0].walls[0].id]);
  });
  await page.getByTestId('view-3d').click();
  await page.waitForFunction(() => (window as any).__editor.viewer3d()?.info().calls > 0, null, {
    timeout: 60_000,
  });
  // 選取狀態在 2D/3D 共用同一個 store（S2.8）
  expect(await page.evaluate(() => (window as any).__editor.store.getState().selection.length)).toBe(1);
  await expect(page.getByTestId('inspector-wall')).toBeVisible();
  const tracked = await page.evaluate(() => (window as any).__editor.viewer3d().info().trackedResources);
  expect(tracked).toBeGreaterThan(0);
  // 回 2D：viewer 卸載，API 解除註冊（dispose 走 ResourceScope.disposeAll）
  await page.getByTestId('view-2d').click();
  await expect.poll(() => page.evaluate(() => (window as any).__editor.viewer3d())).toBeNull();
});
