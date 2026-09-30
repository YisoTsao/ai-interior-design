import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * P5 Gate E2E：上傳平面圖 → 辨識 → 校正（兩點＋實際長度 / 確認 DXF 單位）→ 建立 3D。
 * 後端＝真實 API＋worker＋cv-service（services/api/scripts/e2e-backend.mjs）。
 */
const FX = 'fixtures/plans';
const meta = JSON.parse(readFileSync(`${FX}/synth-filled.json`, 'utf8'));

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByTestId('import-plan').click();
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(`plan${Date.now()}@test.local`);
  await page.getByTestId('auth-password').fill('password-123');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('import-file')).toBeVisible();
}

/** 原圖像素 → 螢幕座標（SVG viewBox＝影像尺寸，preserveAspectRatio 預設 xMidYMid meet） */
async function imageToScreen(page: Page, p: [number, number]) {
  const canvas = page.getByTestId('plan-canvas');
  const box = (await canvas.boundingBox())!;
  const [, , W, H] = (await canvas.getAttribute('data-view'))!.split(',').map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const k = Math.min(box.width / W, box.height / H);
  return { x: box.x + (box.width - W * k) / 2 + p[0] * k, y: box.y + (box.height - H * k) / 2 + p[1] * k };
}

async function expect3d(page: Page) {
  await page.waitForURL(/\/p\/.+\/edit\?view=3d/);
  await page.waitForFunction(() => (window as any).__editor?.viewer3d()?.info().calls > 0, null, {
    timeout: 60_000,
  });
  return page.evaluate(() => {
    const l = (window as any).__editor.store.getState().scene.levels[0];
    const xs = l.walls.flatMap((w: any) => [w.a[0], w.b[0]]);
    const zs = l.walls.flatMap((w: any) => [w.a[1], w.b[1]]);
    return {
      walls: l.walls.length,
      openings: l.openings.length,
      rooms: l.rooms.length,
      labels: l.rooms.filter((r: any) => r.label).length,
      width: Math.max(...xs) - Math.min(...xs),
      depth: Math.max(...zs) - Math.min(...zs),
    };
  });
}

test('點陣平面圖：上傳 → 待確認清單 → 兩點校正 → 建立 3D（尺寸誤差 ≤ 3%）', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.getByTestId('import-file').setInputFiles(`${FX}/synth-filled.png`);
  await page.waitForURL(/\/import\//);
  await expect(page.getByTestId('plan-canvas')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('build-3d')).toBeDisabled(); // 尺度未確認前不能建立
  await page.screenshot({ path: 'e2e/results/plan-review.png' });

  // 兩點校正：外框上緣的兩個角（牆中心線），實際距離＝總寬
  await page.getByTestId('calib-start').click();
  for (const p of [meta.calibration.p0, meta.calibration.p1]) {
    const s = await imageToScreen(page, p);
    await page.mouse.click(s.x, s.y);
  }
  await page.getByTestId('calib-length').fill(String(meta.calibration.mm));
  await page.getByTestId('calib-apply').click();
  await expect(page.getByTestId('scale-ok')).toBeVisible();
  await page.getByTestId('build-3d').click();

  const r = await expect3d(page);
  const gt = meta.gt;
  expect(r.walls).toBeGreaterThanOrEqual(gt.walls.length - 3);
  expect(r.openings).toBeGreaterThanOrEqual(gt.openings.length - 3);
  expect(r.rooms).toBeGreaterThanOrEqual(gt.rooms.length - 2);
  expect(r.labels).toBeGreaterThan(0);
  expect(Math.abs(r.width - gt.width) / gt.width).toBeLessThan(0.03);
  expect(Math.abs(r.depth - gt.depth) / gt.depth).toBeLessThan(0.03);
  await page.waitForTimeout(800);
  await page.getByTestId('viewer3d').screenshot({ path: 'e2e/results/plan-import-3d.png' });
});

test('DXF：單位來自檔案，確認尺度 → 建立 3D（牆數與門窗完全一致）', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.getByTestId('import-file').setInputFiles(`${FX}/synth-mm.dxf`);
  await page.waitForURL(/\/import\//);
  await expect(page.getByTestId('scale-confirm')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('scale-confirm').click();
  await page.getByTestId('build-3d').click();
  const r = await expect3d(page);
  const gt = meta.gt;
  expect(r.openings).toBe(gt.openings.length);
  expect(r.labels).toBe(gt.rooms.length);
  expect(Math.abs(r.width - gt.width) / gt.width).toBeLessThan(0.01);
});
