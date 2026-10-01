import { expect, test, type Page } from '@playwright/test';
import { clickWorld, level, newBlankProject, newSampleProject } from './helpers';

/**
 * 前台 11 規格 P1 收尾（第七批）：
 * PLAN-02 弧牆凸度、PLAN-10 角度／箭頭／編號標記／自動外部尺寸、PLAN-12 家具俯視縮圖、PLAN-15 牆定位線、
 * AST-02 篩選、FIN-02 背景牆模板與壁紙、V3D-10 景深與構圖、UX-07 浮動面板、AI-01 照片換風格。
 */
const st = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    return s.scene.levels.find((l: any) => l.id === s.levelId);
  });
const setTool = (page: Page, tool: string) =>
  page.evaluate((t) => (window as any).__editor.store.getState().setTool(t), tool);
/** 屬性面板的分節：沒開才點開（有些分節預設展開） */
async function openSection(page: Page, testId: string) {
  const d = page.getByTestId(testId);
  if (!(await d.evaluate((el) => (el as HTMLDetailsElement).open))) await d.locator('summary').click();
}
const ready3d = (page: Page) =>
  page.waitForFunction(() => (window as any).__editor?.viewer3d()?.info().calls > 0, null, {
    timeout: 60_000,
  });

test('PLAN-10：角度、箭頭、編號標記（標記清單）、自動外部尺寸與家具俯視縮圖', async ({ page }) => {
  await newSampleProject(page);
  await setTool(page, 'angle');
  await clickWorld(page, [0, 0]);
  await clickWorld(page, [3000, 0]);
  await clickWorld(page, [0, 3000]);
  await setTool(page, 'arrow');
  await clickWorld(page, [1000, 1000]);
  await clickWorld(page, [2000, 2000]);
  await setTool(page, 'tag');
  await clickWorld(page, [2500, 6000]);
  await page.getByTestId('prompt-dialog').locator('input, textarea').first().fill('電視櫃');
  await page.getByTestId('prompt-ok').click();
  await setTool(page, 'tag');
  await clickWorld(page, [6500, 2000]);
  await page.getByTestId('prompt-ok').click();
  const anns = ((await st(page)).annotations ?? []) as any[];
  expect(anns.map((a) => a.type).sort()).toEqual(['angle', 'arrow', 'tag', 'tag']);
  expect(anns.filter((a) => a.type === 'tag').map((a) => a.data.number)).toEqual([1, 2]);
  // 屬性面板顯示角度
  await page.evaluate(
    (id) => (window as any).__editor.store.getState().select([id]),
    anns.find((a) => a.type === 'angle').id,
  );
  await expect(page.getByTestId('angle-value')).toContainText('90');
  // 標記清單（物件清單分頁）
  await page.getByRole('tab', { name: /物件清單|Outline/ }).click();
  await expect(page.getByTestId('outline')).toContainText('1. 電視櫃');
  // 自動外部尺寸＋俯視縮圖（顯示偏好）
  await page.evaluate(() => (window as any).__editor.store.getState().select([]));
  await openSection(page, 'section-plan');
  await page.getByTestId('plan-auto-dims').click();
  await page.getByTestId('plan-furniture-thumbs').click();
  await page.waitForTimeout(1500);
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('plan2d') ?? '{}'));
  expect(prefs).toMatchObject({ autoDims: true, furnitureThumbs: true });
  await page.getByTestId('plan2d').screenshot({ path: 'e2e/results/batch-a-plan.png' });
});

test('PLAN-02 弧牆拖曳凸度；PLAN-15 定位線（右側牆面＝室內淨尺寸）', async ({ page }) => {
  await newBlankProject(page);
  await setTool(page, 'arc');
  await clickWorld(page, [0, 0]);
  await clickWorld(page, [4000, 0]);
  await clickWorld(page, [2000, 1000]);
  let l = await st(page);
  const arcIds = l.walls.filter((w: any) => w.arcGroup).map((w: any) => w.id);
  expect(arcIds.length).toBeGreaterThan(3);
  const maxZ = (walls: any[]) =>
    Math.max(...walls.filter((w) => w.arcGroup).flatMap((w) => [w.a[1], w.b[1]]));
  const before = maxZ(l.walls);
  await setTool(page, 'select');
  await page.evaluate((id) => (window as any).__editor.store.getState().select([id]), arcIds[0]);
  const mid = await page.evaluate(() => {
    const ws = (window as any).__editor.store.getState().scene.levels[0].walls.filter((w: any) => w.arcGroup);
    return [2000, Math.max(...ws.flatMap((w: any) => [w.a[1], w.b[1]]))];
  });
  const a = await page.evaluate((p) => (window as any).__editor.plan2d().worldToClient(p), mid);
  const b = await page.evaluate(() => (window as any).__editor.plan2d().worldToClient([2000, 2000]));
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  await page.mouse.move(b[0], b[1], { steps: 6 });
  await page.mouse.up();
  l = await st(page);
  expect(maxZ(l.walls)).toBeGreaterThan(before + 600);
  await page.keyboard.press('ControlOrMeta+z');
  expect(maxZ((await st(page)).walls)).toBe(before);

  // 定位線：右側牆面，順時針畫 4000×3000 → 室內淨尺寸＝4000×3000
  await page.evaluate(() =>
    localStorage.setItem(
      'plan2d',
      JSON.stringify({ autoDims: false, furnitureThumbs: false, wallReference: 'right' }),
    ),
  );
  await newBlankProject(page);
  await setTool(page, 'wall');
  for (const p of [
    [0, 0],
    [4000, 0],
    [4000, 3000],
    [0, 3000],
    [0, 0],
  ] as [number, number][])
    await clickWorld(page, p);
  l = await st(page);
  const xs = l.walls.flatMap((w: any) => [w.a[0], w.b[0]]);
  const zs = l.walls.flatMap((w: any) => [w.a[1], w.b[1]]);
  const t = l.walls[0].thickness;
  expect(Math.max(...xs) - Math.min(...xs)).toBe(4000 + t);
  expect(Math.max(...zs) - Math.min(...zs)).toBe(3000 + t);
});

test('AST-02 篩選：尺寸範圍、材質、品牌、可訂製', async ({ page }) => {
  await newSampleProject(page);
  const count = async () =>
    Number(
      (await page
        .getByText(/\d+ 件/)
        .first()
        .textContent())!.match(/\d+/)![0],
    );
  const all = await count();
  await page.getByTestId('asset-filters').click();
  await page.getByTestId('filter-w-min').fill('150');
  await page.getByTestId('filter-w-max').fill('220');
  await expect.poll(count).toBeLessThan(all);
  const sized = await count();
  for (const txt of await page.locator('[data-testid^="asset-"][draggable=true]').allTextContents()) {
    const w = Number(/(\d{3,4})×\d+×\d+ mm/.exec(txt)?.[1]);
    expect(w).toBeGreaterThanOrEqual(1500);
    expect(w).toBeLessThanOrEqual(2200);
  }
  await page.getByTestId('filter-customizable').check();
  await expect.poll(count).toBeLessThanOrEqual(sized);
  await page.getByTestId('filter-material-wood').click();
  await page.getByTestId('filter-brand').selectOption('InteriorAI');
  await page.getByTestId('filter-clear').click();
  await expect.poll(count).toBe(all);
});

test('FIN-02 背景牆模板（單一 undo）與壁紙材質', async ({ page }) => {
  await newSampleProject(page);
  const w = (await st(page)).walls[0];
  await page.evaluate((id) => (window as any).__editor.store.getState().select([id]), w.id);
  await openSection(page, 'section-feature-wall');
  await page.getByTestId('feature-classicPanel').click();
  let cur = (await st(page)).walls[0];
  expect(cur.materialId).toBe('paint_ivory');
  expect(cur.wainscot).toMatchObject({ style: 'panel', sides: 'A' });
  expect(cur.crown).toMatchObject({ profile: 'cove' });
  await page.getByTestId('feature-side-B').click();
  await page.getByTestId('feature-wallpaperAccent').click();
  cur = (await st(page)).walls[0];
  expect(cur.materialIdB).toBe('wallpaper_damask_ivory');
  expect(cur.wainscot.sides).toBe('both');
  await page.keyboard.press('ControlOrMeta+z');
  expect((await st(page)).walls[0].materialIdB).toBe(w.materialIdB);
  await page.getByTestId('view-3d').click();
  await ready3d(page);
  await page.waitForTimeout(800);
  await page.getByTestId('viewer3d').screenshot({ path: 'e2e/results/batch-a-feature-wall.png' });
});

test('V3D-10 景深與構圖比例；V3D-12 互動降解析度開關；UX-07 浮動面板', async ({ page }) => {
  await newSampleProject(page);
  await page.getByTestId('view-3d').click();
  await ready3d(page);
  await page.getByTestId('camera-fx').click();
  await page.getByTestId('camera-dof').check();
  await page.getByTestId('camera-crop').selectOption('1:1');
  await expect(page.getByTestId('crop-frame')).toHaveAttribute('data-crop', '1:1');
  await page.waitForTimeout(800);
  await page.getByTestId('viewer3d').screenshot({ path: 'e2e/results/batch-a-dof.png' });
  await page.getByTestId('open-export').click();
  await expect(page.getByTestId('export-size')).toHaveText(/(\d+)×\1/);
  await page.keyboard.press('Escape');

  await page.getByTestId('float-toggle-right').click();
  await expect(page.getByTestId('float-right')).toBeVisible();
  const head = page.getByTestId('float-right').getByRole('toolbar');
  const hb = (await head.boundingBox())!;
  await page.mouse.move(hb.x + 40, hb.y + 10);
  await page.mouse.down();
  await page.mouse.move(hb.x - 160, hb.y + 90, { steps: 5 });
  await page.mouse.up();
  const pos = await page.evaluate(() => JSON.parse(localStorage.getItem('panelFloat') ?? '{}'));
  expect(pos.right).toBe(true);
  await page.getByTestId('dock-right').click();
  await expect(page.getByTestId('float-right')).toHaveCount(0);
});

test('AI-01 照片換風格：多張結果、局部重繪、存入圖庫', async ({ page }) => {
  test.setTimeout(120_000);
  await newSampleProject(page);
  await page.getByTestId('open-photo-style').click();
  await expect(page.getByTestId('photo-preview-note')).toBeVisible();
  await page.getByTestId('photo-file').setInputFiles('images2.jpeg');
  await expect(page.getByTestId('photo-stage')).toBeVisible();
  await page.getByTestId('photo-style-industrial').click();
  await page.getByTestId('photo-prompt').fill('溫暖、沉穩');
  await page.getByTestId('photo-count').selectOption('2');
  await page.getByTestId('photo-generate').click();
  await expect(page.getByTestId('photo-results').locator('button')).toHaveCount(2, { timeout: 30_000 });
  await page.getByTestId('photo-brush').click();
  const mb = (await page.getByTestId('photo-mask').boundingBox())!;
  await page.mouse.move(mb.x + mb.width * 0.3, mb.y + mb.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(mb.x + mb.width * 0.6, mb.y + mb.height * 0.6, { steps: 8 });
  await page.mouse.up();
  await page.getByTestId('photo-inpaint').click();
  await expect(page.getByTestId('photo-results').locator('button')).toHaveCount(3, { timeout: 30_000 });
  await page.getByTestId('photo-brush').click();
  await page.getByTestId('photo-restyle').screenshot({ path: 'e2e/results/batch-a-photo.png' });
  await page.getByTestId('photo-save').click();
  await expect(page.getByTestId('photo-restyle')).toContainText(/已存入圖庫|Saved/);
  await page.keyboard.press('Escape');
  await page.getByTestId('open-gallery').click();
  await expect(page.getByTestId('gallery-grid').locator('li')).toHaveCount(1);
  expect((await level(page)).objects).toBeGreaterThan(0);
});
