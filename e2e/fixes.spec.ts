import { expect, test, type Page } from '@playwright/test';
import { level, newSampleProject } from './helpers';

/**
 * 回報問題的回歸測試：
 * 1. 日光模式牆高與夜間一致（內牆全高，只有近側外牆降為牆腳）
 * 2. 售屋 DM 風格平面圖（尺寸線、家具外框、填色）→ 3D：外框正確、夜間不是全黑
 * 3. 多格式 3D 模型上傳（OBJ＋MTL＋貼圖、STL、SketchUp 提示）
 * 4. 3D 拖曳：資產拖進視埠時即時顯示放置預覽；拖曳已放置的家具即時移動
 */
const ready = (page: Page) =>
  page.waitForFunction(() => (window as any).__editor?.viewer3d()?.info().calls > 0, null, {
    timeout: 60_000,
  });
const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as any).__editor.viewer3d()[f as string](...(a as unknown[])),
    [fn, args],
  ) as Promise<T>;

test('日光與夜間的剖面牆一致（內牆不被剖低）', async ({ page }) => {
  await newSampleProject(page);
  await page.getByTestId('view-3d').click();
  await ready(page);
  await page.getByTestId('view-lighting').selectOption('night');
  await page.waitForTimeout(500);
  const night = (await api<string[]>(page, 'cutWalls')).sort();
  await page.getByTestId('view-lighting').selectOption('day');
  await page.waitForTimeout(500);
  const day = (await api<string[]>(page, 'cutWalls')).sort();
  expect(day).toEqual(night);
  const { scene } = await level(page);
  const walls = scene.levels[0].walls.length;
  expect(day.length).toBeGreaterThan(0);
  expect(day.length).toBeLessThan(walls);
  await page.getByTestId('viewer3d').screenshot({ path: 'e2e/results/fixes-day-walls.png' });
});

test('售屋 DM 風格平面圖 → 3D：尺寸線與家具不是牆，夜間有補光', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByTestId('import-plan').click();
  await page.getByTestId('import-file').setInputFiles('fixtures/plans/dm-style.png');
  await page.waitForURL(/\/import\//);
  await expect(page.getByTestId('plan-canvas')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('calib-start').click();
  const box = (await page.getByTestId('plan-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.3);
  await page.getByTestId('calib-length').fill('5000');
  await page.getByTestId('calib-apply').click();
  await page.getByTestId('build-3d').click();
  await page.waitForURL(/\/p\/.+\/edit\?view=3d/);
  await ready(page);
  const l = (await level(page)).scene.levels[0];
  // 圖面：外框＋4 道隔間＝8 道牆，厚度一致（沒有 2–5 px 的細線牆）
  expect(l.walls.length).toBe(8);
  const th = l.walls.map((w: any) => w.thickness);
  expect(Math.min(...th) / Math.max(...th)).toBeGreaterThan(0.8);
  expect(l.rooms.length).toBe(5);
  await page.getByTestId('view-lighting').selectOption('night');
  await page.waitForTimeout(800);
  const lights = await api<{ total: number }>(page, 'lights');
  expect(lights.total).toBeGreaterThanOrEqual(5); // 每間房補一盞
  expect((await api<string[]>(page, 'cutWalls')).length).toBeGreaterThan(0);
  await page.getByTestId('viewer3d').screenshot({ path: 'e2e/results/fixes-dm-night.png' });
});

test('上傳多格式 3D 模型：OBJ＋MTL＋貼圖、STL 轉正、SketchUp 提示、拖放到畫布', async ({ page }) => {
  test.setTimeout(120_000);
  await newSampleProject(page);
  const M = 'e2e/fixtures/models';
  await page.getByTestId('upload-open').click();
  await page.getByTestId('upload-file').setInputFiles([`${M}/table.obj`, `${M}/table.mtl`, `${M}/wood.png`]);
  await expect(page.getByTestId('upload-format')).toHaveText('OBJ → GLB');
  await expect(page.getByTestId('upload-name')).toHaveValue('table');
  await expect(page.locator('[data-testid=upload-dialog] .text-warn')).toHaveCount(0);
  await page.getByTestId('upload-license').check();
  await page.getByTestId('upload-save').click();
  await expect(page.getByTestId('upload-dialog')).toBeHidden();

  await page.getByTestId('upload-open').click();
  await page.getByTestId('upload-file').setInputFiles(`${M}/cabinet.stl`);
  await expect(page.getByTestId('upload-format')).toHaveText('STL → GLB');
  await expect(page.getByTestId('upload-zup')).toBeChecked();
  await page.getByTestId('upload-license').check();
  await page.getByTestId('upload-save').click();
  await expect(page.getByTestId('upload-dialog')).toBeHidden();

  await page.getByTestId('upload-open').click();
  await page
    .getByTestId('upload-file')
    .setInputFiles({ name: 'house.skp', mimeType: 'application/octet-stream', buffer: Buffer.from('skp') });
  await expect(page.locator('[data-testid=upload-dialog] [role=alert]')).toContainText('SketchUp');
  await page.keyboard.press('Escape');

  // 模型檔拖到畫布 → 開啟上傳對話框
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(['solid t\nendsolid t\n'], 'part.stl'));
    return d;
  });
  await page.dispatchEvent('#canvas', 'drop', { dataTransfer: dt });
  await expect(page.getByTestId('upload-dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByTestId('assets-mine').click();
  const cards = page.locator('[data-testid^="asset-ua_"]');
  await expect(cards).toHaveCount(2);
  const dims = await cards.allTextContents();
  expect(dims.join(' ')).toContain('1200×600×750');
  expect(dims.join(' ')).toContain('400×300×900');
});

test('3D 拖曳：資產拖進視埠即時預覽、已放置家具拖曳中即時移動', async ({ page }) => {
  test.setTimeout(120_000);
  await newSampleProject(page);
  await page.getByTestId('view-3d').click();
  await ready(page);

  // 資產庫 → 3D：拖曳途中有幽靈物件，放下後新增一件
  const card = page.locator('[draggable=true][data-testid^="asset-"]').first();
  const cb = (await card.boundingBox())!;
  const vb = (await page.getByTestId('viewer3d').boundingBox())!;
  const to = { x: vb.x + vb.width * 0.5, y: vb.y + vb.height * 0.6 };
  const before = (await level(page)).objects;
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++)
    await page.mouse.move(cb.x + ((to.x - cb.x) * i) / 12, cb.y + ((to.y - cb.y) * i) / 12);
  await expect.poll(() => api<number>(page, 'ghosts')).toBe(1);
  await page.getByTestId('viewer3d').screenshot({ path: 'e2e/results/fixes-drag-ghost.png' });
  await page.mouse.up();
  await expect.poll(async () => (await level(page)).objects).toBe(before + 1);
  expect(await api<number>(page, 'ghosts')).toBe(0);

  // 已放置的家具：拖曳中 Scene 不變但畫面跟著移動；放開後一步 undo
  const objs = (await level(page)).scene.levels[0].objects;
  const o = objs.find((x: any) => x.catalogId.startsWith('bed'))!;
  const c = (await api<[number, number]>(page, 'worldToClient', [o.position[0], 250, o.position[2]]))!;
  const shot1 = await page.getByTestId('viewer3d').screenshot();
  await page.mouse.move(c[0], c[1]);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(c[0] - i * 8, c[1] + i * 4);
  await page.waitForTimeout(300);
  const mid = (await level(page)).scene.levels[0].objects.find((x: any) => x.id === o.id);
  expect(mid.position).toEqual(o.position);
  const shot2 = await page.getByTestId('viewer3d').screenshot();
  expect(shot2.equals(shot1)).toBe(false);
  await page.mouse.up();
  const after = (await level(page)).scene.levels[0].objects.find((x: any) => x.id === o.id);
  expect(after.position).not.toEqual(o.position);
  await page.keyboard.press('ControlOrMeta+z');
  const undone = (await level(page)).scene.levels[0].objects.find((x: any) => x.id === o.id);
  expect(undone.position).toEqual(o.position);
});
