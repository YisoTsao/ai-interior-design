import { expect, test, type Page } from '@playwright/test';
import { newSampleProject } from './helpers';

/**
 * 前台 11 規格 P2（第八批）：LGT-04 IES、LGT-05 燈光群組與情境、PROP-06 樣式預設、PROP-07 屬性搜尋與釘選、
 * UX-06 介面主題、UX-09 小地圖、UX-10 成就、LVL-04 樓梯開洞、SHR-05 方案比較、SHR-06 客戶確認。
 */
const st = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    return { level: s.scene.levels.find((l: any) => l.id === s.levelId), scene: s.scene };
  });
const select = (page: Page, ids: string[]) =>
  page.evaluate((x) => (window as any).__editor.store.getState().select(x), ids);
async function openSection(page: Page, testId: string) {
  const d = page.getByTestId(testId);
  if (!(await d.evaluate((el) => (el as HTMLDetailsElement).open))) await d.locator('summary').click();
}
const ready3d = (page: Page) =>
  page.waitForFunction(() => (window as any).__editor?.viewer3d()?.info().calls > 0, null, {
    timeout: 60_000,
  });

test('LGT-05 燈光群組與情境；LGT-04 IES 匯入', async ({ page }) => {
  await newSampleProject(page);
  const lamps = (await st(page)).level.objects.filter((o: any) => /lamp/.test(o.catalogId));
  expect(lamps.length).toBeGreaterThanOrEqual(2);
  // 群組
  for (const l of lamps.slice(0, 2)) {
    await select(page, [l.id]);
    await page.getByTestId('light-group-input').fill('客廳');
    await page.getByTestId('light-group-input').press('Enter');
  }
  await select(page, []);
  await openSection(page, 'section-light-scenes');
  await expect(page.getByTestId('light-group-客廳')).toBeVisible();
  // 存情境 A（全亮）→ 關掉群組 → 存情境 B → 套用 A
  await page.getByTestId('light-scene-name').fill('全亮');
  await page.getByTestId('light-scene-save').click();
  await page.getByTestId('light-group-客廳').getByRole('checkbox').uncheck();
  let lv = (await st(page)).level;
  expect(
    lv.objects.filter((o: any) => o.light?.group === '客廳').every((o: any) => o.light.on === false),
  ).toBe(true);
  await page.getByTestId('light-scene-name').fill('看電影');
  await page.getByTestId('light-scene-save').click();
  await page.getByTestId('light-scene-apply-0').click();
  lv = (await st(page)).level;
  expect(
    lv.objects.filter((o: any) => o.light?.group === '客廳').every((o: any) => o.light.on === true),
  ).toBe(true);
  // 時間軸播放只預覽：場景不變
  const before = JSON.stringify((await st(page)).level.objects);
  await page.getByTestId('light-scene-play').click();
  await page.waitForTimeout(400);
  expect(JSON.stringify((await st(page)).level.objects)).toBe(before);
  await page.getByTestId('light-scene-play').click();

  // IES：放一盞崁燈 → 匯入 → 光通量與光束角
  const id = await page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    const before = new Set(s.scene.levels[0].objects.map((o: any) => o.id));
    return { before: [...before] };
  });
  await page.evaluate(async () => {
    const s = (window as any).__editor.store.getState();
    const lv = s.scene.levels.find((l: any) => l.id === s.levelId);
    const mod = lv.objects.find((o: any) => /lamp/.test(o.catalogId));
    s.select([mod.id]);
  });
  await page.getByTestId('ies-file').setInputFiles('e2e/fixtures/downlight.ies');
  await expect(page.getByTestId('ies-result')).toContainText('DL-40');
  const sel = await page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    return s.scene.levels
      .find((l: any) => l.id === s.levelId)
      .objects.find((o: any) => o.id === s.selection[0]);
  });
  expect(Math.abs(sel.light.lumens - 2513)).toBeLessThan(40);
  expect(id.before.length).toBeGreaterThan(0);
});

test('PROP-06 樣式預設；PROP-07 屬性搜尋與釘選；UX-06 主題', async ({ page }) => {
  await newSampleProject(page);
  const walls = (await st(page)).level.walls;
  await select(page, [walls[0].id]);
  await page.getByTestId('section-feature-wall').waitFor();
  await openSection(page, 'section-feature-wall');
  await page.getByTestId('feature-marbleTv').click();
  await openSection(page, 'section-style-presets');
  await page.getByTestId('preset-name').fill('大理石');
  await page.getByTestId('preset-save').click();
  await select(page, [walls[1].id, walls[2].id]);
  await page.getByTestId('preset-apply-大理石').click();
  const w = (await st(page)).level.walls;
  expect(w[1].materialId).toBe('stone_calacatta_marble');
  expect(w[2].materialId).toBe('stone_calacatta_marble');

  await select(page, [walls[0].id]);
  // 搜尋：只留下含關鍵字的分節
  await page.getByTestId('inspector-search').fill('踢腳');
  await expect(page.getByTestId('section-feature-wall')).toBeHidden();
  await page.getByTestId('inspector-search').fill('');
  await expect(page.getByTestId('section-feature-wall')).toBeVisible();
  // 釘選
  await page.getByTestId('section-feature-wall-pin').click();
  await expect(page.getByTestId('inspector-pins')).toBeVisible();

  // 主題
  await select(page, []);
  await openSection(page, 'section-ui');
  await page.getByTestId('ui-theme').selectOption('pro');
  expect(await page.evaluate(() => document.documentElement.dataset.uiTheme)).toBe('pro');
  const bg = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.game-ui')!).getPropertyValue('--bg').trim(),
  );
  expect(bg).toBe('#f4f3ef');
  await page.getByTestId('ui-density').selectOption('compact');
  await page.screenshot({ path: 'e2e/results/batch-b-pro-theme.png' });
  await page.getByTestId('ui-theme').selectOption('hud');
});

test('UX-09 小地圖；UX-10 成就進度', async ({ page }) => {
  await newSampleProject(page);
  await page.getByTestId('view-3d').click();
  await ready3d(page);
  await expect(page.getByTestId('minimap')).toBeVisible();
  const t0 = await page.evaluate(() => (window as any).__editor.viewer3d().currentCamera().target);
  const mb = (await page.getByTestId('minimap-svg').boundingBox())!;
  await page.mouse.click(mb.x + mb.width * 0.25, mb.y + mb.height * 0.25);
  await page.waitForTimeout(300);
  const t1 = await page.evaluate(() => (window as any).__editor.viewer3d().currentCamera().target);
  expect(Math.hypot(t1[0] - t0[0], t1[2] - t0[2])).toBeGreaterThan(500);
  await page.getByTestId('achievements').locator('summary').click();
  await expect(page.getByTestId('achievements').locator('[data-done=true]')).not.toHaveCount(0);
  const done = await page.evaluate(() => JSON.parse(localStorage.getItem('achievements') ?? '[]'));
  expect(done).toEqual(expect.arrayContaining(['firstWall', 'firstRoom', 'view3d']));
});

test('SHR-05 方案比較；SHR-06 客戶確認（分享頁簽名 → 確認碼匯入驗證）', async ({ page, context }) => {
  test.setTimeout(120_000);
  await newSampleProject(page);
  // 存一個版本，再改設計
  await page.getByTestId('open-versions').click();
  await page.getByTestId('version-save').click();
  await expect(page.getByTestId('version-row')).toHaveCount(1);
  await page.keyboard.press('Escape');
  const obj = (await st(page)).level.objects[0];
  await page.evaluate((id) => {
    const s = (window as any).__editor.store.getState();
    s.select([id]);
  }, obj.id);
  await page.keyboard.press('Delete');
  await page.getByTestId('open-compare').click();
  await expect(page.getByTestId('compare-side').locator('img')).toHaveCount(2);
  await expect(page.getByTestId('compare-changes')).toContainText(/1/);
  await page.getByTestId('compare-mode-slider').click();
  await expect(page.getByTestId('compare-slider')).toBeVisible();
  await page.keyboard.press('Escape');

  // 分享（要求確認＋替代方案）
  await page.getByTestId('open-share').click();
  await page.getByTestId('share-ask-approval').check();
  await page.locator('[data-testid^="share-alt-"]').first().check();
  await expect(page.getByTestId('share-url')).toHaveValue(/view#s=/);
  await page.waitForTimeout(300);
  const url = await page.getByTestId('share-url').inputValue();
  const view = await context.newPage();
  await view.goto(url);
  await expect(view.getByTestId('share-scheme')).toBeVisible();
  await view.getByTestId('share-approve').click();
  await view.getByTestId('approval-name').fill('王小明');
  const pb = (await view.getByTestId('approval-pad').boundingBox())!;
  await view.mouse.move(pb.x + 20, pb.y + 40);
  await view.mouse.down();
  await view.mouse.move(pb.x + 200, pb.y + 100, { steps: 8 });
  await view.mouse.up();
  await view.getByTestId('approval-agree').check();
  await view.getByTestId('approval-submit').click();
  const code = await view.getByTestId('approval-code').inputValue();
  expect(code).toMatch(/^IAI-OK-/);
  await view.close();
  // 設計師匯入確認碼
  await page.getByTestId('approval-import').fill(code);
  await page.getByTestId('approval-import-ok').click();
  await expect(page.getByTestId('approval-msg')).toContainText('王小明');
  await expect(page.getByTestId('approval-list')).toContainText(/目前設計|current/);
  const meta = (await st(page)).scene.meta;
  expect(meta.approvals[0]).toMatchObject({ client: '王小明', match: 'current' });
});

test('LVL-04 樓梯到達上層 → 上層樓板開口', async ({ page }) => {
  await newSampleProject(page);
  await page.evaluate(() => {
    const s = (window as any).__editor.store.getState();
    s.exec({
      id: 'stairs-test',
      label: 'test',
      do: (d: any) => {
        const lv = d.levels.find((l: any) => l.id === s.levelId);
        lv.objects.push({
          id: 'obj_stairs_e2e',
          catalogId: 'stairs_straight',
          position: [2000, 0, 2500],
          rotationY: 0,
        });
      },
    });
  });
  await page.getByTestId('level-add').click();
  await page.waitForTimeout(300);
  const n = await page.evaluate(() => (window as any).__editor.store.getState().scene.levels.length);
  expect(n).toBe(2);
  await page.getByTestId('plan2d').screenshot({ path: 'e2e/results/batch-b-stair-opening.png' });
  await page.getByTestId('view-3d').click();
  await ready3d(page);
  await page.waitForTimeout(600);
  await page.getByTestId('viewer3d').screenshot({ path: 'e2e/results/batch-b-stair-opening-3d.png' });
});
