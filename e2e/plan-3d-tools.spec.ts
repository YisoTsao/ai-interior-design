import { expect, test, type Page } from '@playwright/test';
import { clickWorld, newBlankProject, newSampleProject, worldToClient } from './helpers';

const lv = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    return s.scene.levels.find((l: any) => l.id === s.levelId);
  });
const ready3d = (page: Page) =>
  page.waitForFunction(() => (window as any).__editor.viewer3d()?.info().calls > 0, null, {
    timeout: 60_000,
  });

/** FE-PLAN-12／13：顯示樣式與格線吸附設定 */
test('平面圖：彩色樣式、格線 500 mm 吸附（關閉端點／牆線／角度）', async ({ page }) => {
  await newBlankProject(page);
  await page.getByTestId('plan-style-color').click();
  await expect(page.getByTestId('plan2d')).toHaveCSS('background-color', 'rgb(251, 248, 243)');
  await page.getByTestId('plan-grid').fill('500');
  await page.getByTestId('plan-grid').press('Enter');
  for (const k of ['endpoint', 'wall', 'angle']) await page.getByTestId(`snap-${k}`).uncheck();
  await page.getByTestId('tool-wall').click();
  await clickWorld(page, [1234, 1180]);
  await clickWorld(page, [4321, 1310]);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await lv(page)).walls.length).toBe(1);
  const w = (await lv(page)).walls[0];
  expect(w.a).toEqual([1000, 1000]);
  expect(w.b).toEqual([4500, 1500]);
  await page.getByTestId('plan-style-blueprint').click();
});

/** FE-PLAN-11：上傳底圖、以測量校正比例 */
test('描圖底圖：上傳、量測後校正寬度', async ({ page }) => {
  await newBlankProject(page);
  await page.getByTestId('underlay-file').setInputFiles('fixtures/plans/synth-filled.png');
  const width = page.getByTestId('underlay-width');
  await expect(width).toHaveValue(/10000|10,000/);
  await page.keyboard.press('m');
  await clickWorld(page, [0, 0]);
  await clickWorld(page, [2000, 0]);
  await page.keyboard.press('Enter');
  page.once('dialog', (d) => void d.accept('4000'));
  await page.getByTestId('underlay-calibrate').click();
  await expect(width).toHaveValue(/20000|20,000/);
});

/** FE-PLAN-15：右鍵在牆上插入節點、再合併 */
test('牆：插入節點分割與合併', async ({ page }) => {
  await newSampleProject(page);
  const before = (await lv(page)).walls.length;
  const south = (await lv(page)).walls.find(
    (w: any) => w.a[1] === 0 && w.b[1] === 0 && Math.min(w.a[0], w.b[0]) === 0,
  );
  const [x, y] = await worldToClient(page, [3000, 0]);
  await page.evaluate((id) => (window as any).__editor.store.getState().select([id]), south.id);
  await page.mouse.click(x, y, { button: 'right' });
  await page.getByTestId('ctx-splitWall').click();
  const after = await lv(page);
  expect(after.walls.length).toBe(before + 1);
  const parts = after.walls.filter(
    (w: any) => w.a[1] === 0 && w.b[1] === 0 && [w.a[0], w.b[0]].some((x: number) => Math.abs(x - 3000) < 60),
  );
  expect(parts.length).toBe(2);
  await page.evaluate(
    (ids) => (window as any).__editor.store.getState().select(ids),
    parts.map((p: any) => p.id),
  );
  await page.mouse.click(x + 40, y, { button: 'right' });
  await page.evaluate(
    (ids) => (window as any).__editor.store.getState().select(ids),
    parts.map((p: any) => p.id),
  );
  await page.getByTestId('ctx-mergeWalls').click();
  expect((await lv(page)).walls.length).toBe(before);
});

/** FE-PROP-03／FE-V3D-04：複製貼上樣式；檯燈拖到書桌上自動抬高 */
test('樣式複製貼上；2D 拖曳檯燈到桌面自動疊放', async ({ page }) => {
  await newSampleProject(page);
  const l0 = await lv(page);
  const chairs = l0.objects.filter((o: any) => o.catalogId === 'chair_dining_a');
  await page.evaluate(
    ([a]) => {
      const s = (window as any).__editor.store.getState();
      s.select([a]);
    },
    [chairs[0].id],
  );
  // 先把第一張椅子換成絨布
  await page.evaluate((id) => {
    const s = (window as any).__editor.store.getState();
    const lvl = s.scene.levels.find((l: any) => l.id === s.levelId);
    const o = lvl.objects.find((x: any) => x.id === id);
    s.exec({
      id: 't',
      label: 'command.updateObject',
      do: (d: any) => {
        const t = d.levels.find((l: any) => l.id === s.levelId).objects.find((x: any) => x.id === o.id);
        t.materialOverrides = { body: 'fabric_emerald_velvet' };
        t.appearance = { color: '#335544' };
      },
    });
  }, chairs[0].id);
  await page.locator('#canvas').click({ position: { x: 5, y: 5 } });
  await page.evaluate((id) => (window as any).__editor.store.getState().select([id]), chairs[0].id);
  await page.keyboard.press('Control+Shift+c');
  await page.evaluate(
    (ids) => (window as any).__editor.store.getState().select(ids),
    chairs.slice(1).map((c: any) => c.id),
  );
  await page.keyboard.press('Control+Shift+v');
  const l1 = await lv(page);
  for (const c of chairs.slice(1)) {
    const o = l1.objects.find((x: any) => x.id === c.id);
    expect(o.appearance?.color).toBe('#335544');
  }
  // 疊放：床頭櫃上的檯燈拖到書桌（desk_office_1400 在 6300,7900）
  const lamp = l1.objects.find((o: any) => o.catalogId === 'lamp_table_a');
  const desk = l1.objects.find((o: any) => o.catalogId === 'desk_office_1400');
  await page.evaluate(() => (window as any).__editor.store.getState().select([]));
  const [sx, sy] = await worldToClient(page, [lamp.position[0], lamp.position[2]]);
  const [tx, ty] = await worldToClient(page, [desk.position[0] - 300, desk.position[2] - 100]);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 8 });
  await page.mouse.up();
  const moved = (await lv(page)).objects.find((o: any) => o.id === lamp.id);
  expect(moved.position[1]).toBe(750);
});

/** FE-V3D-08／10／11／13、FE-LVL-03：3D 顯示模式、碰撞紅框、測量、焦距 */
test('3D：白模、X 光、碰撞紅框、測量兩點、50 mm 焦距', async ({ page }) => {
  test.setTimeout(120_000);
  await newSampleProject(page);
  // 做一個碰撞：兩張沙發重疊
  await page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    s.exec({
      id: 'c',
      label: 'command.addObject',
      do: (d: any) => {
        d.levels
          .find((l: any) => l.id === s.levelId)
          .objects.push({
            id: 'obj_clash',
            catalogId: 'sofa_3seat_a',
            position: [2700, 0, 6900],
            rotationY: 0,
          });
      },
    });
  });
  await page.getByTestId('view-3d').click();
  await ready3d(page);
  const kinds = await page.evaluate(() => (window as any).__editor.viewer3d().kinds());
  expect(kinds.collision).toBeGreaterThanOrEqual(2);
  await page.getByTestId('view-display').selectOption('clay');
  await expect
    .poll(() => page.evaluate(() => (window as any).__editor.viewer3d().override()))
    .toBe('MeshStandardMaterial');
  await page.getByTestId('view-display').selectOption('wire');
  await expect
    .poll(() => page.evaluate(() => (window as any).__editor.viewer3d().override()))
    .toBe('MeshBasicMaterial');
  await page.getByTestId('view-display').selectOption('real');
  await expect.poll(() => page.evaluate(() => (window as any).__editor.viewer3d().override())).toBeNull();
  await page.getByTestId('view-lens').selectOption('50');
  expect(await page.evaluate(() => (window as any).__editor.viewer3d().lens())).toBe(50);
  await page.getByTestId('hud-measure').click();
  const box = (await page.getByTestId('viewer3d').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.6);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.65);
  const label = page.getByTestId('measure3d-label');
  await expect(label).toBeVisible();
  expect(Number(await label.getAttribute('data-mm'))).toBeGreaterThan(100);
});
